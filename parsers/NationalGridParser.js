import { PDFParse } from 'pdf-parse';

export default class NationalGridParser {
    /**
     * Parses a National Grid bill PDF buffer.
     *
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, usage: number, cost: number, exported: number, credit: number}|null>}
     */
    async parse(buffer) {
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
            let netUsage = 0;
            let genUsage = 0;

            // A. Extract Net Usage (Delivery Services)
            const netUsageMatch = text.match(/Delivery\s+Services[\s\S]*?Total\s+Usage[\s\S]*?([-\d,]+)\s*kWh/i);
            if (netUsageMatch) {
                netUsage = parseFloat(netUsageMatch[1].replace(/,/g, ''));
            }

            // B. Extract Generation Usage (SMART Program)
            const genUsageMatch = text.match(/MA\s+SMART\s+Incentive\s+Program[\s\S]*?Energy[\s\S]*?([-\d,]+)\s*kWh/i);
            if (genUsageMatch) {
                genUsage = Math.abs(parseFloat(genUsageMatch[1].replace(/,/g, ''))); // Store as positive production
            }

            // Map to legacy fields for compatibility, but prefer new fields
            const usage = netUsage > 0 ? netUsage : 0; // Import
            const exported = netUsage < 0 ? Math.abs(netUsage) : 0; // Export

            // 4. Extract Credit Balance
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
        } catch (error) {
            console.error('Error parsing National Grid PDF:', error);
            return null;
        } finally {
            await parser?.destroy?.();
        }
    }
}
