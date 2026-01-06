# Home Energy Dashboard ⚡🏠

A personal dashboard to analyze and visualize household energy usage and costs, integrating data from:

- **National Grid** (Electricity)
- **Sunrun** (Solar Production)
- **Eversource** (Gas)

## Features

- **Total Energy Wallet:** Visualizes combined spending across all utilities.
- **Heating Analysis:** Tracks the shift from Gas to Electric heating (Mini-splits).
- **Solar ROI:** Calculates "True Consumption", "Self-Use", and "Effective Rate" ($/kWh).
- **Net Zero Tracker:** Monitors if you are producing more energy than you consume.
- **Solar Utilization:** Break down of where your solar energy goes (Home vs. Grid).
- **Credit Bank:** Tracks your rolling net metering credit balance with National Grid.
- **Daily Data Sync:** Integrates with Sunrun API for precise daily production data.

## Setup

1.  **Prerequisites:** Node.js installed.
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Environment Variables:**
    Create a `.env` file in the root directory with your Google OAuth and Sunrun credentials:
    ```env
    GMAIL_OAUTH_CREDENTIALS={"client_id":"...","client_secret":"...","refresh_token":"..."}
    SUNRUN_CREDENTIALS={"auth_token":"...","refresh_token":"..."}
    GOOGLE_DRIVE_FOLDER_ELECTRIC=House/National Grid Bills
    GOOGLE_DRIVE_FOLDER_SOLAR=House/Sunrun Bills
    GOOGLE_DRIVE_FOLDER_GAS=House/Eversource Gas Bills
    ```
4.  **Google Drive Structure:**
    Ensure your Google Drive has the folders matching the paths in your `.env` file.

## Usage

Run the analysis script to generate the dashboard:

```bash
npm start
```

This will:

1.  Sync daily solar production data from the Sunrun API.
2.  Fetch the latest bills from Google Drive.
3.  Parse and aggregate all data.
4.  Generate a local HTML report: `index.html`

> **Note:** The first run will take some time to download and parse all PDFs. Subsequent runs will be instant thanks to the local cache (`.bill_cache.json` and `.sunrun_daily_cache.json`).

Open `index.html` in your browser to view your dashboard.
