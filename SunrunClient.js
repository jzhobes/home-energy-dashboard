import 'dotenv/config';

export default class SunrunClient {
  constructor() {
    const { SUNRUN_CREDENTIALS } = process.env;
    if (!SUNRUN_CREDENTIALS) {
      throw new Error('SUNRUN_CREDENTIALS not found in .env');
    }

    let creds;
    try {
      creds = JSON.parse(SUNRUN_CREDENTIALS);
    } catch (e) {
      console.error('Error parsing SUNRUN_CREDENTIALS:', e);
      throw new Error('Failed to parse SUNRUN_CREDENTIALS JSON', { cause: e });
    }

    this.authToken = creds.auth_token;
    this.refreshToken = creds.refresh_token;
    this.prospectId = null;
    this.sunrunStart = null;
  }

  /**
   * Initializes the client by fetching user details to get prospectId and start date.
   */
  async init() {
    console.log('🔌 Connecting to Sunrun API...');
    const response = await fetch('https://gateway.sunrun.com/portal-auth/get-user', {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        Refreshtoken: this.refreshToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Extract prospect_id and sunrunStart
    const opportunity = data.opportunitiesWithContracts?.[0];
    if (!opportunity) {
      throw new Error('No opportunities found in Sunrun account.');
    }

    this.prospectId = opportunity.prospect_id;
    this.sunrunStart = opportunity.contract?.sunrunStart;

    if (!this.prospectId || !this.sunrunStart) {
      throw new Error('Could not find prospect_id or sunrunStart in account data.');
    }

    console.log(
      `✅ Sunrun Client Ready. Prospect ID: ${this.prospectId}, System Start: ${this.sunrunStart}`
    );
  }

  /**
   * Fetches daily production data for a given date range.
   *
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Array<{date: string, production: number}>>}
   */
  async getDailyProduction(startDate, endDate) {
    // Format: <YYYY-MM-DD>T00:00:00.000-04:00
    const startParam = `${startDate}T00:00:00.000-04:00`;
    const endParam = `${endDate}T00:00:00.000-04:00`;

    const url = `https://gateway.sunrun.com/performance-api/v1/site-production-daily/${this.prospectId}?startDate=${startParam}&endDate=${endParam}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        Refreshtoken: this.refreshToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch production: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      console.warn('Unexpected API response format (not an array):', data);
      return [];
    }

    return data.map((item) => ({
      date: item.date || item.timestamp?.split('T')[0], // Fallback if date key varies
      production: item.systemProduction || 0,
    }));
  }
}
