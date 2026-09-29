const fs = require('node:fs');
const path = require('node:path');
const { execute } = require('./runner');

function packageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

function help() {
  return `run - detect a project and start it

Usage:
  run [options] [-- <arguments for the start command>]

Options:
  -c, --cwd <path>       Run in another project directory
  -s, --script <name>    Use a package script (for example: run --script preview)
      --command <cmd>    Run a custom command instead of the detected command
      --no-install        Do not install missing dependencies
      --install           Reinstall dependencies even when they are present
      --dry-run            Show what would run without starting it
  -h, --help             Show this help
  -v, --version          Show the version

Examples:
  run
  run --no-install
  run --script dev -- --host 0.0.0.0
  run --cwd ../api
`;
}

function parseArgs(argv) {
  const options = { forwardedArgs: [] };
  let forwarding = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (forwarding) {
      options.forwardedArgs.push(arg);
      continue;
    }
    if (arg === '--') {
      forwarding = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-install') {
      options.noInstall = true;
    } else if (arg === '--install') {
      options.install = true;
    } else if (['-c', '--cwd', '-s', '--script', '--command'].includes(arg)) {
      const value = argv[index + 1];
      if (value == null || value === '' || value.startsWith('-')) {
        const error = new Error(`Missing value for ${arg}`);
        error.code = 'ARGUMENT_ERROR';
        throw error;
      }
      const key = arg === '-c' || arg === '--cwd' ? 'cwd'
        : arg === '-s' || arg === '--script' ? 'script' : 'command';
      options[key] = value;
      index += 1;
    } else {
      const error = new Error(`Unknown option: ${arg}`);
      error.code = 'ARGUMENT_ERROR';
      throw error;
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2), io = console) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(`Error: ${error.message}`);
    io.error('Run "run --help" for usage.');
    return 2;
  }

  if (options.help) {
    io.log(help());
    return 0;
  }
  if (options.version) {
    io.log(packageVersion());
    return 0;
  }

  try {
    return await execute(options, io);
  } catch (error) {
    io.error(`run: ${error.message}`);
    if (process.env.RUN_DEBUG) io.error(error.stack);
    return 1;
  }
}

module.exports = { help, main, parseArgs };
