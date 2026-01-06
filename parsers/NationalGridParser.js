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

      // Extract Date
      // Regex to match "BILLING PERIOD ... Mon DD, YYYY to Mon DD, YYYY"
      // Handles cases where "PAGE X of Y" or newlines appear between BILLING PERIOD and dates
      const dateMatch = text.match(
        /BILLING PERIOD[\s\S]*?([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/i
      );
      let dateStr = null;
      let startDateStr = null;
      let endDateStr = null;

      if (dateMatch) {
        startDateStr = new Date(dateMatch[1]).toISOString().split('T')[0];
        endDateStr = new Date(dateMatch[2]).toISOString().split('T')[0];
        dateStr = endDateStr; // Use end date as the primary date for the bill
      } else {
        // Fallback for older formats or if regex fails (try just the 'to' date)
        const fallbackMatch = text.match(
          /BILLING PERIOD[\s\S]*?to\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/i
        );
        if (fallbackMatch) {
          dateStr = new Date(fallbackMatch[1]).toISOString().split('T')[0];
          endDateStr = dateStr;
        }
      }

      // Extract Cost
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

      // Extract Usage Data
      let netUsage = 0;
      let genUsage = 0;

      // Extract Net Usage (Delivery Services)
      const netUsageMatch = text.match(
        /Delivery\s+Services[\s\S]*?Total\s+Usage[\s\S]*?([-\d,]+)\s*kWh/i
      );
      if (netUsageMatch) {
        netUsage = parseFloat(netUsageMatch[1].replace(/,/g, ''));
      }

      // Extract Generation Usage (SMART Program)
      const genUsageMatch = text.match(
        /MA\s+SMART\s+Incentive\s+Program[\s\S]*?Energy[\s\S]*?([-\d,]+)\s*kWh/i
      );
      if (genUsageMatch) {
        genUsage = Math.abs(parseFloat(genUsageMatch[1].replace(/,/g, ''))); // Store as positive production
      }

      // Map to legacy fields for compatibility, but prefer new fields
      const usage = netUsage > 0 ? netUsage : 0; // Import
      const exported = netUsage < 0 ? Math.abs(netUsage) : 0; // Export

      // Extract Credit Balance
      let credit = 0;
      const creditMatch = text.match(/Credit\s+Balance\s*-\$\s*([\d,]+\.\d{2})/i);
      if (creditMatch) {
        credit = parseFloat(creditMatch[1].replace(/,/g, ''));
      }

      return {
        date: dateStr,
        startDate: startDateStr,
        endDate: endDateStr,
        usage, // Imported from Grid
        exported, // Sent to Grid (Net)
        production: genUsage, // Total Solar Generation (from NG meter)
        cost,
        credit,
        type: 'NationalGrid',
      };
    } catch (e) {
      console.error('Error parsing National Grid PDF:', e);
      return null;
    } finally {
      await parser?.destroy?.();
    }
  }
}
