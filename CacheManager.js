import fs from 'fs';
import path from 'path';

export default class CacheManager {
    constructor(cacheFile = '.bill_cache.json') {
        this.cachePath = path.join(process.cwd(), cacheFile);
        this.cache = {};
        this.load();
    }

    /**
     * Loads the cache from disk.
     */
    load() {
        if (fs.existsSync(this.cachePath)) {
            try {
                const data = fs.readFileSync(this.cachePath, 'utf8');
                this.cache = JSON.parse(data);
                console.log(`📦 Loaded ${Object.keys(this.cache).length} items from cache.`);
            } catch (e) {
                console.error('⚠️ Failed to load cache:', e.message);
                this.cache = {};
            }
        }
    }

    /**
     * Saves the cache to disk.
     */
    save() {
        try {
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
            console.log('📦 Cache saved.');
        } catch (e) {
            console.error('⚠️ Failed to save cache:', e.message);
        }
    }

    /**
     * Retrieves an item from the cache.
     *
     * @param {string} fileId - The ID of the file to retrieve.
     * @returns {Object|undefined} - The cached data or undefined if not found.
     */
    get(fileId) {
        return this.cache[fileId];
    }

    /**
     * Adds an item to the cache.
     *
     * @param {string} fileId - The ID of the file.
     * @param {Object} data - The data to cache.
     */
    set(fileId, data) {
        this.cache[fileId] = data;
    }
}
