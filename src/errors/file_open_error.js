const FileError = require('./file_error');

/**
 * Error class for file open failures.
 */
const FileOpenError = class extends FileError {
    /**
     * @param {string} message
     * 
     * @param {string} pathname
     */
    constructor(message, pathname) {
        super(message, pathname);
    }
    toString() {
        return `Failed to open "${this.pathname}": ${this.message}`;
    }
};

module.exports = FileOpenError;