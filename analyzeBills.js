import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import DriveClient from './DriveClient.js';
import BillParser from './BillParser.js';
import CacheManager from './CacheManager.js';
import EnergyAnalyzer from './EnergyAnalyzer.js';
import SunrunClient from './SunrunClient.js';

async function main() {
  console.log('🚀 Starting Bill Analysis...');

  // Auth
  const { GMAIL_OAUTH_CREDENTIALS } = process.env;
  if (!GMAIL_OAUTH_CREDENTIALS) {
    throw new Error('❌ GMAIL_OAUTH_CREDENTIALS not found');
  }
  const { client_id, client_secret, refresh_token } = JSON.parse(GMAIL_OAUTH_CREDENTIALS);
  const auth = new google.auth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token });

  const drive = new DriveClient(auth);
  const parser = new BillParser();
  const billCache = new CacheManager();
  const sunrunCache = new CacheManager('.sunrun_daily_cache.json');
  const sunrunClient = new SunrunClient();

  // Fetch Files
  console.log('📂 Fetching file lists...');
  const { GOOGLE_DRIVE_FOLDER_ELECTRIC, GOOGLE_DRIVE_FOLDER_SOLAR, GOOGLE_DRIVE_FOLDER_GAS } =
    process.env;

  if (!GOOGLE_DRIVE_FOLDER_ELECTRIC || !GOOGLE_DRIVE_FOLDER_SOLAR || !GOOGLE_DRIVE_FOLDER_GAS) {
    throw new Error('❌ Missing GOOGLE_DRIVE_FOLDER_* environment variables');
  }

  // Sync daily production data from Sunrun API
  await syncSunrunDailyData(sunrunClient, sunrunCache);

  const ngFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_ELECTRIC);
  const sunrunFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_SOLAR);
  const gasFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_GAS);

  console.log(`📄 Found ${ngFiles.length} National Grid bills in ${GOOGLE_DRIVE_FOLDER_ELECTRIC}`);
  console.log(`📄 Found ${sunrunFiles.length} Sunrun bills in ${GOOGLE_DRIVE_FOLDER_SOLAR}`);
  console.log(`📄 Found ${gasFiles.length} Eversource Gas bills in ${GOOGLE_DRIVE_FOLDER_GAS}`);

  // Parse data
  const ngData = [];
  const sunrunData = [];
  const gasData = [];

  // Helper to process files with cache
  const processFiles = async (files, type, targetArray) => {
    console.log(`Processing ${type} Bills...`);
    let newCount = 0;
    let cacheCount = 0;

    for (const file of files) {
      // Check cache
      const cached = billCache.get(file.id);
      if (cached) {
        targetArray.push(cached);
        cacheCount++;
        continue;
      }

      // Not in cache, fetch and parse
      process.stdout.write('.');
      try {
        const buffer = await drive.getFile(file.id);
        const data = await parser.parse(type, buffer);
        if (data) {
          targetArray.push(data);
          billCache.set(file.id, data); // Save to cache
          newCount++;
        }
      } catch (e) {
        console.error(`\nFailed to process ${file.name}: ${e.message}`);
      }
    }
    console.log(`\n  ✅ ${cacheCount} cached, ${newCount} new.`);
  };

  await processFiles(ngFiles, 'NationalGrid', ngData);
  await processFiles(sunrunFiles, 'Sunrun', sunrunData);
  await processFiles(gasFiles, 'Eversource', gasData);

  // Cleanup stale cache entries
  const activeFileIds = new Set([
    ...ngFiles.map((f) => f.id),
    ...sunrunFiles.map((f) => f.id),
    ...gasFiles.map((f) => f.id),
  ]);

  let removedCount = 0;
  Object.keys(billCache.cache).forEach((cacheId) => {
    if (!activeFileIds.has(cacheId)) {
      delete billCache.cache[cacheId];
      removedCount++;
    }
  });
  if (removedCount > 0) {
    console.log(`🧹 Removed ${removedCount} stale entries from cache.`);
  }

  // Save cache at the end
  billCache.save();

  // Aggregate Data
  const analyzer = new EnergyAnalyzer();

  // Inject daily data into analyzer
  analyzer.setDailySolarData(sunrunCache.cache);

  // Feed data into analyzer
  ngData.forEach((d) => analyzer.addBill(d));
  sunrunData.forEach((d) => analyzer.addBill(d));
  gasData.forEach((d) => analyzer.addBill(d));

  // Get calculated metrics
  const chartData = analyzer.getMonthlyAnalysis();

  // Generate HTML Report
  const html = generateHtmlReport(chartData);
  const reportPath = path.join(process.cwd(), 'index.html');
  fs.writeFileSync(reportPath, html);

  console.log(`✅ Analysis complete! Report saved to: ${reportPath}`);
}

async function syncSunrunDailyData(sunrunClient, sunrunCache) {
  try {
    await sunrunClient.init();

    // Determine date range
    const today = new Date().toISOString().split('T')[0];
    let startDate = sunrunClient.sunrunStart;

    // Check last cached date to optimize
    const cachedDates = Object.keys(sunrunCache.cache).sort();
    if (cachedDates.length > 0) {
      const lastDate = cachedDates[cachedDates.length - 1];
      // Start from next day
      const nextDay = new Date(lastDate);
      nextDay.setDate(nextDay.getDate() + 1);
      startDate = nextDay.toISOString().split('T')[0];
    }

    if (startDate < today) {
      console.log(`☀️ Syncing Sunrun Daily Data from ${startDate} to ${today}...`);
      // Fetch in chunks (e.g., 3 months) to be safe, or just try all.
      // Let's try fetching all for now, if it fails we can chunk.
      const dailyData = await sunrunClient.getDailyProduction(startDate, today);

      let newDailyCount = 0;
      for (const day of dailyData) {
        // date format from API might need checking, assuming YYYY-MM-DD based on client code
        // The client code tries to extract it.
        if (day.date && day.production !== undefined) {
          // Normalize date to YYYY-MM-DD just in case
          const dateKey = day.date.split('T')[0];
          sunrunCache.set(dateKey, day.production);
          newDailyCount++;
        }
      }
      console.log(`   ✅ Fetched ${newDailyCount} new daily records.`);
      sunrunCache.save();
    } else {
      console.log('☀️ Sunrun Daily Data is up to date.');
    }
  } catch (e) {
    console.error('⚠️ Failed to sync Sunrun daily data:', e.message);
    // Continue without crashing, we can still do monthly analysis
  }
}

function generateHtmlReport(data) {
  const templatePath = path.join(process.cwd(), 'dashboard_template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace('"{{CHART_DATA}}"', JSON.stringify(data));
}

main().catch(console.error);
