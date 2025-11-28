export default class BillParser {
    constructor() {
        this.parsers = {};
    }

    /**
     * Generic parse method that lazy loads the appropriate parser.
     *
     * @param {string} type - 'NationalGrid', 'Sunrun', or 'Eversource'
     * @param {Buffer} buffer - PDF file buffer
     * @returns {Promise<Object|null>}
     */
    async parse(type, buffer) {
        if (!this.parsers[type]) {
            await this.loadParser(type);
        }

        const parser = this.parsers[type];
        if (!parser) {
            throw new Error(`No parser found for type: ${type}`);
        }

        return parser.parse(buffer);
    }

    async loadParser(type) {
        switch (type) {
            case 'NationalGrid': {
                const { default: NationalGridParser } = await import('./parsers/NationalGridParser.js');
                this.parsers[type] = new NationalGridParser();
                break;
            }
            case 'Sunrun': {
                const { default: SunrunParser } = await import('./parsers/SunrunParser.js');
                this.parsers[type] = new SunrunParser();
                break;
            }
            case 'Eversource': {
                const { default: EversourceParser } = await import('./parsers/EversourceParser.js');
                this.parsers[type] = new EversourceParser();
                break;
            }
            default:
                throw new Error(`Unknown parser type: ${type}`);
        }
    }
}
