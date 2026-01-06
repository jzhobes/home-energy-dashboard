import { google } from 'googleapis';

export default class DriveClient {
  constructor(auth) {
    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Lists files in a specific folder.
   *
   * @param {string} folderName - Name of the folder to search for.
   * @returns {Promise<Array>} - List of files.
   */
  async listFiles(folderName) {
    // First, find the folder ID
    const folderId = await this.findFolderId(folderName);
    if (!folderId) {
      console.error(`❌ Folder not found: ${folderName}`);
      return [];
    }

    console.log(`📂 Found folder "${folderName}" (ID: ${folderId})`);

    let files = [];
    let pageToken = null;

    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime)',
        spaces: 'drive',
        pageToken: pageToken,
      });

      files = files.concat(res.data.files);
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
  }

  /**
   * Finds the ID of a folder by name.
   *
   * @param {string} folderName
   * @returns {Promise<string|null>}
   */
  async findFolderId(folderName) {
    // Handle nested paths like "Home/National Grid Bills"
    const parts = folderName.split('/');
    let parentId = 'root';

    for (const part of parts) {
      const q = `mimeType='application/vnd.google-apps.folder' and name='${part}' and '${parentId}' in parents and trashed=false`;
      const res = await this.drive.files.list({
        q: q,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (res.data.files.length === 0) {
        return null;
      }
      parentId = res.data.files[0].id;
    }
    return parentId;
  }

  /**
   * Downloads a file's content.
   *
   * @param {string} fileId
   * @returns {Promise<Buffer>}
   */
  async getFile(fileId) {
    const res = await this.drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
      },
      { responseType: 'arraybuffer' }
    );

    return Buffer.from(res.data);
  }
}
