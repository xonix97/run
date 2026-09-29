const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'watch', 'preview'];

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileNames(root) {
  try {
    return new Set(fs.readdirSync(root));
  } catch {
    return new Set();
  }
}

function flattenDependencies(packageJson = {}) {
  return new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ]);
}

function packageManagerFromField(packageManager) {
  if (typeof packageManager !== 'string') return null;
  const match = packageManager.trim().match(/^([a-zA-Z0-9_-]+)@(.+)$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!['npm', 'yarn', 'pnpm', 'bun'].includes(name)) return null;
  return { name, version: match[2], source: 'packageManager field' };
}

function detectPackageManager(root, packageJson = {}) {
  const fromField = packageManagerFromField(packageJson.packageManager);
  if (fromField) return fromField;

  const files = fileNames(root);
  if (files.has('bun.lockb') || files.has('bun.lock')) {
    return { name: 'bun', version: null, source: 'bun lockfile' };
  }
  if (files.has('pnpm-lock.yaml')) {
    return { name: 'pnpm', version: null, source: 'pnpm lockfile' };
  }
  if (files.has('yarn.lock')) {
    return { name: 'yarn', version: null, source: 'yarn lockfile' };
  }
  if (files.has('package-lock.json') || files.has('npm-shrinkwrap.json')) {
    return { name: 'npm', version: null, source: 'npm lockfile' };
  }
  return { name: 'npm', version: null, source: 'default' };
}

function packageManagerCommand(name) {
  return process.platform === 'win32' && name !== 'bun' ? `${name}.cmd` : name;
}

function packageInstallSpec(root, packageManager) {
  const files = fileNames(root);
  const name = packageManager.name;
  let args;

  if (name === 'npm') {
    args = files.has('package-lock.json') || files.has('npm-shrinkwrap.json')
      ? ['ci']
      : ['install'];
  } else if (name === 'yarn') {
    args = files.has('yarn.lock') ? ['install', '--frozen-lockfile'] : ['install'];
  } else if (name === 'pnpm') {
    args = files.has('pnpm-lock.yaml') ? ['install', '--frozen-lockfile'] : ['install'];
  } else {
    args = ['install', '--frozen-lockfile'];
  }

  return {
    command: packageManagerCommand(name),
    args,
    display: `${name} ${args.join(' ')}`,
  };
}

function packageRunSpec(packageManager, script, extraArgs = []) {
  const separator = packageManager.name === 'npm' && extraArgs.length ? ['--'] : [];
  const args = ['run', script, ...separator, ...extraArgs];
  return {
    command: packageManagerCommand(packageManager.name),
    args,
    display: `${packageManager.name} ${args.join(' ')}`,
  };
}

function chooseScript(scripts, requestedScript) {
  if (!scripts || typeof scripts !== 'object') return null;
  if (requestedScript) return scripts[requestedScript] ? requestedScript : null;
  return SCRIPT_PRIORITY.find((script) => typeof scripts[script] === 'string') || null;
}

function detectNodeKind(dependencies) {
  const has = (name) => dependencies.has(name);
  if (has('next')) return 'Next.js';
  if (has('nuxt')) return 'Nuxt';
  if (has('@angular/core')) return 'Angular';
  if (has('@sveltejs/kit') || has('svelte')) return has('@sveltejs/kit') ? 'SvelteKit' : 'Svelte';
  if (has('astro')) return 'Astro';
  if (has('@remix-run/react') || has('@remix-run/node')) return 'Remix';
  if (has('vite') && has('react')) return 'React + Vite';
  if (has('vite') && has('vue')) return 'Vue + Vite';
  if (has('vite') && has('svelte')) return 'Svelte + Vite';
  if (has('react')) return 'React';
  if (has('vue')) return 'Vue';
  if (has('express')) return 'Node.js + Express';
  if (has('fastify')) return 'Node.js + Fastify';
  if (has('koa')) return 'Node.js + Koa';
  return 'Node.js';
}

function findPythonEntry(root, files) {
  if (files.has('manage.py')) return { command: 'python', args: ['manage.py', 'runserver'], display: 'python manage.py runserver' };
  for (const candidate of ['main.py', 'app.py', 'server.py']) {
    if (files.has(candidate)) return { command: 'python', args: [candidate], display: `python ${candidate}` };
  }
  return null;
}

