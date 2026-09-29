const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  detectPackageManager,
  detectProject,
  getRunPlan,
  packageRunSpec,
} = require('../src');
const { main, parseArgs } = require('../src/cli');

const fixtureRoots = [];
test.after(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cli-'));
  fixtureRoots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

test('detects React + Vite and chooses npm ci from package-lock.json', () => {
  const root = fixture({
    'package.json': JSON.stringify({
      name: 'my-app',
      packageManager: 'npm@10.9.2',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^18.0.0', vite: '^5.0.0' },
    }),
    'package-lock.json': '{}',
  });

  const project = detectProject(root);
  assert.equal(project.label, 'React + Vite');
  assert.equal(project.packageManager.name, 'npm');
  assert.equal(project.packageManager.version, '10.9.2');
  assert.deepEqual(project.install.args, ['ci']);
  assert.deepEqual(project.run.args, ['run', 'dev']);
});

test('detects package manager from lockfile when packageManager is absent', () => {
  const root = fixture({
    'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
    'pnpm-lock.yaml': 'lockfileVersion: 9',
  });

  const manager = detectPackageManager(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))));
  assert.equal(manager.name, 'pnpm');
  assert.equal(detectProject(root).install.display, 'pnpm install --frozen-lockfile');
});

test('supports script selection and forwarded arguments', () => {
  const root = fixture({
    'package.json': JSON.stringify({
      scripts: { dev: 'vite', preview: 'vite preview' },
      dependencies: { vite: '^5.0.0' },
    }),
  });

  const project = getRunPlan(detectProject(root), {
    script: 'preview',
    args: ['--host', '0.0.0.0'],
  });
  assert.equal(project.script, 'preview');
  assert.deepEqual(project.run.args, ['run', 'preview', '--', '--host', '0.0.0.0']);
  assert.equal(project.run.display, 'npm run preview -- --host 0.0.0.0');

  const defaultPlan = getRunPlan(detectProject(root), { args: ['--host', '0.0.0.0'] });
  assert.deepEqual(defaultPlan.run.args, ['run', 'dev', '--', '--host', '0.0.0.0']);
});

test('only npm adds a forwarding separator, and only when arguments are present', () => {
  for (const name of ['npm', 'yarn', 'pnpm', 'bun']) {
    assert.deepEqual(packageRunSpec({ name }, 'dev').args, ['run', 'dev']);
    assert.deepEqual(packageRunSpec({ name }, 'dev', ['--port', '3000']).args,
      ['run', 'dev', ...(name === 'npm' ? ['--'] : []), '--port', '3000']);
  }
});

test('detects non-JavaScript project entrypoints', () => {
  const pythonRoot = fixture({
    'manage.py': 'print("django")',
    'requirements.txt': 'Django==5.0',
  });
  const goRoot = fixture({ 'go.mod': 'module example.com/app\n' });

  assert.equal(detectProject(pythonRoot).label, 'Python + Django');
  assert.deepEqual(detectProject(pythonRoot).run.args, ['manage.py', 'runserver']);
  assert.equal(detectProject(goRoot).run.display, 'go run .');
});

test('dry-run does not invoke environment or install commands', async () => {
  const root = fixture({
    'package.json': JSON.stringify({
      scripts: { dev: 'node server.js' },
      dependencies: { express: '^4.0.0' },
    }),
  });
  const output = [];
  const io = {
    log: (message = '') => output.push(String(message)),
    error: (message = '') => output.push(`ERROR: ${message}`),
  };

  const code = await main(['--cwd', root, '--dry-run'], io);
  assert.equal(code, 0);
  assert.match(output.join('\n'), /Would install dependencies: npm install/);
  assert.match(output.join('\n'), /\$ npm run dev/);
  assert.match(output.join('\n'), /Dry run: nothing was executed/);
});

test('dry-run respects --no-install even when --install is also provided', async () => {
  const root = fixture({
    'package.json': JSON.stringify({ scripts: { dev: 'node server.js' } }),
  });
  for (const flags of [['--no-install'], ['--install', '--no-install']]) {
    const output = [];
    const code = await main(['--cwd', root, '--dry-run', ...flags], {
      log: (message) => output.push(String(message)),
      error: (message) => output.push(`ERROR: ${message}`),
    });
    assert.equal(code, 0);
    assert.doesNotMatch(output.join('\n'), /Would install dependencies/);
    assert.match(output.join('\n'), /\$ npm run dev/);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  }
});

test('parses forwarded arguments after --', () => {
  assert.deepEqual(parseArgs(['--script', 'dev', '--', '--host', '127.0.0.1']), {
    forwardedArgs: ['--host', '127.0.0.1'],
    script: 'dev',
  });
});
