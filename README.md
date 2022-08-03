# Cloudinary Bulk Image Uploader

A lightweight app I built in order to reduce the time needed to upload my projects' images to Cloudinary's server.

## Features

- Utilizes an asynchronous approach to upload multiple files simultaneously. Cloudinary allows
up to ten concurrent uploads, so once an upload has finished, another file upload will begin
immediately.

- Uploads all files from a specified directory or from a specific list. Additionaly, users
can specifiy which files types are permitted to be uploaded.

- Files are uploaded in chunks in order to reduce memory consumption in regards to large file sizes. Also, Cloudinary requires chunked uploads after a certain threshold (depending on file type).

- Performs simple client-side image file validation (file extension and magic number verification) for common image formats in order to catch invalid files before the upload process.

- Logs invalid files and those that fail to upload to a specified file for further review.

## Example Usage

``` javascript

/* import the library */
const CloudinaryUploader = require('cloudinary_uploader');

/* create a new instance of the uploader using your Cloudinary credentials */
const uploader = new CloudinaryUploader({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    cloudName: process.env.CLOUD_NAME
});

/* begin the upload process; note that all parameters are optional although you will
    most likely specify an image directory and Cloudinary optional params */
await uploader.upload({

    /* provide a directory to upload images from */
    imgDir: '/images/',

    /* if you want to upload only specific files, provide them here */
    specificFiles: [],

    /* optional error options */
    errorOptions: {

        /* file to write errors to; errors will not be logged if this isn't provided */
        errorFilename: '/logs/error.txt',

        /* new line-separator to separate entries in the error file; the OS-specific
            separator will be used if none is provided */
        lineSep: ',',

        /* timeout, in milliseconds, allowed before the upload process fails; you might need
            to increase this value for larger files */
        timeout: 1200000,

        /* overwrite the error file if true; throws an error if false and the file already exists */
        overwrite: true
    },

    /* provide an array of the types of files you want to upload; provide an empty array or
        ignore this value if you want to permit all file types */
    allowedFileTypes: ['png', 'jpg']

    /* optional Cloudinary upload parameters; you can specify if you'd like to overwrite existing
        files on their server, where the images are to be stored, and more; see
        https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters
        for a complete list. */
    optionalParams: {
        overwrite: true,
        folder: 'your_folder_name'
    }
});

```

Additionaly, you can listen to several events emitted from the uploader, with each event having
a corresponding helper method to easily set up event listeners. The events are:

- UPLOAD_SUCCESS: a file has been successfully uploaded.

- UPLOAD_ERROR: the uploader experienced and error when attempting to upload a file.

- UPLOAD_CRITICAL: the uploader experienced a critical error when attempting to upload a file.

``` javascript

const uploader = new Uploader(/* your params */);

/* attach event listeners */
uploader
    .onUploadError(async (pathname, message) => {
        console.log(`Could not upload "${pathname}"`);
        console.log(`Reason: ${message}`);
    })
    .onUploadSuccess(async (pathname, response) => {
        console.log(`Successfully uploaded "${pathname}"`);
        console.log('Response from server:', response);        
    })
    .onCriticalError(async (pathname, message) => {
        console.log(`Upload process encountered a critical error: ${message}`);
    });

```