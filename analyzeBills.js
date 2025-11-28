import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import DriveClient from './DriveClient.js';
import BillParser from './BillParser.js';

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

    // 2. Fetch Files
    console.log('📂 Fetching file lists...');
    const ngFiles = await drive.listFiles('House/National Grid Bills');
    const sunrunFiles = await drive.listFiles('House/Sunrun Bills');
    const gasFiles = await drive.listFiles('House/Eversource Gas Bills');

    console.log(`📄 Found ${ngFiles.length} National Grid bills`);
    console.log(`📄 Found ${sunrunFiles.length} Sunrun bills`);
    console.log(`📄 Found ${gasFiles.length} Eversource Gas bills`);

    // 3. Parse Data
    const ngData = [];
    const sunrunData = [];
    const gasData = [];

    console.log('Processing National Grid Bills...');
    for (const file of ngFiles) {
        process.stdout.write('.');
        try {
            const buffer = await drive.getFile(file.id);
            const data = await parser.parseNationalGrid(buffer);
            if (data) ngData.push(data);
        } catch (e) {
            console.error(`\nFailed to process ${file.name}: ${e.message}`);
        }
    }
    console.log('\n');

    console.log('Processing Sunrun Bills...');
    for (const file of sunrunFiles) {
        process.stdout.write('.');
        try {
            const buffer = await drive.getFile(file.id);
            const data = await parser.parseSunrun(buffer);
            if (data) sunrunData.push(data);
        } catch (e) {
            console.error(`\nFailed to process ${file.name}: ${e.message}`);
        }
    }
    console.log('\n');

    console.log('Processing Eversource Gas Bills...');
    for (const file of gasFiles) {
        process.stdout.write('.');
        try {
            const buffer = await drive.getFile(file.id);
            const data = await parser.parseEversource(buffer);
            if (data) gasData.push(data);
        } catch (e) {
            console.error(`\nFailed to process ${file.name}: ${e.message}`);
        }
    }
    console.log('\n');

    // 4. Aggregate Data
    // Sort by date
    ngData.sort((a, b) => new Date(a.date) - new Date(b.date));
    sunrunData.sort((a, b) => new Date(a.date) - new Date(b.date));
    gasData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Combine into monthly buckets (YYYY-MM)
    const monthlyData = {};

    const addToBucket = (date, type, data) => {
        const key = date.substring(0, 7); // YYYY-MM
        if (!monthlyData[key]) {
            monthlyData[key] = { 
                month: key, 
                ngCost: 0, 
                ngUsage: 0, 
                ngExport: 0,
                ngCredit: 0,
                ngProd: 0, // New: Production from NG Meter
                sunrunCost: 0, 
                sunrunProd: 0,
                gasCost: 0,
                gasTherms: 0
            };
        }
        if (type === 'NationalGrid') {
            monthlyData[key].ngCost += data.cost;
            monthlyData[key].ngUsage += data.usage;
            monthlyData[key].ngExport += (data.exported || 0);
            monthlyData[key].ngProd += (data.production || 0);
            if (data.credit > 0) monthlyData[key].ngCredit = data.credit;
        } else if (type === 'Sunrun') {
            monthlyData[key].sunrunCost += data.cost;
            monthlyData[key].sunrunProd += data.production;
        } else if (type === 'Eversource') {
            monthlyData[key].gasCost += data.cost;
            monthlyData[key].gasTherms += data.therms;
        }
    };

    ngData.forEach(d => addToBucket(d.date, 'NationalGrid', d));
    sunrunData.forEach(d => addToBucket(d.date, 'Sunrun', d));
    gasData.forEach(d => addToBucket(d.date, 'Eversource', d));

    const sortedMonths = Object.keys(monthlyData).sort();
    
    // Calculate Advanced Metrics
    const chartData = sortedMonths.map(m => {
        const d = monthlyData[m];
        
        // Determine Best Production Source
        // Use NG Production if available (it's from the meter), otherwise fallback to Sunrun
        const totalProduction = d.ngProd > 0 ? d.ngProd : d.sunrunProd;

        // True Consumption Calculation
        // Consumption = Production - Net Export + Net Import
        // If Net Export > 0, we sent power away.
        // If Net Import > 0 (ngUsage), we bought power.
        
        // Self Use = Production - Net Export
        // (If Net Export > Production, something is wrong, clamp to 0)
        const selfUse = Math.max(0, totalProduction - d.ngExport);
        
        const trueConsumption = selfUse + d.ngUsage;
        
        // Net Position (Production - Consumption)
        const netPosition = totalProduction - trueConsumption;

        // Effective Rate ($/kWh)
        const totalCost = d.ngCost + d.sunrunCost;
        const effectiveRate = trueConsumption > 0 ? (totalCost / trueConsumption) : 0;

        // Gas Calculations
        const gasKwh = d.gasTherms * 29.3;
        const totalEnergyCost = totalCost + d.gasCost;
        const totalEnergyKwh = trueConsumption + gasKwh;

        return {
            ...d,
            totalProduction, // Use this for charts instead of sunrunProd
            selfUse,
            trueConsumption,
            netPosition,
            totalCost,
            effectiveRate,
            gasKwh,
            totalEnergyCost,
            totalEnergyKwh
        };
    });

    // 5. Generate HTML Report
    const html = generateHtmlReport(chartData);
    const reportPath = path.join(process.cwd(), 'energyDashboard.html');
    fs.writeFileSync(reportPath, html);

    console.log(`✅ Analysis complete! Report saved to: ${reportPath}`);
}

