#!/usr/bin/env node

/*global process, require, setTimeout */

var argv = require('yargs').argv;
var child_process = require('child_process');
var spawn = child_process.spawn;
var execFile = child_process.execFile;
var fs = require('node-fs');

process.on('uncaughtException', function (err) {
    console.log('CAUGHT EXCEPTION: ' + err.toString());
    process.exit(1);
});

var datadir = (argv["data-dir"] || ".") + "/";

function split(str) {
    if (typeof str != 'string')
        console.error("WRONG SPLIT HERE", str);
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
        } else if (arguments[i] instanceof Array) {
            args = args.concat(arguments[i]);
        } else if (arguments[i] instanceof Object) {
            options = arguments[i];
        } else if (!exec) {
            exec = arguments[i];
        } else {
            args.push(arguments[i]);
        }
    }
    pending.push({ exec: exec, args: args, options: options, cb: cb });
    // console.log(exec, args.join(" "), pending.length, liveProcesses);
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
        options.maxBuffer = 1024 * 1024 * 10;
        // console.log("shit", proc.exec, proc.args, options.cwd );
        var p = execFile(proc.exec, proc.args, options, (function(proc) {
            return function(error, stdout, stderr) {
                // console.log(proc, error);
                // if (proc.exec == "/bin/cp")
                // console.log("shitballs",
                --liveProcesses;
                if (error) {
                    console.log("Got error", error);
                    if (proc.cb)
                        proc.cb();
                } else {
                    if (argv.verbose)
                        console.log("Process finished:", proc.exec, proc.args.join(' '));
                    if (proc.options.output) {
                        ensureParentDir(proc.options.output);
                        fs.writeFileSync(proc.options.output, stdout);
                    }
                    if (proc.cb) {
                        proc.cb(stdout);
                    }
                }
                startNext();
            };
        })(proc));
    }
};

function p4() {
    var args = [];
    args.push("p4");
    for (var i=0; i<arguments.length; ++i) {
        args.push(arguments[i]);
    }
    launch.apply(this, args);
}

function p4filelog(p4path, cb) {
    var out = mkpath(p4path);
    ensureParentDir(out);
    try {
        if (argv["refresh-filelogs"])
            throw "haha";
        var data = fs.readFileSync(out);
        cb(split(data.toString()));
    } catch (err) {
        p4({ output: out }, "filelog", p4path, function(stdout) { cb(split(stdout)); });
    }
}

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

    var sources = argv.source instanceof Array ? argv.source : [ argv.source ];
    console.log(sources);
    sources.forEach(function(source) {
        p4("files", source, function(stdout) {
            split(stdout).forEach(function(file) {
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
                        if (line.lastIndexOf('//', 0) == 0) {
                            p4file = line;
                            return;
                        }
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
            p4("files", argv.input, function(stdout) {
                var changesObject = {};
                console.log("shitballs", stdout);
                split(stdout).forEach(function(file) {
                    var idx = file.indexOf('#');
                    var p4file = file.substr(0, idx);
                    p4filelog(p4file, function(filelog) {
                        filelog.forEach(function(line) {
                            var matches = /^.*#[0-9]+ change ([0-9]+) [A-Za-z/]+/.exec(line);
                            if (!matches) {
                                // console.log("NO MATCH", filelog[l]);
                                return;
                            }
                            changesObject[matches[1]] = true;
                        });
                    });
                });
                var changes = [];
                for (var change in changesObject) {
                    changes.push(change);
                }
                changes.sort();
                var p4root = argv.input;
                if (p4root.substr(-4) == "/...") {
                    p4root = p4root.substr(0, p4root.length - 3);
                }

                changes.splice(1);

                function nextChange() {
                    var change = changes.splice(0, 1)[0];
                    if (!change)
                        return;
                    var file = datadir + "changes/" + change;
                    var description = [];
                    var commitDate;
                    var author;
                    var Initial = 0, IgnoreLine = 1, Description = 2, AffectedFiles = 3;
                    var state = Initial;
                    var added = [];
                    var copies = [];
                    function processLines(lines) {
                        // var revisions = {};
                        // console.log("got lines", change, lines.length);
                        lines.forEach(function(line) {
                            // console.log(line, state);
                            switch (state) {
                            case Initial:
                                // Change 123123 by sbalasubramanian@LGLT-SBALASUBRA on 2007/04/05 19:47:21
                                var m = /^Change [0-9]+ by ([^ ]+) on (.*)$/.exec(line);
                                if (!m) {
                                    console.error("Can't parse this change", line);
                                    process.exit(1);
                                } else {
                                    author = m[1];
                                    commitDate = m[2];
                                }
                                state = IgnoreLine;
                                break;
                            case IgnoreLine:
                                state = Description;
                                break;
                            case Description:
                                if (line.lastIndexOf("Affected files ...", 0) == 0) {
                                    description.splice(description.length - 1);
                                    state = AffectedFiles;
                                } else {
                                    description.push(line.substr(1));
                                }
                                break;
                            case AffectedFiles:
                                var matches = /\.\.\. (\/\/.*)#([0-9]+) ([A-Za-z_/]+)$/.exec(line);
                                // if (matches)
                                //     console.log(matches[1], p4root);
                                if (matches && matches[1].lastIndexOf(p4root, 0) == 0) {
                                    var sourceFile = datadir + "depot" + matches[1] + "_" + matches[2] + "_" + change;
                                    var targetFile = argv.repo + "/" + matches[1].substr(p4root.length);
                                    ensureParentDir(targetFile);
                                    // console.log(sourceFile.length);
                                    // console.log("we're here", sourceFile, targetFile);
                                    // process.exit(1);
                                    copies.push([ sourceFile, targetFile ]);
                                }
                                break;
                            }
                        });
                        console.log("Got change", author, commitDate, description, "\n", description.join("\n"));
                        nextChange();
                        // return;
                        // process.exit(1);

                        copies.forEach(function(copy) {
                            // console.log("cping", sourceFile, targetFile);
                            launch('/bin/cp', "-f", copy, function() {
                                // console.log("launch", copy[0], copy[1]);
                                added.push(copy[1]);
                                // console.log(added.length, copies.length);
                                if (added.length == copies.length) {
                                    git("add", added, { cwd: argv.repo }, function() {
                                        // console.log("commit git commit -m ", description.join("\n"), "--allow-empty-message", "--author=" + author, ("--date=" + commitDate));
                                        git("commit", "-m", description.join("\n"), "--allow-empty-message", "--author=" + author + " <" + author + ">", "--date=" + commitDate);
                                        nextChange();
                                    });
                                }
                            });
                        });
                    }

                    try {
                        var data = fs.readFileSync(file);
                        if (!data.length)
                            throw new "hehe";
                        // console.log(1);
                        console.log("BALLCLAP", data.toString());
                        processLines(split(data.toString()));
                        // console.log(2);
                    } catch (err) {
                        // this shouldn't really happen
                        // console.log(3);
                        p4({ output: file }, "describe", "-s", change, function(stdout) {
                            console.log("BALLCLAP 2", stdout);
                            processLines(split(stdout));
                        });
                        // console.log(4);
                    }
                    // process.exit(1);
                }
                nextChange();
                // console.log(changes);
            });
        });
    });
}

// setInterval(function() { console.log("Shu"); }, 1000);


// console.log(argv);

// for (var i=2; i<process.argv.length; ++i) {
//     console.log(process.argv[i]);
// }
