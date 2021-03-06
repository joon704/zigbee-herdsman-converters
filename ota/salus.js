const axios = require('axios');
const url = 'https://eu.salusconnect.io/demo/default/status/firmware?timestamp=0';
const assert = require('assert');
const common = require('./common');
const tar = require('tar-stream');

/**
 * Helper functions
 */

async function getImageMeta(modelId) {
    const images = (await axios.get(url)).data.versions;
    const image = images.find((i) => i.model === modelId);
    assert(image !== null, `No image available for modelId '${modelId}'`);
    return {
        fileVersion: parseInt(image.version, 16),
        url: image.url.replace(/^http:\/\//, 'https://'),
    };
}

async function untar(tarStream) {
    return new Promise((resolve, reject) => {
        const extract = tar.extract();

        const result = [];

        extract.on('error', reject);

        extract.on('entry', (headers, stream, next) => {
            const buffers = [];

            stream.on('data', function(data) {
                buffers.push(data);
            });

            stream.on('end', function() {
                result.push({
                    headers,
                    data: Buffer.concat(buffers),
                });

                next();
            });

            stream.resume();
        });

        extract.on('finish', () => {
            resolve(result);
        });

        tarStream.pipe(extract);
    });
}

async function getNewImage(current, logger, device) {
    const meta = await getImageMeta(device.modelID);
    assert(meta.fileVersion > current.fileVersion, 'No new image available');

    const download = await axios.get(meta.url, {responseType: 'stream'});

    const files = await untar(download.data);

    const imageFile = files.find((file) => file.headers.name.endsWith('.ota'));

    const image = common.parseImage(imageFile.data);
    assert(image.header.fileVersion === meta.fileVersion, 'File version mismatch');
    assert(image.header.manufacturerCode === 4216, 'Manufacturer code mismatch');
    assert(image.header.imageType === current.imageType, 'Image type mismatch');
    return image;
}

async function isNewImageAvailable(current, logger, device) {
    const meta = await getImageMeta(device.modelID);
    const [currentS, metaS] = [JSON.stringify(current), JSON.stringify(meta)];
    logger.debug(`Is new image available for '${device.ieeeAddr}', current '${currentS}', latest meta '${metaS}'`);
    return Math.sign(current.fileVersion - meta.fileVersion);
}

/**
 * Interface implementation
 */

async function isUpdateAvailable(device, logger, requestPayload=null) {
    return common.isUpdateAvailable(device, logger, isNewImageAvailable, requestPayload);
}

async function updateToLatest(device, logger, onProgress) {
    return common.updateToLatest(device, logger, onProgress, getNewImage);
}

module.exports = {
    isUpdateAvailable,
    updateToLatest,
};