function generateHtmlReport(data) {
    const labels = data.map(d => d.month);
    
    // Prepare Datasets
    const ngCosts = data.map(d => d.ngCost);
    const sunrunCosts = data.map(d => d.sunrunCost);
    const totalCosts = data.map(d => d.totalCost);
    
    const ngUsage = data.map(d => d.ngUsage);
    const sunrunProd = data.map(d => d.sunrunProd);
    const totalProduction = data.map(d => d.totalProduction);
    const trueConsumption = data.map(d => d.trueConsumption);
    const selfUse = data.map(d => d.selfUse);
    const ngExport = data.map(d => d.ngExport);
    
    const ngCredit = data.map(d => d.ngCredit);
    const effectiveRate = data.map(d => d.effectiveRate);
    
    // Gas Data
    const gasCost = data.map(d => d.gasCost);
    const gasKwh = data.map(d => d.gasKwh);

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Total Home Energy Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f4f7f6; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { text-align: center; color: #2c3e50; margin-bottom: 30px; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 30px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; }
        h2 { color: #34495e; font-size: 1.2em; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; margin-top: 0; }
        .chart-container { position: relative; height: 300px; width: 100%; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Total Home Energy Dashboard</h1>

        <!-- 1. Total Energy Cost (Gas + Electric + Solar) -->
        <div class="card">
            <h2>💰 Total Energy Wallet (Where is the money going?)</h2>
            <div class="chart-container">
                <canvas id="totalCostChart"></canvas>
            </div>
        </div>

        <!-- 2. Total Energy Consumption (kWh Equivalent) -->
        <div class="card">
            <h2>⚡ Total Energy Consumed (Gas vs Electric)</h2>
            <div class="chart-container">
                <canvas id="totalEnergyChart"></canvas>
            </div>
        </div>

        <!-- 3. Total Home Consumption (Electric Only) -->
        <div class="card">
            <h2>🏠 Home Electric Consumption</h2>
            <div style="text-align: right; margin-bottom: 10px;">
                <button id="toggleConsumptionBtn" style="padding: 8px 16px; background: #34495e; color: white; border: none; border-radius: 4px; cursor: pointer;">Switch to Area Chart</button>
            </div>
            <div class="chart-container">
                <canvas id="consumptionChart"></canvas>
            </div>
            <p style="text-align: center; font-size: 0.9em; color: #666;">
                <strong>Blue:</strong> Power bought from Grid. <strong>Green:</strong> Solar power used directly. 
                <br>The total height is your real home usage.
            </p>
        </div>

        <div class="grid">
            <!-- 2. Net Zero Tracker -->
            <div class="card">
                <h2>⚖️ Net Zero Tracker</h2>
                <div class="chart-container">
                    <canvas id="netZeroChart"></canvas>
                </div>
            </div>

            <!-- 3. Credit Bank -->
            <div class="card">
                <h2>💰 National Grid Credit Bank</h2>
                <div class="chart-container">
                    <canvas id="creditChart"></canvas>
                </div>
            </div>
        </div>

        <div class="grid">
            <!-- 4. Monthly Electric Costs (Grid + Solar) -->
            <div class="card">
                <h2>💵 Monthly Electric Costs (Grid + Solar)</h2>
                <div class="chart-container">
                    <canvas id="costChart"></canvas>
                </div>
            </div>

            <!-- 5. Effective Rate -->
            <div class="card">
                <h2>📉 Effective Cost per kWh</h2>
                <div class="chart-container">
                    <canvas id="rateChart"></canvas>
                </div>
            </div>
        </div>
        
        <!-- 6. Solar Utilization -->
        <div class="card">
            <h2>☀️ Solar Utilization (Where did the power go?)</h2>
            <div class="chart-container">
                <canvas id="utilizationChart"></canvas>
            </div>
        </div>

    </div>

    <script>
        const labels = ${JSON.stringify(labels)};
        
        // Common Options
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
        };

        // 1. Consumption Chart (Stacked)
        // 1. Total Energy Cost Chart
        new Chart(document.getElementById('totalCostChart'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Gas Bill',
                        data: ${JSON.stringify(gasCost)},
                        backgroundColor: '#e74c3c',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Electric Bill',
                        data: ${JSON.stringify(ngCosts)},
                        backgroundColor: '#3498db',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Solar Bill',
                        data: ${JSON.stringify(sunrunCosts)},
                        backgroundColor: '#f1c40f',
                        stack: 'Stack 0'
                    }
                ]
            },
            options: commonOptions
        });

        // 2. Total Energy Consumption Chart (kWh)
        new Chart(document.getElementById('totalEnergyChart'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Gas (kWh equiv)',
                        data: ${JSON.stringify(gasKwh)},
                        backgroundColor: '#e74c3c',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Electric Consumed',
                        data: ${JSON.stringify(trueConsumption)},
                        backgroundColor: '#3498db',
                        stack: 'Stack 0'
                    }
                ]
            },
            options: commonOptions
        });

        // 3. Consumption Chart (Toggleable)
        let consumptionChart = null;
        let isAreaChart = false;

        function createConsumptionChart() {
            const ctx = document.getElementById('consumptionChart').getContext('2d');
            if (consumptionChart) consumptionChart.destroy();

            const type = isAreaChart ? 'line' : 'bar';
            const fill = isAreaChart ? true : false;
            
            consumptionChart = new Chart(ctx, {
                type: type,
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Imported from Grid',
                            data: ${JSON.stringify(ngUsage)},
                            backgroundColor: isAreaChart ? 'rgba(52, 152, 219, 0.5)' : '#3498db',
                            borderColor: '#3498db',
                            fill: fill,
                            stack: 'Stack 0'
                        },
                        {
                            label: 'Solar Self-Use',
                            data: ${JSON.stringify(selfUse)},
                            backgroundColor: isAreaChart ? 'rgba(46, 204, 113, 0.5)' : '#2ecc71',
                            borderColor: '#2ecc71',
                            fill: fill,
                            stack: 'Stack 0'
                        },
                        {
                            label: 'Total Consumption',
                            data: ${JSON.stringify(trueConsumption)},
                            type: 'line',
                            borderColor: '#34495e',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0.3,
                            pointRadius: 0
                        }
                    ]
                },
                options: commonOptions
            });
        }

        // Initial Render
        createConsumptionChart();

        // Toggle Handler
        document.getElementById('toggleConsumptionBtn').addEventListener('click', function() {
            isAreaChart = !isAreaChart;
            this.textContent = isAreaChart ? 'Switch to Bar Chart' : 'Switch to Area Chart';
            createConsumptionChart();
        });

        // 2. Net Zero Tracker
        new Chart(document.getElementById('netZeroChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Solar Production',
                        data: ${JSON.stringify(totalProduction)},
                        borderColor: '#f1c40f',
                        backgroundColor: 'rgba(241, 196, 15, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'True Consumption',
                        data: ${JSON.stringify(trueConsumption)},
                        borderColor: '#34495e',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3
                    }
                ]
            },
            options: commonOptions
        });

        // 3. Credit Bank
        new Chart(document.getElementById('creditChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Credit Balance ($)',
                        data: ${JSON.stringify(ngCredit)},
                        borderColor: '#9b59b6',
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: commonOptions
        });

        // 4. Cost Chart
        new Chart(document.getElementById('costChart'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'National Grid',
                        data: ${JSON.stringify(ngCosts)},
                        backgroundColor: '#3498db',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Sunrun',
                        data: ${JSON.stringify(sunrunCosts)},
                        backgroundColor: '#f1c40f',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Total',
                        data: ${JSON.stringify(totalCosts)},
                        type: 'line',
                        borderColor: '#e74c3c',
                        borderWidth: 2,
                        fill: false
                    }
                ]
            },
            options: commonOptions
        });

        // 5. Rate Chart
        new Chart(document.getElementById('rateChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Effective $/kWh',
                        data: ${JSON.stringify(effectiveRate)},
                        borderColor: '#27ae60',
                        backgroundColor: 'rgba(39, 174, 96, 0.1)',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                ...commonOptions,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: '$/kWh' }
                    }
                }
            }
        });

        // 6. Utilization Chart
        new Chart(document.getElementById('utilizationChart'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Used at Home',
                        data: ${JSON.stringify(selfUse)},
                        backgroundColor: '#2ecc71',
                        stack: 'Stack 0'
                    },
                    {
                        label: 'Sent to Grid',
                        data: ${JSON.stringify(ngExport)},
                        backgroundColor: '#95a5a6',
                        stack: 'Stack 0'
                    }
                ]
            },
            options: commonOptions
        });
    </script>
</body>
</html>
    `;
}

main().catch(console.error);
