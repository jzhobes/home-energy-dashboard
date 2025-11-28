import 'dotenv/config';
import { google } from 'googleapis';
import DriveClient from './DriveClient.js';

async function main() {
    const { GMAIL_OAUTH_CREDENTIALS } = process.env;
    if (!GMAIL_OAUTH_CREDENTIALS) {
        console.error('❌ GMAIL_OAUTH_CREDENTIALS not found in .env');
        process.exit(1);
    }

    const { client_id, client_secret, refresh_token } = JSON.parse(GMAIL_OAUTH_CREDENTIALS);
    const auth = new google.auth.OAuth2(client_id, client_secret);
    auth.setCredentials({ refresh_token });

    const driveClient = new DriveClient(auth);

    console.log('🔍 Verifying "Home/National Grid Bills"...');
    const ngFiles = await driveClient.listFiles('Home/National Grid Bills');
    console.log(`📄 Found ${ngFiles.length} files in "Home/National Grid Bills"`);

    if (ngFiles.length === 0) {
        console.log('⚠️ Checking "House/National Grid Bills" instead...');
        const houseNgFiles = await driveClient.listFiles('House/National Grid Bills');
        console.log(`📄 Found ${houseNgFiles.length} files in "House/National Grid Bills"`);
    }

    console.log('\n🔍 Verifying "Home/Sunrun Bills"...');
    const sunrunFiles = await driveClient.listFiles('Home/Sunrun Bills');
    console.log(`📄 Found ${sunrunFiles.length} files in "Home/Sunrun Bills"`);
    
    if (sunrunFiles.length === 0) {
        console.log('⚠️ Checking "House/Sunrun Bills" instead...');
        const houseSunrunFiles = await driveClient.listFiles('House/Sunrun Bills');
        console.log(`📄 Found ${houseSunrunFiles.length} files in "House/Sunrun Bills"`);
    }
}

main().catch(console.error);
