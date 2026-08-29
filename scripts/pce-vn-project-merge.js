#!/usr/bin/env node
'use strict';

const { inspectProjectMerge, applyProjectMerge } = require('../pce-vn-project-merger');

function usage() {
  return 'Usage: npm run merge:vn -- --output <directory> [--title <title>] [--dry-run] [--replace] <project1> <project2> ...';
}

function parseArgs(argv) {
  const options = { projects: [], replace: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[++index];
      if (!options.output) throw new Error('--output requires a directory');
    } else if (arg === '--title') {
      options.title = argv[++index];
      if (options.title == null) throw new Error('--title requires a value');
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else options.projects.push(arg);
  }
  return options;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message || error}\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const inspection = inspectProjectMerge(options);
  if (options.dryRun || !inspection.ok) {
    printResult(inspection);
    return inspection.ok ? 0 : 1;
  }
  const result = applyProjectMerge({ ...options, signature: inspection.signature });
  printResult(result);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs, usage };
