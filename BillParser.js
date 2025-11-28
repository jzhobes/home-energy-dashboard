import { PDFParse } from 'pdf-parse';

export default class BillParser {
    /**
     * Parses a National Grid bill PDF buffer.
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, usage: number, cost: number, exported: number, credit: number}|null>}
     */
    async parseNationalGrid(buffer) {
        let parser = null;
        try {
            parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text;

            // 1. Extract Date
            const dateMatch = text.match(/BILLING PERIOD[\s\S]*?to\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/i);
            let dateStr = null;
            if (dateMatch) {
                dateStr = new Date(dateMatch[1]).toISOString().split('T')[0];
            }

            // 2. Extract Cost
            let cost = 0;
            const currentChargesMatch = text.match(/Current\s+Charges\s*\+\s*([\d,]+\.\d{2})/i);
            if (currentChargesMatch) {
                cost = parseFloat(currentChargesMatch[1].replace(/,/g, ''));
            } else {
                const totalDueMatch = text.match(/Total\s+(?:Amount)?\s*Due\s*:?\s*\$([\d,]+\.\d{2})/i);
                if (totalDueMatch) {
                    cost = parseFloat(totalDueMatch[1].replace(/,/g, ''));
                }
            }

            // 3. Extract Usage Data
            // We need two distinct values:
            // A. Net Usage (from Delivery Services): Can be positive (Import) or negative (Export).
            // B. Generation Usage (from SMART Program): Always negative (Total Production).

            let netUsage = 0;
            let genUsage = 0;

            // A. Extract Net Usage (Delivery Services)
            // Pattern: "Delivery Services ... Total Usage ... -964 kWh"
            // We look for "Delivery Services" then "Total Usage" then the first number ending in kWh
            const netUsageMatch = text.match(/Delivery\s+Services[\s\S]*?Total\s+Usage[\s\S]*?([-\d,]+)\s*kWh/i);
            if (netUsageMatch) {
                netUsage = parseFloat(netUsageMatch[1].replace(/,/g, ''));
            } else {
                // Fallback for older bills where "Delivery Services" might not be the header?
                // Or if it's positive usage, it might be in the "Basic Service" line?
                // Let's try the "Electric Usage History" table for the current month if available?
                // Or the "Total Usage" loose match but exclude SMART.
                // For now, let's rely on the loose match if the specific one fails, but be careful.
                const looseMatch = text.match(/(?:Total\s+Usage|Difference)[\s\S]*?([-\d,]+)\s*kWh/i);
                if (looseMatch) {
                    // Check if this match is actually the SMART one (usually larger negative).
                    // This is risky. Let's stick to the specific match first.
                    // If loose match is found and we didn't find SMART yet, maybe use it?
                    // Let's assume netUsage is 0 if not found (e.g. fully credited?).
                    // Actually, if looseMatch is found, use it as netUsage if it's not the SMART one.
                }
            }

            // B. Extract Generation Usage (SMART Program)
            // Pattern: "MA SMART Incentive Program ... Energy ... -1439 kWh"
            const genUsageMatch = text.match(/MA\s+SMART\s+Incentive\s+Program[\s\S]*?Energy[\s\S]*?([-\d,]+)\s*kWh/i);
            if (genUsageMatch) {
                genUsage = Math.abs(parseFloat(genUsageMatch[1].replace(/,/g, ''))); // Store as positive production
            }

            // Map to legacy fields for compatibility, but prefer new fields
            let usage = netUsage > 0 ? netUsage : 0; // Import
            let exported = netUsage < 0 ? Math.abs(netUsage) : 0; // Export

            // 4. Extract Credit Balance
            // Pattern: "Credit Balance -$ 577.49"
            let credit = 0;
            const creditMatch = text.match(/Credit\s+Balance\s*-\$\s*([\d,]+\.\d{2})/i);
            if (creditMatch) {
                credit = parseFloat(creditMatch[1].replace(/,/g, ''));
            }

            return { 
                date: dateStr, 
                usage,      // Imported from Grid
                exported,   // Sent to Grid (Net)
                production: genUsage, // Total Solar Generation (from NG meter)
                cost, 
                credit, 
                type: 'NationalGrid' 
            };

            if (!dateStr) {
                return null;
            }

            return { date: dateStr, usage, cost, exported, credit, type: 'NationalGrid' };

        } catch (error) {
            console.error('Error parsing National Grid PDF:', error);
            return null;
        } finally {
            if (parser && parser.destroy) {
                await parser.destroy();
            }
        }
    }