function detectProject(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const files = fileNames(absoluteRoot);
  const packageJson = readJson(path.join(absoluteRoot, 'package.json'));

  if (packageJson) {
    const dependencies = flattenDependencies(packageJson);
    const packageManager = detectPackageManager(absoluteRoot, packageJson);
    const script = chooseScript(packageJson.scripts, null);
    return {
      root: absoluteRoot,
      type: 'node',
      label: detectNodeKind(dependencies),
      packageJson,
      packageManager,
      script,
      scripts: packageJson.scripts || {},
      install: packageInstallSpec(absoluteRoot, packageManager),
      dependenciesInstalled: () => (
        isDirectory(path.join(absoluteRoot, 'node_modules')) ||
        exists(path.join(absoluteRoot, '.pnp.cjs')) ||
        exists(path.join(absoluteRoot, '.pnp.js'))
      ),
      run: script ? packageRunSpec(packageManager, script) : null,
    };
  }

  if (files.has('go.mod')) {
    return {
      root: absoluteRoot,
      type: 'go',
      label: 'Go',
      packageManager: null,
      script: null,
      install: { command: 'go', args: ['mod', 'download'], display: 'go mod download' },
      dependenciesInstalled: () => false,
      run: { command: 'go', args: ['run', '.'], display: 'go run .' },
    };
  }

  if (files.has('Cargo.toml')) {
    return {
      root: absoluteRoot,
      type: 'rust',
      label: 'Rust + Cargo',
      packageManager: null,
      script: null,
      install: { command: 'cargo', args: ['fetch'], display: 'cargo fetch' },
      dependenciesInstalled: () => isDirectory(path.join(absoluteRoot, 'target')),
      run: { command: 'cargo', args: ['run'], display: 'cargo run' },
    };
  }

  if (files.has('composer.json') || files.has('artisan')) {
    const composer = readJson(path.join(absoluteRoot, 'composer.json')) || {};
    const composerScript = chooseScript(composer.scripts, null);
    return {
      root: absoluteRoot,
      type: 'php',
      label: files.has('artisan') ? 'PHP + Laravel' : 'PHP + Composer',
      packageManager: null,
      script: composerScript,
      install: files.has('composer.json')
        ? { command: 'composer', args: ['install'], display: 'composer install' }
        : null,
      dependenciesInstalled: () => isDirectory(path.join(absoluteRoot, 'vendor')),
      run: files.has('artisan')
        ? { command: 'php', args: ['artisan', 'serve'], display: 'php artisan serve' }
        : (composerScript
          ? { command: 'composer', args: ['run-script', composerScript], display: `composer run-script ${composerScript}` }
          : null),
    };
  }

  if (files.has('Gemfile')) {
    const hasRails = files.has('bin') && exists(path.join(absoluteRoot, 'bin', 'rails'));
    return {
      root: absoluteRoot,
      type: 'ruby',
      label: hasRails ? 'Ruby on Rails' : 'Ruby',
      packageManager: null,
      script: null,
      install: { command: 'bundle', args: ['install'], display: 'bundle install' },
      dependenciesInstalled: () => isDirectory(path.join(absoluteRoot, 'vendor', 'bundle')),
      run: hasRails
        ? { command: 'bin/rails', args: ['server'], display: 'bin/rails server' }
        : null,
    };
  }

  if (files.has('pyproject.toml') || files.has('requirements.txt') || files.has('manage.py') || [...files].some((file) => file.endsWith('.py'))) {
    const entry = findPythonEntry(absoluteRoot, files);
    return {
      root: absoluteRoot,
      type: 'python',
      label: files.has('manage.py') ? 'Python + Django' : 'Python',
      packageManager: null,
      script: null,
      install: files.has('requirements.txt')
        ? { command: 'python', args: ['-m', 'pip', 'install', '-r', 'requirements.txt'], display: 'python -m pip install -r requirements.txt' }
        : null,
      dependenciesInstalled: () => isDirectory(path.join(absoluteRoot, '.venv')) || isDirectory(path.join(absoluteRoot, 'venv')),
      run: entry,
    };
  }

  if (files.has('compose.yaml') || files.has('compose.yml') || files.has('docker-compose.yml') || files.has('docker-compose.yaml')) {
    return {
      root: absoluteRoot,
      type: 'docker',
      label: 'Docker Compose',
      packageManager: null,
      script: null,
      install: null,
      dependenciesInstalled: () => true,
      run: { command: 'docker', args: ['compose', 'up'], display: 'docker compose up' },
    };
  }

  if (files.has('Makefile')) {
    return {
      root: absoluteRoot,
      type: 'make',
      label: 'Make project',
      packageManager: null,
      script: null,
      install: null,
      dependenciesInstalled: () => true,
      run: { command: 'make', args: ['run'], display: 'make run' },
    };
  }

  return {
    root: absoluteRoot,
    type: 'unknown',
    label: null,
    packageManager: null,
    script: null,
    install: null,
    dependenciesInstalled: () => true,
    run: null,
  };
}

function getRunPlan(project, options = {}) {
  const requestedScript = options.script;
  let run = project.run;
  let script = project.script;

  if (project.type === 'node') {
    script = chooseScript(project.scripts, requestedScript);
    run = script ? packageRunSpec(project.packageManager, script, options.args || []) : null;
  } else if (run && options.args && options.args.length) {
    run = { ...run, args: [...run.args, ...options.args], display: `${run.display} ${options.args.join(' ')}` };
  }

  return { ...project, script, run };
}

function environmentChecks(project) {
  if (project.type === 'node') {
    return [
      { label: 'Node.js', command: 'node', args: ['--version'] },
      { label: project.packageManager.name, command: packageManagerCommand(project.packageManager.name), args: ['--version'] },
    ];
  }
  if (project.type === 'python') {
    return [{ label: 'Python', command: 'python', args: ['--version'] }];
  }
  if (project.type === 'go') return [{ label: 'Go', command: 'go', args: ['version'] }];
  if (project.type === 'rust') return [{ label: 'Rust', command: 'rustc', args: ['--version'] }, { label: 'Cargo', command: 'cargo', args: ['--version'] }];
  if (project.type === 'php') return [{ label: 'PHP', command: 'php', args: ['--version'] }];
  if (project.type === 'ruby') return [{ label: 'Ruby', command: 'ruby', args: ['--version'] }, { label: 'Bundler', command: 'bundle', args: ['--version'] }];
  if (project.type === 'docker') return [{ label: 'Docker', command: 'docker', args: ['--version'] }];
  if (project.type === 'make') return [{ label: 'make', command: 'make', args: ['--version'] }];
  return [];
}

module.exports = {
  SCRIPT_PRIORITY,
  detectPackageManager,
  detectProject,
  environmentChecks,
  exists,
  getRunPlan,
  packageInstallSpec,
  packageRunSpec,
  readJson,
};
