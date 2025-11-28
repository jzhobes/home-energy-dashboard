import { PDFParse } from 'pdf-parse';

export default class EversourceParser {
    /**
     * Parses an Eversource Gas bill PDF buffer.
     *
     * @param {Buffer} buffer 
     * @returns {Promise<{date: string, therms: number, cost: number}|null>}
     */
    async parse(buffer) {
        let parser = null;
        try {
            parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text;

            // 1. Extract Date
            const dateMatch = text.match(/Statement\s+Date:\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
            let dateStr = null;
            if (dateMatch) {
                const parts = dateMatch[1].split('/');
                const m = parts[0].padStart(2, '0');
                const d = parts[1].padStart(2, '0');
                let y = parts[2];
                if (y.length === 2) {
                    y = '20' + y;
                }
                dateStr = `${y}-${m}-${d}`;
            }

            // 2. Extract Cost
            const costMatch = text.match(/Total\s+Amount\s+Due\s*\$([\d,]+\.\d{2})/i);
            let cost = 0;
            if (costMatch) {
                cost = parseFloat(costMatch[1].replace(/,/g, ''));
            }

            // 3. Extract Therms
            const thermsMatch = text.match(/=\s*([\d,]+)\s*Therms\s+Billed\s+Usage/i);
            let therms = 0;
            if (thermsMatch) {
                therms = parseFloat(thermsMatch[1].replace(/,/g, ''));
            }

            if (!dateStr) {
                return null;
            }

            return { date: dateStr, therms, cost, type: 'Eversource' };

        } catch (error) {
            console.error('Error parsing Eversource PDF:', error);
            return null;
        } finally {
            await parser?.destroy?.();
        }
    }
}
