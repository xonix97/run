const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  detectProject,
  environmentChecks,
  getRunPlan,
} = require('./detect');

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
};

function useColor(stream = process.stdout) {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

function colorize(value, color, enabled) {
  return enabled ? `${ANSI[color]}${value}${ANSI.reset}` : value;
}

function formatVersion(output) {
  return String(output || '').trim().split(/\r?\n/)[0].trim();
}

function commandText(spec) {
  return [spec.command, ...(spec.args || [])].join(' ');
}

function windowsEnv(env, name) {
  const key = Object.keys(env).sort().find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key == null ? undefined : env[key];
}

function resolveWindowsCommand(command, cwd, env) {
  const hasPath = /[\\/]/.test(command) || path.isAbsolute(command);
  const directories = hasPath ? [''] : [cwd, ...(windowsEnv(env, 'PATH') || '').split(';')];
  const extensions = path.extname(command) ? ['']
    : (windowsEnv(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';');
  for (const directory of directories) {
    const candidate = path.resolve(cwd, directory.replace(/^"|"$/g, ''), command);
    for (const extension of extensions) {
      const file = candidate + extension;
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // Keep searching PATH; spawn will report ENOENT if nothing is found.
      }
    }
  }
  return command;
}

const CMD_META = /([()\[\]%!^"`<>&|;, *?])/g;

function quoteWindowsBatchArg(value) {
  // First quote for the child executable's argv parser, including trailing
  // backslashes. Then escape BOTH cmd.exe parses: /c and the batch file's %*.
  const quoted = `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

function spawnArguments(spec, { cwd, env }) {
  const args = spec.args || [];
  // Only the explicit --command option opts into shell interpretation.
  if (spec.shell || process.platform !== 'win32') {
    return { command: spec.command, args, shell: Boolean(spec.shell) };
  }

  const command = resolveWindowsCommand(spec.command, cwd, env);
  if (!/\.(cmd|bat)$/i.test(command)) return { command, args, shell: false };
  if ([command, ...args].some((value) => /[\r\n\0]/.test(String(value)))) {
    throw new Error('Windows batch commands cannot contain newlines or null bytes.');
  }

  const line = [command.replace(CMD_META, '^$1'), ...args.map(quoteWindowsBatchArg)].join(' ');
  return {
    command: windowsEnv(env, 'ComSpec') || 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', `"${line}"`],
    shell: false,
    windowsVerbatimArguments: true,
  };
}

function runProcess(spec, options = {}) {
  const {
    cwd = process.cwd(),
    stdio = 'inherit',
    env = process.env,
    timeout = 0,
  } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    const invocation = spawnArguments(spec, { cwd, env });
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio,
      shell: invocation.shell,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      windowsHide: true,
    });

    let timer;
    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill();
        finish({ code: null, signal: 'SIGTERM', timedOut: true });
      }, timeout);
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    }

    child.on('error', (error) => {
      if (settled) return;
      if (error.code === 'ENOENT') {
        finish({ code: null, signal: null, missing: true, error });
      } else {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
    child.on('exit', (code, signal) => finish({ code, signal }));
  });
}

function captureProcess(spec, options = {}) {
  return new Promise((resolve) => {
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;
    const invocation = spawnArguments(spec, { cwd, env });
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      shell: invocation.shell,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timer;
    if (options.timeout) {
      timer = setTimeout(() => child.kill(), options.timeout);
    }
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdout, stderr });
    });
  });
}

function printHeader(io, color) {
  io.log('');
  io.log(colorize('RUN', 'bold', color));
  io.log(colorize('─'.repeat(36), 'dim', color));
  io.log('');
}

function printCommand(io, spec, color) {
  io.log(colorize(`$ ${spec.display || commandText(spec)}`, 'dim', color));
}

async function checkEnvironment(project, io, color) {
  const checks = environmentChecks(project);
  if (!checks.length) return true;

  io.log('Checking environment...');
  let allAvailable = true;
  for (const check of checks) {
    const result = await captureProcess(check, { cwd: project.root, timeout: 10_000 });
    if (result.ok) {
      io.log(`${colorize('✓', 'green', color)} ${check.label} ${formatVersion(result.stdout || result.stderr)}`.trim());
    } else {
      allAvailable = false;
      io.log(`${colorize('✗', 'red', color)} ${check.label} not found`);
    }
  }
  return allAvailable;
}

function isInstallNeeded(project, forceInstall) {
  if (!project.install) return false;
  if (forceInstall) return true;
  return !project.dependenciesInstalled();
}

async function installDependencies(project, options, io, color) {
  if (!project.install) return true;

  const needed = isInstallNeeded(project, options.install);
  if (!needed) {
    io.log(`${colorize('✓', 'green', color)} Dependencies ready`);
    return true;
  }

  if (options.noInstall) {
    io.log(`${colorize('!', 'yellow', color)} Dependencies missing (--no-install) - continuing`);
    return true;
  }

  io.log(`${colorize('!', 'yellow', color)} Dependencies missing`);
  io.log('');
  io.log('Installing dependencies...');
  printCommand(io, project.install, color);
  const result = await runProcess(project.install, { cwd: project.root });
  if (result.code !== 0) {
    io.error(`\nDependency installation failed${result.code == null ? '' : ` (exit code ${result.code})`}.`);
    return false;
  }
  io.log(`${colorize('✓', 'green', color)} Dependencies installed`);
  return true;
}

function displayProject(project, io) {
  if (project.label) io.log(`Detected: ${project.label}`);
  if (project.packageManager) {
    const version = project.packageManager.version ? ` ${project.packageManager.version}` : '';
    io.log(`Package manager: ${project.packageManager.name}${version}`);
  }
  io.log('');
}

async function execute(options = {}, io = console) {
  const project = getRunPlan(
    detectProject(options.cwd || process.cwd()),
    { script: options.script, args: options.forwardedArgs || [] },
  );
  const color = options.color == null ? useColor(io.stdout || io._stdout || process.stdout) : options.color;

  printHeader(io, color);
  displayProject(project, io);

  if (project.type === 'unknown') {
    io.error('No supported project found in this directory.');
    io.error('Run this command from a project containing package.json, pyproject.toml, go.mod, Cargo.toml, or a similar project file.');
    return 1;
  }

  if (!project.run && !options.command) {
    io.error('This project has no start command.');
    if (project.scripts && Object.keys(project.scripts).length) {
      io.error(`Available scripts: ${Object.keys(project.scripts).join(', ')}`);
      io.error('Choose one with: run --script <name>');
    }
    return 1;
  }

  const start = options.command
    ? { command: options.command, args: [], display: options.command, shellCommand: true }
    : project.run;

  if (options.dryRun) {
    if (!options.noInstall && project.install && isInstallNeeded(project, options.install)) {
      io.log(`Would install dependencies: ${project.install.display}`);
    }
    io.log('Starting development server...');
    printCommand(io, start, color);
    io.log(colorize('\nDry run: nothing was executed.', 'dim', color));
    return 0;
  }

  if (!(await checkEnvironment(project, io, color))) {
    io.error('\nRequired tooling is missing. Install it and try again.');
    return 1;
  }
  io.log('');

  if (!(await installDependencies(project, options, io, color))) return 1;
  io.log('');

  io.log('Starting development server...');
  printCommand(io, start, color);
  io.log('');

  if (start.shellCommand) {
    const result = await runProcess({ command: start.command, args: [], shell: true }, {
      cwd: project.root,
      env: process.env,
    });
    return result.code == null ? 1 : result.code;
  }

  const result = await runProcess(start, { cwd: project.root });
  if (result.signal) return 1;
  return result.code == null ? 1 : result.code;
}

module.exports = {
  captureProcess,
  commandText,
  execute,
  formatVersion,
  runProcess,
};