    /**
     * Parses a Sunrun bill PDF buffer.
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, production: number, cost: number}|null>}
     */
    async parseSunrun(buffer) {
        let parser = null;
        try {
            parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text;

            // 1. Extract Date
            // Pattern: "Billing Period Oct 15 - Nov 14"
            // We want the end date (Nov 14). We need to infer the year.
            // The Due Date usually contains the correct year for the END of the period, or the next year.
            // Let's first get the Due Date to know the "Bill Year" context.
            const dueDateRegex = /Due\s+Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
            const dueMatch = text.match(dueDateRegex);
            let dueYear = new Date().getFullYear();
            if (dueMatch) {
                dueYear = parseInt(dueMatch[1].split('/')[2]);
            }

            // Now find Billing Period
            const billingMatch = text.match(/Billing\s+Period\s+[A-Za-z]{3}\s+\d{1,2}\s*-\s*([A-Za-z]{3})\s+(\d{1,2})/i);
            let dateStr = null;

            if (billingMatch) {
                const monthStr = billingMatch[1]; // e.g. "Nov"
                const dayStr = billingMatch[2];   // e.g. "14"
                
                const monthMap = {
                    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                };
                const m = monthMap[monthStr];
                const d = dayStr.padStart(2, '0');
                
                // Determine year. If Due Year is 2025 and Billing End Month is Nov, it's likely 2025.
                // If Due Year is 2026 (Jan) and Billing End Month is Dec, it's 2025.
                // If Due Year is 2025 and Billing End Month is Jan, it's 2025.
                // Simple heuristic: If Billing Month > Due Month (and Due Month is Jan/Feb), subtract 1 from Due Year.
                // Actually, simpler: The bill usually comes out shortly after the period ends.
                // The Due Date is ~30 days after.
                // Let's use the Due Date Year, but if the Billing Month is Dec and Due Month is Jan, use Year-1.
                
                let year = dueYear;
                const dueMonth = dueMatch ? parseInt(dueMatch[1].split('/')[0]) : 1;
                
                if (monthStr === 'Dec' && dueMonth === 1) {
                    year = dueYear - 1;
                }
                
                dateStr = `${year}-${m}-${d}`;
            } else {
                // Fallback to Due Date if Billing Period not found (though less accurate for alignment)
                // Or try "Bill Date"
                if (dueMatch) {
                     const [m, d, y] = dueMatch[1].split('/');
                     // Shift back 1 month as a rough approximation if we have to? 
                     // No, let's just use it but warn.
                     // Actually, better to try "Bill Date" first.
                     const billDateMatch = text.match(/Bill\s+Date[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
                     if (billDateMatch) {
                        const [bm, bd, by] = billDateMatch[1].split('/');
                        dateStr = `${by}-${bm.padStart(2, '0')}-${bd.padStart(2, '0')}`;
                     } else {
                        dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                     }
                }
            }

            // 2. Extract Cost
            // Pattern: "Total Due 12/14/2025 $153.28" or "Monthly Charge $153.28"
            let cost = 0;
            const totalDueMatch = text.match(/Total\s+Due[\s\S]*?\$([\d,]+\.\d{2})/i);
            if (totalDueMatch) {
                cost = parseFloat(totalDueMatch[1].replace(/,/g, ''));
            } else {
                const monthlyChargeMatch = text.match(/Monthly\s+Charge\s*\$([\d,]+\.\d{2})/i);
                if (monthlyChargeMatch) {
                    cost = parseFloat(monthlyChargeMatch[1].replace(/,/g, ''));
                }
            }

            // 3. Extract Production (kWh)
            // Pattern: "Electricity Produced in ... 479 kWh"
            const prodMatch = text.match(/Electricity\s+Produced[\s\S]*?(\d+)\s*kWh/i);
            let production = 0;
            if (prodMatch) {
                production = parseFloat(prodMatch[1].replace(/,/g, ''));
            }

            if (!dateStr) {
                // console.warn('⚠️ Could not parse date from Sunrun bill');
                return null;
            }

            return { date: dateStr, production, cost, type: 'Sunrun' };

        } catch (error) {
            console.error('Error parsing Sunrun PDF:', error);
            return null;
        } finally {
            if (parser && parser.destroy) {
                await parser.destroy();
            }
        }
    }

    /**
     * Parses an Eversource Gas bill PDF buffer.
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, therms: number, cost: number}|null>}
     */
    async parseEversource(buffer) {
        let parser = null;
        try {
            parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text;

            // 1. Extract Date
            // Pattern: "Statement Date: 12/02/24"
            const dateMatch = text.match(/Statement\s+Date:\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
            let dateStr = null;
            if (dateMatch) {
                const parts = dateMatch[1].split('/');
                const m = parts[0].padStart(2, '0');
                const d = parts[1].padStart(2, '0');
                let y = parts[2];
                if (y.length === 2) y = '20' + y;
                dateStr = `${y}-${m}-${d}`;
            }

            // 2. Extract Cost
            // Pattern: "Total Amount Due $35.82"
            // Note: It appears multiple times, we just need one valid one.
            const costMatch = text.match(/Total\s+Amount\s+Due\s*\$([\d,]+\.\d{2})/i);
            let cost = 0;
            if (costMatch) {
                cost = parseFloat(costMatch[1].replace(/,/g, ''));
            }

            // 3. Extract Therms
            // Pattern: "= 11 Therms Billed Usage"
            const thermsMatch = text.match(/=\s*([\d,]+)\s*Therms\s+Billed\s+Usage/i);
            let therms = 0;
            if (thermsMatch) {
                therms = parseFloat(thermsMatch[1].replace(/,/g, ''));
            }

            if (!dateStr) return null;

            return { date: dateStr, therms, cost, type: 'Eversource' };

        } catch (error) {
            console.error('Error parsing Eversource PDF:', error);
            return null;
        } finally {
            if (parser && parser.destroy) {
                await parser.destroy();
            }
        }
    }
}
