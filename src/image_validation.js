const { createReadStream } = require('fs');

const { FileOpenError } = require('./errors');

/* common image format magic numbers */
const magicNumTable = new Map(
	[
		['bmp', ['424d']],
		['png', ['89504e47']],
		['gif', ['474946383761', '474946383961']],
		['jpg', ['ffd8ff']],
		['tif', [
			'49492a00',
			'4d4d002a',
			'4d4d002b'
		]],
		['ico', ['00000100']]
	]
);

/* set image format type aliases */
magicNumTable.set('dib', magicNumTable.get('bmp'));
magicNumTable.set('jpeg', magicNumTable.get('jpg'));
magicNumTable.set('jpe', magicNumTable.get('jpg'));
magicNumTable.set('tiff', magicNumTable.get('tif'));

/**
 * Get a filename's extension. Returns null if no extension is found.
 * 
 * @param {string} filename
 * 
 * @returns {string|null}
 */
const getFileExtension = (filename) => {
	const extPos = filename.lastIndexOf('.');
	if (extPos === -1) {
		return null;
	}
	return filename.substring(extPos + 1) || null;
};

/**
 * Class to perform simple client-side image validation
 */
const ImageValidator = class {
	#allowableTypes;
	static VALIDATION_RESULTS = Object.freeze({
		NOT_ALLOWED: 'not allowed',
		VALID: 'valid',
		INVALID: 'invalid'
	});
	/**
	 * Get an array of image formats the ImageValidator class can validate.
	 * 
	 * @returns {[string]}
	 */
	static getSupportedTypes() {
		return [...magicNumTable.keys()];
	}
	/**
	 * @param {string[]} [allowableTypes] - Types not specified automatically
	 * fail validation. For example, to only allow PNG and JPG files, include an array like
	 * so: ['png', 'jpg']. Provide an empty array to allow any file type.
	 */
	constructor(allowableTypes = []) {
		this.#allowableTypes = allowableTypes;
	}
	/**
	 * Performs simple image validation by checking a file's extension
	 * and verifying the magic number in its header.
	 * 
	 * @param {string} filename 
	 * 
	 * @returns {Promise<string>}
	 */
	async isValidImage(filename) {
		const ext = getFileExtension(filename);

		/* check if this file extension is allowed */
		if (Array.isArray(this.#allowableTypes) &&
			this.#allowableTypes.length > 0 &&
			!this.#allowableTypes.includes(ext)) {

			return ImageValidator.VALIDATION_RESULTS.NOT_ALLOWED;
		}

		/* get the corresponding magic numbers for this file extension */
		const magicNums = magicNumTable.get(ext);

		if (!magicNums) {
			/* if no magic numbers for this extension exist, this extension is unknown;
				consider it valid */
			return ImageValidator.VALIDATION_RESULTS.VALID;
		}

		/* get the number of characters that comprise this extension's magic numbers */
		const numChars = magicNums[0].length;

		const fileHeader = await new Promise((resolve, reject) => {
			let data = '';

			/* read in the file header; read in two bytes per character (the hex digits
				that comprise a character) and then subtract one byte because the read
				stream's end property is inclusive */
			createReadStream(filename, { end: (numChars >>> 1) - 1, encoding: 'hex' })
				.once('data', chunk => {
					data += chunk;
				})
				.once('end', () => {
					resolve(data);
				})
				.once('error', error => {
					reject(new FileOpenError(error.message, filename));
				});
		});

		// console.log('fileHeader:', fileHeader);

		/* compare the file header with known magic numbers for this file extension */
		return magicNums.some(magicNum =>
			magicNum.localeCompare(fileHeader, undefined, { sensitivity: 'accent' }) === 0
		) ? ImageValidator.VALIDATION_RESULTS.VALID : ImageValidator.VALIDATION_RESULTS.INVALID;
	}
};

module.exports = ImageValidator;