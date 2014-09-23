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
    var options = {};
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
        if (proc.cb && !proc.options.nooutput) {
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
                if (proc.options.nooutput) {
                    proc.cb();
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

var describes = [];

function p4describe(change, cb) {
    if (describes[change]) {
        cb(false);
        return;
    }
    describes[change] = true;
    var file = outdir + "changes/" + change;
    if (!fs.existsSync(file)) {
        // console.log("CALLING DESCRIBE");
        p4({ output: file, nooutput: true }, "describe", "-s", change, function() { cb(true); });
    } else {
        cb(false);
    }
}

function p4print(file, rev, change, cb) {
    var out = mkpath(file, rev, change);
    // console.log(out);
    if (!fs.existsSync(out)) {
        // console.log("CALLING P4PRINT");
        p4({ nooutput: true }, "print", "-o", out, (file + "#" + rev), function() { cb(true); });
    } else {
        cb(false);
    }
}

function p4filelog(p4path, cb) {
    var out = mkpath(p4path);
    ensureParentDir(out);
    try {
        var data = fs.readFileSync(out);
        cb(split(data.toString()));
    } catch (err) {
        p4({ output: out }, "filelog", p4path, function(stdout) { cb(split(stdout)); });
    }
}

var sources = argv.source instanceof Array ? argv.source : [ argv.source ];
console.log(sources);
sources.forEach(function(source) {
    p4("files", source, function(stdout) {
        split(stdout).forEach(function(file) {
            if (!file.length)
                return;
            var idx = file.indexOf('#');
            var p4file = file.substr(0, idx);
            if (argv.verbose)
                console.log("Got file", p4file);
            p4filelog(p4file, function(filelog) {
                var operations = 0;
                var changes = 0;
                function logProcessed(processed) {
                    setTimeout(function() {
                        if (processed)
                            ++changes;
                        if (!--operations && changes) {
                            console.log("processed", p4file, changes, "changes");
                        }
                        // console.log(processed, changes, operations);
                    }, 0);
                }

                filelog.forEach(function(line) {
                    var matches = /^.*#([0-9]+) change ([0-9]+) ([A-Za-z/]+)/.exec(line);
                    if (!matches) {
                        // console.log("NO MATCH", filelog[l]);
                        return;
                    }
                    ++operations;
                    // console.log("shitballs", p4file, operations);
                    p4describe(matches[2], logProcessed);
                    if (matches[3].indexOf('delete') == -1) {
                        ++operations;
                        p4print(p4file, matches[1], matches[2], logProcessed);
                    }
                });
            });
        });
    });
});


// console.log(argv);

// for (var i=2; i<process.argv.length; ++i) {
//     console.log(process.argv[i]);
// }
