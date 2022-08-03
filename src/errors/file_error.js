/**
 * Base file error class.
 */
const FileError = class extends Error {
    /**
     * @param {string} message
     * 
     * @param {string} pathname
     */
    constructor(message, pathname) {
        super(message);
        this.pathname = pathname;
    }
};

module.exports = FileError;