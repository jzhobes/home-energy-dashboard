import { PDFParse } from 'pdf-parse';

export default class SunrunParser {
    /**
     * Parses a Sunrun bill PDF buffer.
     *
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, production: number, cost: number}|null>}
     */
    async parse(buffer) {
        let parser = null;
        try {
            parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text;

            // 1. Extract Date
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

                let year = dueYear;
                const dueMonth = dueMatch ? parseInt(dueMatch[1].split('/')[0]) : 1;

                if (monthStr === 'Dec' && dueMonth === 1) {
                    year = dueYear - 1;
                }

                dateStr = `${year}-${m}-${d}`;
            } else {
                if (dueMatch) {
                    const [m, d, y] = dueMatch[1].split('/');
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
            const prodMatch = text.match(/Electricity\s+Produced[\s\S]*?([\d,]+)\s*kWh/i);
            let production = 0;
            if (prodMatch) {
                production = parseFloat(prodMatch[1].replace(/,/g, ''));
            }

            if (!dateStr) {
                return null;
            }

            return { date: dateStr, production, cost, type: 'Sunrun' };

        } catch (error) {
            console.error('Error parsing Sunrun PDF:', error);
            return null;
        } finally {
            await parser?.destroy?.();
        }
    }
}
