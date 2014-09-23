#!/usr/bin/env node

/*global process, require */

var argv = require('yargs').argv;
var spawn = require('child_process').spawn;

function p4(args, cb) {
    var process = spawn('p4', args instanceof Array ? args : args.split(' '));
    process.stdout.setEncoding('utf8');
    var stdout = [];
    var stderr = "";
    process.stdout.on('data', function (data) {
        var str = data.toString();
        var lines = str.split(/(\r?\n)/g);
        stdout = stdout.concat(lines);
    });
    process.stderr.on('data', function (data) { stderr += data.toString(); });
    process.on('close', function (code) {
        if (code != 0) {
            console.error("p4 error: p4 " + args + ": " + code + " :" + stderr);
        }
        if (argv.verbose) {
            console.log("process finished p4 " + args);
        }
        if (cb)
            cb(stdout);
    });
};

if (typeof argv.source != 'string') {
    console.error("No source");
    process.exit(1);
}

p4("files " + argv.source, function(out) { console.log("out", out); });


// console.log(argv);

// for (var i=2; i<process.argv.length; ++i) {
//     console.log(process.argv[i]);
// }
