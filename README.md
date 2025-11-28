# Home Energy Dashboard ⚡🏠

A personal dashboard to analyze and visualize household energy usage and costs, integrating data from:
*   **National Grid** (Electricity)
*   **Sunrun** (Solar Production)
*   **Eversource** (Gas)

## Features
*   **Total Energy Wallet:** Visualizes combined spending across all utilities.
*   **Heating Analysis:** Tracks the shift from Gas to Electric heating (Mini-splits).
*   **Solar ROI:** Calculates "True Consumption", "Self-Use", and "Effective Rate" ($/kWh).
*   **Net Zero Tracker:** Monitors if you are producing more energy than you consume.

## Setup

1.  **Prerequisites:** Node.js installed.
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Environment Variables:**
    Create a `.env` file in the root directory with your Google OAuth credentials:
    ```env
    GMAIL_OAUTH_CREDENTIALS={"client_id":"...","client_secret":"...","refresh_token":"..."}
    ```
4.  **Google Drive Structure:**
    Ensure your Google Drive has the following folder structure:
    *   `House/National Grid Bills`
    *   `House/Sunrun Bills`
    *   `House/Eversource Gas Bills`

## Usage

Run the analysis script to generate the dashboard:

```bash
npm start
```

This will fetch the latest bills from Google Drive, parse them, and generate a local HTML report:
`energyDashboard.html`

Open this file in your browser to view your dashboard.

## Privacy
The generated `energyDashboard.html` contains sensitive financial and usage data and is **ignored** by git. Do not commit it to a public repository.
