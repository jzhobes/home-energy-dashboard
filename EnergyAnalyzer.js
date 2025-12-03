export default class EnergyAnalyzer {
    constructor() {
        this.monthlyData = {};
    }

    /**
     * Adds a bill to the monthly aggregation.
     *
     * @param {Object} data - The parsed bill data.
     */
    addBill(data) {
        // Heuristic: If bill is generated in the first 10 days of the month, 
        // it likely represents the previous month's usage.
        // e.g. Eversource bill dated 2024-12-02 is for Nov usage.
        const parts = data.date.split('-').map(Number);
        let y = parts[0];
        let m = parts[1];
        const d = parts[2];
        if (d <= 20) {
            m--;
            if (m === 0) {
                m = 12;
                y--;
            }
        }
        const key = `${y}-${String(m).padStart(2, '0')}`;

        if (!this.monthlyData[key]) {
            this.monthlyData[key] = {
                month: key,
                ngStartDate: null,
                ngEndDate: null,
                ngCost: 0,
                ngUsage: 0,
                ngExport: 0,
                ngCredit: 0,
                ngProd: 0,
                sunrunCost: 0,
                sunrunProd: 0,
                gasCost: 0,
                gasTherms: 0
            };
        }

        const bucket = this.monthlyData[key];

        if (data.type === 'NationalGrid') {
            bucket.ngCost += data.cost;
            bucket.ngUsage += data.usage;
            bucket.ngExport += (data.exported || 0);
            bucket.ngProd += (data.production || 0);
            if (data.credit > 0) {
                bucket.ngCredit = data.credit;
            }
            if (data.startDate) {
                bucket.ngStartDate = data.startDate;
            }
            if (data.endDate) {
                bucket.ngEndDate = data.endDate;
            }
        } else if (data.type === 'Sunrun') {
            bucket.sunrunCost += data.cost;
            bucket.sunrunProd += data.production;
        } else if (data.type === 'Eversource') {
            bucket.gasCost += data.cost;
            bucket.gasTherms += data.therms;
        }
    }

    /**
     * Sets the daily solar production data.
     *
     * @param {Object} dailyData - Map of date (YYYY-MM-DD) -> production (kWh)
     */
    setDailySolarData(dailyData) {
        this.dailySolarData = dailyData;
    }

    /**
     * Calculates advanced metrics and returns sorted monthly data.
     *
     * @returns {Array<Object>} - Array of monthly data objects with calculated metrics.
     */
    getMonthlyAnalysis() {
        const sortedMonths = Object.keys(this.monthlyData).sort();

        return sortedMonths.map(m => {
            const d = this.monthlyData[m];

            // Determine Best Production Source
            // Priority 1: National Grid Meter (ngProd). This is the most accurate "Net Metering" source.
            // Priority 2: Sunrun Inverter (sunrunProd). Use this if NG data is missing (e.g. older bills).
            // Logic: If ngProd is recorded (>0), use it. Otherwise fallback to Sunrun.
            // Edge Case: If both are 0 (e.g. snow), it stays 0.

            // Calculate Production for the Exact Billing Period
            let billingPeriodProd = 0;
            if (this.dailySolarData) {
                if (d.ngStartDate && d.ngEndDate) {
                    // Calculate shifted dates (-1 day offset) to align with NG billing cycle
                    const startDate = new Date(d.ngStartDate);
                    startDate.setDate(startDate.getDate() - 1);
                    const shiftedStart = startDate.toISOString().split('T')[0];

                    const endDate = new Date(d.ngEndDate);
                    endDate.setDate(endDate.getDate() - 1);
                    const shiftedEnd = endDate.toISOString().split('T')[0];

                    // Sum daily production between shifted start and end date (inclusive)
                    Object.keys(this.dailySolarData).forEach(date => {
                        if (date >= shiftedStart && date <= shiftedEnd) {
                            billingPeriodProd += this.dailySolarData[date];
                        }
                    });
                } else {
                    // Fallback: Sum up all daily production for this calendar month (m is YYYY-MM)
                    Object.keys(this.dailySolarData).forEach(date => {
                        if (date.startsWith(m)) {
                            billingPeriodProd += this.dailySolarData[date];
                        }
                    });
                }
                billingPeriodProd = Math.round(billingPeriodProd); // Round to whole number
            }

            // Determine Total Production (Prioritize exact billing period data, then NG credit, then Sunrun bill)
            let totalProduction = 0;
            if (billingPeriodProd > 0) {
                totalProduction = billingPeriodProd;
            } else if (d.ngProd > 0) {
                totalProduction = d.ngProd;
            } else {
                totalProduction = d.sunrunProd;
            }
            // Consumption = Production - Net Export + Net Import
            // Self Use = Production - Net Export (clamped to 0)
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
                totalProduction,
                selfUse,
                trueConsumption,
                netPosition,
                totalCost,
                effectiveRate,
                gasKwh,
                totalEnergyCost,
                totalEnergyKwh,
                billingPeriodProd
            };
        });
    }
}
