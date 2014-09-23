#!/usr/bin/env node

/*global process, require, setTimeout */

var argv = require('yargs').argv;
var spawn = require('child_process').spawn;
var fs = require('node-fs');

process.on('uncaughtException', function (err) {
    console.log('CAUGHT EXCEPTION: ' + err.toString());
    process.exit(1);
});

var datadir = (argv["data-dir"] || ".") + "/";

function split(str) {
    var out = str.split('\n');
    if (out.length && out[out.length - 1].length == 0)
        out.splice(out.length - 1, 1);
    return out;
}

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

var pending = [];
var liveProcesses = 0;
var max = 20;

function launch() {
    var args = [];
    var cb;
    var options = {};
    var exec;
    for (var i=0; i<arguments.length; ++i) {
        if (arguments[i] instanceof Function) {
            cb = arguments[i];
        } else if (arguments[i] instanceof Object) {
            options = arguments[i];
        } else if (!exec) {
            exec = arguments[i];
        } else {
            args.push(arguments[i]);
        }
    }
    pending.push({ exec: exec, args: args, options: options, cb: cb });
    startNext();
}

function startNext()
{
    while (pending.length && liveProcesses < max) {
        ++liveProcesses;
        var proc = pending.splice(0, 1)[0];
        var options = { cwd: undefined, env: process.env };
        if (proc.options.cwd)
            options.cwd = proc.options.cwd;
        // console.log("shit", proc.exec, proc.args, options.cwd );
        var p = spawn(proc.exec, proc.args, options);
        var stdout = "";
        var stderr = "";
        if (proc.options.output) {
            p.stdout.setEncoding('utf8');
            ensureParentDir(proc.options.output);
            var stream = fs.createWriteStream(proc.options.output, { flags: 'w' });
            p.stdout.pipe(stream);
        }
        if (proc.cb && !proc.options.nooutput) {
            p.stdout.on('data', function (data) {
                stdout += data.toString();
            });
        } else {
            // p.disconnect();
        }
        p.stderr.on('data', function (data) { stderr += data.toString(); });
        p.on('close', function (code) {
            // console.log("shit", code);
            --liveProcesses;
            if (code != 0) {
                console.error(proc.exec, "error: \"" + proc.exec + " " + proc.args.join(' ') + "\": " + code + " :" + stderr);
            }
            if (argv.verbose) {
                console.log("Process finished:", proc.exec, proc.args.join(' '));
            }
            if (proc.cb) {
                if (proc.options.nooutput) {
                    proc.cb();
                } else {
                    proc.cb(stdout);
                }

            }
            startNext();
        });
    }
};

if (argv.source) {
    function mkpath(p4path, rev, change) {
        var encoded = datadir + "depot" + p4path;
        ensureParentDir(encoded);
        if (rev && change) {
            return encoded + "_" + rev + "_" + change;
        } else {
            return encoded;
        }
    }

    // if (!argv.source) {
    //     console.error("No source");
    //     process.exit(1);
    // }

    var describes = [];

    function p4() {
        var args = [];
        args.push("p4");
        for (var i=0; i<arguments.length; ++i) {
            args.push(arguments[i]);
        }
        launch.apply(this, args);
    }

    function p4describe(change, cb) {
        if (describes[change]) {
            cb(false);
            return;
        }
        describes[change] = true;
        var file = datadir + "changes/" + change;
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
}

function git() {
    var args = [];
    args.push("git");
    for (var i=0; i<arguments.length; ++i) {
        args.push(arguments[i]);
    }
    launch.apply(this, args);
}

// launch("ls", {cwd: "/tmp/"}, function(out) { console.log(out); });

function findFiles(dir) {
    var results = [];
    var list = fs.readdirSync(dir);
    list.forEach(function(file) {
        // console.log(file);
        file = dir + '/' + file;
        var stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(findFiles(file));
        } else if (!/_[0-9]+_[0-9]+$/.exec(file)) {
            results.push(file);
        // } else {
            // console.log(/_[0-9]+_[0-9]+$/.exec(file));
        }
    });
    return results;
}

if (argv["input"] && argv.repo && argv["output-branch"]) {
    mkdir(argv.repo);
    git("init", {cwd: argv.repo}, function() {
        git("checkout", "-b", argv["output-branch"], {cwd: argv.repo}, function() {
            var files = findFiles(argv.input);
            files.forEach(function(file) {
                var data = fs.readFileSync(file);
                split(data.toString()).forEach(function(line) {
                    console.log("line is", line, file);
                });
                process.exit(1);
            });
        });
    });
}


// console.log(argv);

// for (var i=2; i<process.argv.length; ++i) {
//     console.log(process.argv[i]);
// }
