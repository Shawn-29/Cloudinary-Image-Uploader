const { default: axios } = require('axios');

const crypto = require('crypto');

const { createReadStream } = require('fs');

const FormData = require('form-data');

const { stat } = require('fs/promises');

const {
    FileOpenError,
    FileUploadError,
    ServerResponseError
} = require('./errors');

/* maximum number of concurrent upload requests allowed by Cloudinary */
const MAX_CONCURRENT_UPLOADS = 10;

/* file chunk upload size in bytes */
const CHUNK_UPLOAD_SIZE = 5000000;

/**
 * @typedef {Object} pingResult - Result of a ping to Cloudinary's server.
 * 
 * @property {boolean} success - Whether the ping succeeded or not.
 * 
 * @property {string} info - Information regarding the result of the ping.
 */

const Uploader = class {
    /**
     * @param {string} apiKey
     * 
     * @param {string} apiSecret 
     * 
     * @param {string} cloudName
     */
    constructor(apiKey, apiSecret, cloudName) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.cloudName = cloudName;
    }
    /**
     * Generates a valid Cloudinary signature to accompany an upload.
     * 
     * @param {{}} optionalParams - Optional Cloudinary API upload options;
     * see https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
     * for a complete list.
     * 
     * @returns {string}
     */
    generateSignature(optionalParams) {
        const paramsToSign = Object.entries(optionalParams)
            .filter(p => String(p).length > 0)
            .map(([k, v]) => `${k}=${[v].join(",")}`)
            .sort()
            .join("&");
        return crypto.createHash('sha256')
            .update(paramsToSign + this.apiSecret, 'binary')
            .digest('hex');
    }
    /**
     * Check whether a file exists on Cloudinary's server.
     * 
     * @param {string} filename - The file to check.
     * 
     * @param {Object} options
     * 
     * @param {string} options.folder - File's folder location on the server.
     * 
     * @param {string} options.format - File's image format. Uses the file's actual format
     * if not specified. Specifying a format is useful when checking if the file already
     * exists on the server albeit under a different file format.
     * 
     * @returns {Promise<boolean>}
     */
    async checkExists(filename, { folder = null, format = null }) {

        /* if no image format is supplied use the one from the filename */
        const nameToCheck = typeof format === 'string' ?
            filename.substring(0, filename.lastIndexOf('.') + 1) + format :
            filename;

        /* construct the URL that the file could be located at */
        const url = [
            'https://res.cloudinary.com',
            this.cloudName,
            'image/upload',
            folder,
            nameToCheck
        ].filter(val => String(val).length > 0).join('/');

        return await axios.head(url)
            .then(_ => true)
            .catch(_ => false);
    }
    /**
     * Tests the connection to the Cloudinary API.
     * @returns {Promise<pingResult>}
     */
    async ping() {
        return axios.head(`https://${this.apiKey}:${this.apiSecret}@api.cloudinary.com/v1_1/${this.cloudName}/ping`)
            .then(response => {
                const headers = response.headers;
                return {
                    success: true,
                    /* pinging Cloudinary's servers counts towards as a rate-limited request so
                        return info regarding how many requests are still available */
                    info: `remain: ${headers['x-featureratelimit-remaining']} ` +
                        `limit: ${headers['x-featureratelimit-limit']} ` +
                        `reset: ${headers['x-featureratelimit-reset']}`
                }
            })
            .catch(error => {
                return {
                    success: false,
                    info: error.message
                };
            });
    }
    /**
     * Upload a file, in chunks, to Cloudinary.
     * 
     * @param {string} url - The location of the resource to upload.
     * 
     * @param {Object} options
     * 
     * @param {number} options.timeout - Milliseconds before the upload process is canceled.
     * 
     * @param {{}} options.optionalParams - Optional Cloudinary API upload options;
     * see https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
     * for a complete list.
     * 
     * @param {AbortSignal|null} options.signal - If provided and an abort event is emitted, the
     * upload process will be canceled.
     * 
     * @returns {Promise<import('axios').AxiosResponse<any, any>>}
     */
    async chunkUpload(
        url,
        {
            timeout = 120000,
            optionalParams = {},
            signal = null
        } = {}
    ) {
        return new Promise(async (resolve, reject) => {

            const XUniqueUploadId = +new Date();

            /* the start and end byte offset of each chunk */
            let start = 0;
            let end = 0;

            let fileSize = 0;

            createReadStream(url, {
                highWaterMark: CHUNK_UPLOAD_SIZE
            })
                .on('error', (error) => {
                    reject(new FileOpenError(error.message, url));
                })
                .on('open', async () => {
                    fileSize = (await stat(url)).size;
                })
                .on('data', async (chunk) => {

                    start = end;
                    end += chunk.byteLength;

                    // console.log("start ", start);
                    // console.log("end", end);

                    const timestamp = Math.round((new Date).getTime() / 1000);

                    const optionsCopy = { timestamp, ...optionalParams };

                    /* the resource type can't be included in the signature so
                        remove it from the options before creating a signature */
                    delete optionsCopy.resource_type;

                    const signature = this.generateSignature(optionsCopy);

                    const formdata = new FormData();
                    formdata.append('file', chunk, url);
                    formdata.append('api_key', this.apiKey);
                    formdata.append('timestamp', timestamp);
                    formdata.append('signature', signature);

                    for (const [key, value] of Object.entries(optionsCopy)) {
                        formdata.append(key, String(value));
                    }

                    const byteHeaderRange = "bytes " + start + "-" + (end - 1) + "/" + fileSize;

                    // console.log('byteHeaderRange:', byteHeaderRange);

                    await axios.post(
                        "https://api.cloudinary.com/v1_1/" + this.cloudName + "/auto/upload",
                        formdata,
                        {
                            headers: {
                                ...formdata.getHeaders(),
                                'X-Unique-Upload-Id': XUniqueUploadId,
                                'Content-Range': byteHeaderRange,
                            },
                            timeout,
                            signal
                        }
                    ).then(response => {
                        /* check if the last chunk has been uploaded */
                        if (end >= fileSize) {
                            resolve(response);
                        }
                    }).catch(error => {
                        /* if there was a response from the server, Cloudinary rejected the
                            file some reason (e.g. invalid account credentials); create
                            a corresponding error type */
                        if (error.response) {
                            reject(new ServerResponseError(error.message, url, error.response.status));
                        }
                        /* some other type of error occurred, such as a timeout or disconnection;
                            simply forward the error */
                        reject(new FileUploadError(error.message, url));
                    });
                });
        });
    }
    /**
     * Upload a file to Cloudinary.
     * 
     * @param {string} url - The location of the resource to upload.
     * 
     * @param {Object} options
     * 
     * @param {number} options.timeout - Milliseconds before the upload process is canceled.
     * 
     * @param {{}} options.optionalParams - Optional Cloudinary API upload options;
     * see https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
     * for a complete list.
     * 
     * @param {AbortSignal|null} options.signal - If provided and an abort event is emitted, the
     * upload process will be canceled.
     * 
     * @returns {Promise<import('axios').AxiosResponse<any, any>>}
     */
    async upload(
        url,
        {
            timeout = 120000,
            optionalParams = {},
            signal = null
        } = {}
    ) {

        let readStream = null;
        /* wait for the file to open as a stream */
        await new Promise((resolve, reject) => {
            readStream = createReadStream(url)
                .on('error', (err) => {
                    reject(new FileOpenError(err.message, url));
                })
                .on('open', () => {
                    resolve();
                });
        });

        const timestamp = Math.round((new Date).getTime() / 1000);

        const optionsCopy = { timestamp, ...optionalParams };

        const resourceType = optionsCopy.resource_type ?? 'auto';

        /* the resource type can't be included in the signature so
            remove it from the options before creating a signature */
        delete optionsCopy.resource_type;

        const signature = this.generateSignature(optionsCopy);

        const form = new FormData();
        form.append('file', readStream, url);
        form.append('api_key', this.apiKey);
        form.append('timestamp', timestamp);
        form.append('signature', signature);

        for (const [key, value] of Object.entries(optionsCopy)) {
            form.append(key, String(value));
        }

        return axios.post(
            `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`,
            form,
            {
                headers: {
                    ...form.getHeaders()
                },
                timeout,
                signal
            }
        )
            .catch(error => {
                /* if there was a response from the server, Cloudinary rejected the
                    file some reason (e.g. invalid account credentials); create
                    a corresponding error type */
                if (error.response) {
                    return Promise.reject(
                        new ServerResponseError(error.message, url, error.response.status)
                    );
                }
                /* some other type of error occurred, such as a timeout or disconnection;
                    simply forward the error */
                return Promise.reject(new FileUploadError(error.message, url));
            });
    }
    /**
     * @callback uploadResponse
     * 
     * @param {string} fileURL - URL of the file that was uploaded.
     * 
     * @param {{}} result - Object returned by Cloudinary detailing a successful upload.
     * 
     * @param {FileUploadError} error - Object detailing an upload error, if one occurred.
     * 
     * @returns {void}
     */
    /**
     * Upload one or more files to Cloudinary.
     * 
     * @param {Object} uploadOptions
     * 
     * @param {[string]} uploadOptions.filenames - Files to upload.
     * 
     * @param {string} uploadOptions.imgDir - Directory of images to upload.
     * 
     * @param {number} uploadOptions.timeout - Milliseconds before the upload process is canceled.
     * 
     * @param {{}} uploadOptions.optionalParams - Optional Cloudinary API upload options;
     * see https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
     * for a complete list.
     * 
     * @param {AbortSignal|null} uploadOptions.signal - If provided and an abort event is emitted, all
     * current upload processes will be canceled.
     * 
     * @param {uploadResponse|null} uploadOptions.callback - Function to call after each file upload.
     * 
     * @returns {Promise<void>}
     */
    async bulkUpload({
        filenames,
        imgDir,
        timeout,
        optionalParams = {},
        signal = null,
        callback = null
    }) {

        /* get the number of allowable asynchronous requests */
        const numRequests = Math.min(MAX_CONCURRENT_UPLOADS, filenames.length);

        /* this generator will get filenames to upload as they are needed */
        const fileGen = (function* () {
            for (const f of filenames) {
                yield f;
            }
        })();

        const uploaders = Array.from({ length: numRequests }, () => {

            return new Promise(async (resolve) => {

                let nextFile = null;

                while (!(nextFile = fileGen.next()).done &&
                    !signal?.aborted) {

                    const filename = nextFile.value;

                    /* get the full file path for this file */
                    const fileURL = imgDir + filename;

                    /* the public name is the filename without the extension */
                    const publicName = filename.substring(0, filename.lastIndexOf('.'));
                    
                    await this.chunkUpload(
                        fileURL,
                        {
                            timeout,
                            optionalParams: ({ ...optionalParams, public_id: publicName }),
                            signal
                        })
                        .then(response => {
                            if (typeof callback === 'function') {
                                callback(fileURL, response.data, null);
                            }
                        })
                        .catch(error => {
                            if (typeof callback === 'function') {
                                callback(fileURL, null, error);
                            }
                        });
                }
                resolve();
            });
        });

        await Promise.allSettled(uploaders);
    }
};

module.exports = Uploader;