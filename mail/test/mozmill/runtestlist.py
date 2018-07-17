#!/usr/bin/env python
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import optparse
import sys
import os
import shutil
import subprocess
import logging

SCRIPT_DIRECTORY = os.path.abspath(os.path.realpath(os.path.dirname(sys.argv[0])))

class RunTestListOptions(optparse.OptionParser):
    """Parsed run test list command line options."""
    def __init__(self, **kwargs):
        optparse.OptionParser.__init__(self, **kwargs)
        defaults = {}

        self.add_option("--binary",
                        action = "store", type = "string", dest = "binary",
                        help = "Binary to be run")
        defaults["binary"] = ""

        self.add_option("--list",
                        action = "store", type = "string", dest = "list",
                        help = "List of tests to be run")
        defaults["list"] = ""

        self.add_option("--dir",
                        action = "store", type = "string", dest = "dir",
                        help = "Directory of the tests, leave blank for current directory")
        defaults["dir"] = ""

        self.add_option("--symbols-path",
                        action = "store", type = "string", dest = "symbols",
                        help = "The path to the symbol files from build_symbols")
        defaults["symbols"] = ""

        self.add_option("--total-chunks",
                        action = "store", type = "int", dest = "total_chunks",
                        help="how many chunks to split the tests up into")
        defaults["total_chunks"] = 1
        self.add_option("--this-chunk",
                        action = "store", type = "int", dest = "this_chunk",
                        help="which chunk to run between 1 and --total-chunks")
        defaults["this_chunk"] = 1

        self.add_option("--plugins-path",
                        action = "store", type = "string", dest = "plugins",
                        help = "The path to the plugins folder for the test profiles")

        self.add_option("--testing-modules-dir",
                        action="store", type="string", dest="testingmodules",
                        help="The path to the testing modules directory")
        defaults["testingmodules"] = ""

        self.set_defaults(**defaults);

        usage = """\
Usage instructions for runtestlist.py
"""
        self.set_usage(usage)

log = logging.getLogger()
handler = logging.StreamHandler(sys.stdout)
log.setLevel(logging.INFO)
log.addHandler(handler)

parser = RunTestListOptions()
options, args = parser.parse_args()

if options.binary == "" or options.list == "":
    parser.print_help()
    sys.exit(1)

totalTestErrors = 0
totalTestPasses = 0
totalDirectories = 0

tests = open(options.list, "rt").readlines()

if options.total_chunks > 1:
    tests_per_chunk = float(len(tests)) / options.total_chunks
    start = int(round((options.this_chunk - 1) * tests_per_chunk))
    end = int(round(options.this_chunk * tests_per_chunk))

    tests = (t for t in tests[start:end])


for directory in tests:
    log.info("INFO | (runtestlist.py) | Running directory: %s",
             directory.rstrip())
    if options.dir != "":
        testDirectory = os.path.join(options.dir, directory.rstrip())
    else:
        testDirectory = directory.rstrip()
    args = [sys.executable, "runtest.py", "-t", testDirectory,
            "--binary", os.path.abspath(options.binary), "--symbols-path", options.symbols]

    if options.plugins:
        args.append("--plugins-path")
        args.append(options.plugins)

    if options.testingmodules:
        args.append("--testing-modules-dir")
        args.append(os.path.abspath(options.testingmodules))

    print args
    outputPipe = subprocess.PIPE

    proc = subprocess.Popen(args, cwd=SCRIPT_DIRECTORY, stdout = subprocess.PIPE, stderr = subprocess.STDOUT)

    testErrors = 0
    testPasses = 0

    line = proc.stdout.readline()
    while line != "":
        log.info(line.rstrip())
        if line.find("TEST-UNEXPECTED-") != -1:
            testErrors += 1
        if line.find("TEST-PASS") != -1:
            testPasses += 1
        line = proc.stdout.readline()

    result = proc.wait()

    if result != 0:
        log.info("TEST-UNEXPECTED-FAIL | (runtestlist.py) | Exited with code %d during directory run", result)
        totalTestErrors += 1
    else:
        totalTestPasses += 1

    log.info("INFO | (runtestlist.py) | %s: %d passed, %d failed",
             directory.rstrip(), testPasses, testErrors)
    totalTestErrors += testErrors
    totalTestPasses += testPasses
    totalDirectories += 1


log.info("INFO | (runtestlist.py) | Directories Run: %d, Passed: %d, Failed: %d",
         totalDirectories, totalTestPasses, totalTestErrors)

if totalTestErrors:
    sys.exit(1)
