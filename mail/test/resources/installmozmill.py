#!/usr/bin/env python

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""
install mozmill and its dependencies
"""

import os
import sys
from subprocess import call

### utility functions for cross-platform

def is_windows():
  return sys.platform.startswith('win')

def esc(path):
  """quote and escape a path for cross-platform use"""
  return '"%s"' % repr(path)[1:-1]

def scripts_path(virtual_env):
  """path to scripts directory"""
  if is_windows():
    return os.path.join(virtual_env, 'Scripts')
  return os.path.join(virtual_env, 'bin')

def python_script_path(virtual_env, script_name):
  """path to a python script in a virtualenv"""
  scripts_dir = scripts_path(virtual_env)
  if is_windows():
    script_name = script_name + '-script.py'
  return os.path.join(scripts_dir, script_name)

def entry_point_path(virtual_env, entry_point):
  path = os.path.join(scripts_path(virtual_env), entry_point)
  if is_windows():
    path += '.exe'
  return path

### command-line entry point

def main(args=None):
  """command line front-end function"""

  # parse command line arguments
  args = args or sys.argv[1:]
  usage = "Usage: %prog destination path/to/mozbase"

  # Print the python version
  print 'Python: %s' % sys.version

  # The data is kept in the same directory as the script
  source=os.path.abspath(os.path.dirname(__file__))

  # directory to install to
  if len(args) == 2:
    destination = os.path.abspath(args[0])
    mozbase = os.path.abspath(args[1])
  else:
    print "Usage: %s destination path/to/mozbase" % sys.argv[0]
    sys.exit(1)

  os.chdir(source)

  # check for existence of necessary files
  if not os.path.exists('virtualenv'):
    print "File not found: virtualenv"
    sys.exit(1)

  # packages to install in dependency order
  packages = ["jsbridge", "mozmill"]

  # create the virtualenv and install packages
  env = os.environ.copy()
  env.pop('PYTHONHOME', None)
  # The --no-site-packages is because of https://github.com/pypa/virtualenv/issues/165
  returncode = call([sys.executable, os.path.join('virtualenv', 'virtualenv.py'),
                     destination], env=env)
  if returncode:
    print 'Failure to install virtualenv'
    sys.exit(returncode)
  pip = entry_point_path(destination, 'pip')

  if os.environ.get('MOZ_AUTOMATION') == '1':
        find_links = [
            '--find-links', 'https://pypi.pub.build.mozilla.org/pub/',
            '--no-index',
        ]
  else:
        find_links = []

  # Install mozbase packages to the virtualenv
  mozbase_packages = ['manifestparser', 'mozfile', 'mozinfo', 'mozlog',
    'mozprofile', 'mozcrash', 'moznetwork', 'mozprocess', 'mozdevice',
    'mozrunner']
  returncode = call([pip, 'install'] + find_links +
    [os.path.join(mozbase, package) for package in mozbase_packages], env=env)
  if returncode:
    print 'Failure to install packages'
    sys.exit(returncode)

  # Install mozmill
  returncode = call([pip, 'install'] + find_links + [os.path.abspath(package) for package in packages], env=env)
  if returncode:
    print 'Failure to install packages'
    sys.exit(returncode)

if __name__ == '__main__':
  main()
