import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import DriveClient from './DriveClient.js';
import BillParser from './BillParser.js';
import CacheManager from './CacheManager.js';
import EnergyAnalyzer from './EnergyAnalyzer.js';

async function main() {
    console.log('🚀 Starting Bill Analysis...');

    // 1. Auth
    const { GMAIL_OAUTH_CREDENTIALS } = process.env;
    if (!GMAIL_OAUTH_CREDENTIALS) {
        throw new Error('❌ GMAIL_OAUTH_CREDENTIALS not found');
    }
    const { client_id, client_secret, refresh_token } = JSON.parse(GMAIL_OAUTH_CREDENTIALS);
    const auth = new google.auth.OAuth2(client_id, client_secret);
    auth.setCredentials({ refresh_token });

    const drive = new DriveClient(auth);
    const parser = new BillParser();
    const cache = new CacheManager();

    // 2. Fetch Files
    console.log('📂 Fetching file lists...');
    const {
        GOOGLE_DRIVE_FOLDER_ELECTRIC,
        GOOGLE_DRIVE_FOLDER_SOLAR,
        GOOGLE_DRIVE_FOLDER_GAS
    } = process.env;

    if (!GOOGLE_DRIVE_FOLDER_ELECTRIC || !GOOGLE_DRIVE_FOLDER_SOLAR || !GOOGLE_DRIVE_FOLDER_GAS) {
        throw new Error('❌ Missing GOOGLE_DRIVE_FOLDER_* environment variables');
    }

    const ngFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_ELECTRIC);
    const sunrunFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_SOLAR);
    const gasFiles = await drive.listFiles(GOOGLE_DRIVE_FOLDER_GAS);

    console.log(`📄 Found ${ngFiles.length} National Grid bills in ${GOOGLE_DRIVE_FOLDER_ELECTRIC}`);
    console.log(`📄 Found ${sunrunFiles.length} Sunrun bills in ${GOOGLE_DRIVE_FOLDER_SOLAR}`);
    console.log(`📄 Found ${gasFiles.length} Eversource Gas bills in ${GOOGLE_DRIVE_FOLDER_GAS}`);

    // 3. Parse Data
    const ngData = [];
    const sunrunData = [];
    const gasData = [];

    // Helper to process files with cache
    const processFiles = async (files, type, targetArray) => {
        console.log(`Processing ${type} Bills...`);
        let newCount = 0;
        let cacheCount = 0;

        for (const file of files) {
            // Check Cache
            const cached = cache.get(file.id);
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
                    cache.set(file.id, data); // Save to cache
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

    // Save cache at the end
    cache.save();

    // 4. Aggregate Data
    // 4. Aggregate Data
    const analyzer = new EnergyAnalyzer();

    // Feed data into analyzer
    ngData.forEach(d => analyzer.addBill(d));
    sunrunData.forEach(d => analyzer.addBill(d));
    gasData.forEach(d => analyzer.addBill(d));

    // Get calculated metrics
    const chartData = analyzer.getMonthlyAnalysis();

    // 5. Generate HTML Report
    const html = generateHtmlReport(chartData);
    const reportPath = path.join(process.cwd(), 'index.html');
    fs.writeFileSync(reportPath, html);

    console.log(`✅ Analysis complete! Report saved to: ${reportPath}`);
}

function generateHtmlReport(data) {
    const templatePath = path.join(process.cwd(), 'dashboard_template.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    return template.replace('"{{CHART_DATA}}"', JSON.stringify(data));
}

main().catch(console.error);
