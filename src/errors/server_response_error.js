const FileUploadError = require('./file_upload_error');

/**
 * Error class for server error responses.
 */
const ServerResponseError = class extends FileUploadError {
    /**
     * @param {string} message
     * 
     * @param {string} pathname
     * 
     * @param {number} httpCode
     */
    constructor(message, pathname, httpCode) {
        super(message, pathname);
        this.httpCode = httpCode;
    }
};

module.exports = ServerResponseError;