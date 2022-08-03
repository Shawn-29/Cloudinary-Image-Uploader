const Uploader = require('./uploader');

const { EOL } = require('os');

const { open, readdir } = require('fs/promises');

const ImageValidator = require('./image_validation');

const { VALID, INVALID } = ImageValidator.VALIDATION_RESULTS;

const asyncFilter = require('./async_filter');

const {
    FileError,
    FileOpenError,
    ServerResponseError
} = require('./errors');

const {
    BAD_REQUEST,
    NOT_FOUND,
    CONFLICT
} = require('http-status-codes').StatusCodes;

const EventEmitter = require('events');

const wait = require('timers/promises').setTimeout;

const CloudinaryUploader = class extends EventEmitter {
    /** @type {Uploader} */
    #uploader;

    static UPLOAD_SUCCESS = Symbol('upload success');

    static UPLOAD_ERROR = Symbol('upload error');

    static UPLOAD_CRITICAL = Symbol('upload error');

    /* internal use only */
    static #END_WRITE = Symbol('end write');

    /**
     * @param {Object} configParams - Parameters to establish a Cloudinary connection.
     * 
     * @param {string} configParams.apiKey - Your Cloudinary API key.
     * 
     * @param {string} configParams.apiSecret - Your Cloudinary API secret.
     * 
     * @param {string} configParams.cloudName - Your Cloudinary cloud name.
     */
    constructor(
        configParams
    ) {
        super();
        this.#uploader = new Uploader(
            configParams.apiKey,
            configParams.apiSecret,
            configParams.cloudName
        );
    }
    /**
     * @callback successListener
     * 
     * @param {string} pathname - Pathname of file being uploaded.
     * 
     * @param {{}} response - Object containing response data from the server.
     */
    /**
     * Adds an event listener to respond to a successful upload event.
     * 
     * @param {successListener} listener
     * 
     * @returns {this}
     */
    onUploadSuccess(listener) {
        return this.on(CloudinaryUploader.UPLOAD_SUCCESS, listener);
    }
    /**
     * @callback errorListener
     * 
     * @param {string} pathname - Pathname of file being uploaded.
     * 
     * @param {string} message - Message describing the error.
     */
    /**
     * Adds an event listener to respond to an unsuccessful upload event.
     * 
     * @param {errorListener} listener
     * 
     * @returns {this}
     */
    onUploadError(listener) {
        return this.on(CloudinaryUploader.UPLOAD_ERROR, listener);
    }
    /**
     * Adds an event listener to respond to a critical error upload event.
     * 
     * @param {errorListener} listener
     * 
     * @returns {this}
     */
    onCriticalError(listener) {
        return this.on(CloudinaryUploader.UPLOAD_CRITICAL, listener);
    }
    /**
     * Asynchronously upload one or more files to Cloudinary.
     * 
     * @param {Object} uploadOptions
     * 
     * @param {string} uploadOptions.imgDir - Directory of images to upload.
     * 
     * @param {string[]|null} uploadOptions.specificFiles - Array of specific filenames to upload from the specified image directory.
     * If not provided, all files contained in the image directory will be uploaded. If files originate from different
     * directories, provide an empty string for the image directory.
     * 
     * @param {Object} uploadOptions.errorOptions
     * 
     * @param {string|undefined} uploadOptions.errorOptions.errorFilename - Optional filename of file to store filenames of failed uploads.
     * 
     * @param {string} uploadOptions.errorOptions.lineSep - Line separator used between entries when writing to the error file.
     * 
     * @param {number} uploadOptions.errorOptions.timeout - Milliseconds before the upload process is canceled. Increase the duration if
     * large files are causing a timeout to occur.
     * 
     * @param {boolean} uploadOptions.errorOptions.overwrite - Overwrites the contents of the error file. If false, an error will be thrown
     * if the file already exists.
     * 
     * @param {{}} uploadOptions.optionalParams - Optional Cloudinary API upload options;
     * see https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
     * for a complete list.
     * 
     * @param {string[]} uploadOptions.allowedFileTypes - Types of files to upload. Example: ['png', jpg'].
     * 
     * @returns {Promise<void>}
     */
    async upload({
        imgDir = '',
        specificFiles = null,
        errorOptions = {},
        optionalParams = {},
        allowedFileTypes = []
    } = {}) {

        /* create a file to write upload errors to if needed */
        const errorFileHandle = typeof errorOptions?.errorFilename === 'string' ?
            await open(errorOptions.errorFilename, errorOptions.overwrite ? 'w' : 'wx') :
            null;

        const lineSep = typeof errorOptions?.lineSep === 'undefined' ?
            EOL : String(errorOptions.lineSep);

        let writeCount = 0;

        const logError = async msg => {
            ++writeCount;
            await (errorFileHandle?.appendFile(msg, 'utf-8'))
                .then(_ => {
                    if (--writeCount === 0) {
                        this.emit(CloudinaryUploader.#END_WRITE);
                    }
                });
        };

        const ignoreFileExistCheck = !!optionalParams.overwrite;

        const validator = new ImageValidator(allowedFileTypes);

        /* get an array of image filenames to upload to Cloudinary */
        const filenames = await asyncFilter(

            /* check if the user only wants specific files uploaded or all of those
                contained in the specified image directory */
            Array.isArray(specificFiles) ? specificFiles : (await readdir(imgDir)),

            /* filter-out invalid files or those that already exist on the server */
            async f => {

                const pathname = imgDir + f;

                /* perform basic client-side file validation */
                const imgRes = await validator.isValidImage(pathname)
                    .catch(async error => {
                        this.emit(CloudinaryUploader.UPLOAD_ERROR, pathname, error.toString());
                        await logError(error.toString() + lineSep);
                    });

                /* log this file if it is invalid */
                if (imgRes === INVALID) {
                    const errorMsg = `Failed to upload "${pathname}": file is invalid.`;
                    this.emit(CloudinaryUploader.UPLOAD_ERROR, pathname, errorMsg);
                    await logError(errorMsg + lineSep);
                }

                return imgRes === VALID &&
                    /* check for image existence on the server if required */
                    (
                        ignoreFileExistCheck ||
                        !await this.#uploader.checkExists(f, {
                            ...apiOptions
                        })
                    );
            });

        const uploadController = new AbortController();

        await this.#uploader.bulkUpload({
            filenames,
            imgDir,
            timeout: errorOptions.timeout,
            optionalParams,
            signal: uploadController.signal,
            callback: async (fileURL, response, error) => {
                // console.log(fileURL, response, String(error));
                if (error && !uploadController.signal.aborted) {
                    if (CloudinaryUploader.#isCriticalError(error)) {
                        /* signal that a critical error occurred */
                        uploadController.abort();
                        this.emit(CloudinaryUploader.UPLOAD_CRITICAL, fileURL, error);
                        await logError(`Aborting upload process due to critical error: ${error.toString()}`);
                    }
                    else {
                        this.emit(CloudinaryUploader.UPLOAD_ERROR, fileURL, error);
                        await logError(error.toString() + lineSep);
                    }
                }
                else {
                    this.emit(CloudinaryUploader.UPLOAD_SUCCESS, fileURL, response);
                }
            }
        })
            .then(async () => {
                /* check if files are still being written */
                if (writeCount > 0) {
                    /* wait to finish writing before closing the error file */
                    await new Promise((resolve) => {
                        this.once(CloudinaryUploader.#END_WRITE, () => {
                            resolve();
                        });
                    });
                }
            });

        await errorFileHandle?.close();
    }
    /**
     * Tests the connection to the Cloudinary API. Note that this request is rate-limited.
     * 
     * @returns {Promise<import('./uploader').pingResult>}
     */
    async ping() {
        return this.#uploader.ping();
    }
    /**
     * Evaluates if an error is critical in severity and should stop the upload process.
     * 
     * @param {FileError} error
     * 
     * @returns {boolean}
     */
    static #isCriticalError = error => {
        /* a single file couldn't be opened (non-critical error) */
        if (error instanceof FileOpenError) {
            return false;
        }
        /* the server responded with an error (might be critical) */
        else if (error instanceof ServerResponseError) {
            switch (error.httpCode) {
                /* non-critical error codes that correspond to a single file */
                case BAD_REQUEST:
                case NOT_FOUND:
                case CONFLICT:
                    return false;
            }
        }
        /* the error is unrecognized, but could include the user not having given proper
            credentials (unauthorized), a timeout, or disconnection;
            consider this error critical */
        return true;
    };
};

module.exports = CloudinaryUploader;