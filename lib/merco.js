/**
 * Merging, compressing and cache busting for js
 */

/**
 * Module dependencies.
 */

const fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    async = require('async'),
    Terser = require('terser'),
    _ = require('lodash');


/**
 * Default options.
 * @type {{sKey: string, version: number, route: string, filePath: string, buildPath: string}}
 */

let opts = {
    sKey: 'merco_secret_s',
    version: 0,
    route: 'build',
    filePath: path.join(path.dirname(require.main.filename), '/public'),
    buildPath: path.join(path.dirname(require.main.filename), '/public/js/build/min/'),
    cache: true,
    ignoreSameFile: true,
    async: false
};


/**
 * Merco object.
 */

const merco = {};


/**
 * Setup merco middleware.
 * Add function to locals so they can be used from templates.
 *
 * @param options
 * @returns {Function}
 */

merco.init = function (options) {

    if (options) {
        opts = _.defaults(options, opts);
    }

    return function (req, res, next) {

        res.locals.js = [];

        /**
         * Store js file name in storage.
         *
         * @param filename
         */

        res.locals.getJS = function (filename) {
            if (!opts.ignoreSameFile || !_.includes(res.locals.js, filename)) {
                res.locals.js.push(filename);
            }
        };


        /**
         * Print script tag with js path and name.
         *
         * @returns {string}
         */

        res.locals.printJS = function () {

            let i,
                scripts = [];

            if ('noMerge' in req.query || 'merco_noMerge' in process.env) {

                for (i in res.locals.js) {
                    scripts.push(`<script src="${res.locals.js[i]}" ${ opts.async ? 'async' : '' }></script>`);
                }

                return scripts.join('');
            }

            return `<script src="${opts.route}/${encodeURIComponent(getHash(res.locals.js))}-${opts.version}.js" ${ opts.async ? 'async' : '' }></script>`;

        };

        next();

    };

};


/**
 * Merge and minify files.
 *
 * @param req
 * @param res
 */

merco.route = function (req, res) {

    let parts = req.params[0].split('-'),
        encrypted = decodeURIComponent(parts[0]),
        version = parts[1] ? parts[1].replace(/.js/, '') : null,
        hash = crypto.createHash('md5').update(encrypted).digest("hex"),
        file = opts.version + '.' + hash + '.js';

    // prevent caching if version is not valid
    if (version === opts.version){
        res.setHeader('Cache-Control', 'max-age=31536000');
        res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
    } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // change file location
        file = 'tmp.' + file;
    }

    fs.stat(opts.buildPath + file, function (err, stats) {

        if (opts.cache && stats) {
            return res.sendFile(path.resolve(opts.buildPath + file));
        }

        let result,
            files = getFiles(encrypted),
            functions = [];

        for (let i in files) {
            files[i] = path.resolve(opts.filePath + files[i]);
            functions.push(getFile(files[i]));
        }

        return async.parallel(functions, function (err, results) {

            let mtimestamp = 0,
                mtime = null,
                atime = null,
                validFiles = '';

            for (let i in results) {

                if (results[i]) {

                    if (results[i].mtime.getTime() > mtimestamp) {

                        mtimestamp = results[i].mtime.getTime();
                        mtime = results[i].mtime;
                        atime = results[i].atime;

                    }

                    validFiles += fs.readFileSync(results[i].file);

                }

            }

            if (validFiles.length) {
                result = Terser.minify(validFiles);
            } else {
                return res.end('something is wrong');
            }

            fs.writeFile(path.resolve(opts.buildPath + file), result.code, function (err) {

                if (err) {

                    return res.status(500).send('Error building js');

                } else {

                    return fs.utimes(path.resolve(opts.buildPath + file), atime, mtime, function (err) {
                        return res.sendFile(path.resolve(opts.buildPath + file));
                    });
                }
            });
        });
    });
};


/**
 * Create hash name of merged file names.
 *
 * @param files
 * @returns {*}
 */

function getHash (files) {

    let hash = files.join(';'),
        cipher = crypto.createCipher('aes-256-cbc', opts.sKey),
        encrypted = cipher.update(hash, 'utf8', 'base64');

    encrypted = encrypted + cipher.final('base64');

    return encrypted;

}


/**
 * Get file names from hash.
 *
 * @param hash
 * @returns {Array}
 */

function getFiles (hash) {

    let decrypted,
        decipher = crypto.createDecipher('aes-256-cbc', opts.sKey);

    try {
        decrypted = decipher.update(hash, 'base64', 'utf8');
        decrypted = decrypted + decipher.final('utf8');
    } catch (e) {
        return [];
    }

    return decrypted.split(';');
}


/**
 * Get file stat.
 *
 * @param file
 * @returns {Function}
 */

function getFile (file) {

    return function (callback) {
        fs.stat(file, function (err, result) {
            if (err) {
                return callback(null, null);
            }

            result.file = file;
            return callback(err, result);
        });
    };
}

module.exports = merco;
