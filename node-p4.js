#!/usr/bin/env node

/*global process, require, setTimeout */

var argv = require('yargs').argv;
var spawn = require('child_process').spawn;
var fs = require('node-fs');

process.on('uncaughtException', function (err) {
    console.log('CAUGHT EXCEPTION: ' + err.toString());
    process.exit(1);
});


var outdir = (argv.outdir || ".") + "/";

var pending = [];

function split(str) {
    var out = str.split('\n');
    if (out.length && out[out.length - 1].length == 0)
        out.splice(out.length - 1, 1);
    return out;
}

function p4() {
    var args = [];
    var cb;
    var options = { split: true };
    for (var i=0; i<arguments.length; ++i) {
        if (arguments[i] instanceof Function) {
            cb = arguments[i];
        } else if (arguments[i] instanceof Array) {
            args = args.concat(arguments[i]);
        } else if (arguments[i] instanceof Object) {
            options = arguments[i];
        } else {
            args.push(arguments[i]);
        }
    }
    pending.push({ args: args, options: options, cb: cb });
    startNext();
}

var liveProcesses = 0;
var max = 20;

function startNext()
{
    while (pending.length && liveProcesses < max) {
        ++liveProcesses;
        var proc = pending.splice(0, 1)[0];
        var process = spawn('p4', proc.args);
        process.stdout.setEncoding('utf8');
        var stdout = "";
        var stderr = "";
        if (proc.options.output) {
            ensureParentDir(proc.options.output);
            var stream = fs.createWriteStream(proc.options.output, { flags: 'w' });
            process.stdout.pipe(stream);
        }
        if (proc.cb) {
            process.stdout.on('data', function (data) {
                stdout += data.toString();
            });
        }
        process.stderr.on('data', function (data) { stderr += data.toString(); });
        process.on('close', function (code) {
            --liveProcesses;
            if (code != 0) {
                console.error("p4 error: \"p4 " + proc.args.join(' ') + "\": " + code + " :" + stderr);
            }
            if (argv.verbose) {
                console.log("Process finished p4 " + proc.args.join(' '));
            }
            if (proc.cb) {
                if (proc.options.split) {
                    proc.cb(split(stdout));
                } else {
                    proc.cb(stdout);
                }

            }
            setTimeout(function() { startNext(); }, 0);
        });
    }
};

function dirname(path) {
    var lastSlash = path.lastIndexOf('/');
    return path.substr(0, lastSlash + 1);
}

function mkdir(dir) {
    try {
        fs.mkdirSync(dir, 0777, true);
    } catch (err) {}
}

function ensureParentDir(file) {
    try {
        fs.mkdirSync(dirname(file), 0777, true);
    } catch (err) {}
}

function mkpath(p4path, rev, change) {
    var encoded = outdir + "depot" + p4path;
    ensureParentDir(encoded);
    if (rev && change) {
        return encoded + "_" + rev + "_" + change;
    } else {
        return encoded;
    }
}

if (typeof argv.source != 'string') {
    console.error("No source");
    process.exit(1);
}

function p4describe(change) {
    var file = outdir + "changes/" + change;
    if (!fs.existsSync(file)) {
        // console.log("CALLING DESCRIBE");
        p4({ output: file }, "describe", "-s", change);
        return 1;
    }
    return 0;
}

function p4print(file, rev, change) {
    var out = mkpath(file, rev, change);
    // console.log(out);
    if (!fs.existsSync(out)) {
        // console.log("CALLING P4PRINT");
        p4("print", "-o", out, (file + "#" + rev));
        return 1;
    }
    return 0;
}

function p4filelog(p4path, cb) {
    var out = mkpath(p4path);
    ensureParentDir(out);
    fs.readFile(out, function (err, data) {
        if (err) {
            p4({ output: out }, "filelog", p4path, cb);
            // console.log("constructing filelog", p4path);
        } else {
            // console.log("got filelog from cache", p4path);
            cb(split(data.toString()));
        }
    });
}

p4("files", argv.source, function(files) {
    // console.log("files " + files.length);
    for (var f=0; f<files.length; ++f) {
        var file = files[f];
        if (!file.length)
            continue;
        var idx = file.indexOf('#');
        var p4file = file.substr(0, idx);
        if (argv.verbose)
            console.log("Got file", p4file);
        p4filelog(p4file, (function(p4file) {
            return function(filelog) {
                var count = 0;
                for (var l=0; l<filelog.length; ++l) {
                    var matches = /^.*#([0-9]+) change ([0-9]+) ([A-Za-z/]+)/.exec(filelog[l]);
                    if (!matches) {
                        // console.log("NO MATCH", filelog[l]);
                        continue;
                    }
                    count += p4describe(matches[2]);
                    // console.log(matches[2]);
                    if (matches[3].indexOf('delete') == -1) {
                        console.log("Calling p4print(", p4file, matches[1], matches[2], matches[3]);
                        count += p4print(p4file, matches[1], matches[2]);
                    }
                    // count += c;
                    // if (// argv.verbose &&
                    //     c) {
                    //     console.log("processed", p4file, c);
                    // }
                }
                if (count)
                    console.log("processed", p4file, count, "changes");
                // console.log(filelog);
                // process.exit(0);
            };
        }(p4file)));
    }
});


// console.log(argv);

// for (var i=2; i<process.argv.length; ++i) {
//     console.log(process.argv[i]);
// }
