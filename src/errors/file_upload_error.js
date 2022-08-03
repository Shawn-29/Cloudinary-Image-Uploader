const FileError = require('./file_error');

/**
 * Error class for file upload failures.
 */
const FileUploadError = class extends FileError {
    /**
     * @param {string} message
     * 
     * @param {string} pathname
     */
    constructor(message, pathname) {
        super(message, pathname);
    }
    toString() {
        return `Failed to upload "${this.pathname}": ${this.message}`;
    }
};

module.exports = FileUploadError;