const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { captureProcess, runProcess } = require('../src/runner');

const windows = process.platform === 'win32';
const cli = path.resolve(__dirname, '../bin/run.js');
const literalArgs = [
  '--host', '127.0.0.1', '', 'a value with spaces', 'tab\tvalue',
  '&', '|', '<', '>', '^', '(parentheses)', '%RUN_TEST_LITERAL%', '!RUN_TEST_LITERAL!',
  '"quoted"', 'embedded "double quotes" here', "single 'quotes'", 'back\\\"quote',
  'C:\\path with spaces\\', 'two trailing slashes\\\\',
  'x&echo injected>injected.txt', 'x"&echo injected>injected.txt&"',
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run integration project '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'record.js'), [
    'const fs = require("node:fs");',
    'const result = { args: process.argv.slice(2), cwd: process.cwd() };',
    'fs.writeFileSync("received.json", JSON.stringify(result));',
    'console.log("RUN_TEST_RESULT=" + JSON.stringify(result));',
    'process.exitCode = Number(process.env.RUN_TEST_EXIT || 0);',
  ].join('\n'));
  return root;
}

function assertReceived(root, args) {
  const received = JSON.parse(fs.readFileSync(path.join(root, 'received.json'), 'utf8'));
  assert.deepEqual(received, { args, cwd: root });
  assert.equal(fs.existsSync(path.join(root, 'injected.txt')), false, 'arguments must not become shell commands');
}

test('native executables preserve literal argv and project paths with spaces', async (t) => {
  const root = fixture(t);
  const args = [...literalArgs, 'a\nnewline'];
  const result = await captureProcess({ command: process.execPath, args: [path.join(root, 'record.js'), ...args] }, {
    cwd: root, env: { ...process.env, RUN_TEST_LITERAL: 'MUST_NOT_EXPAND' }, timeout: 10_000,
  });
  assert.equal(result.ok, true, result.stderr);
  assertReceived(root, args);
  assert.match(result.stdout, /RUN_TEST_RESULT=/);
});

test('runProcess preserves child exit codes without shell interpretation', async (t) => {
  const root = fixture(t);
  const result = await runProcess({ command: process.execPath, args: ['record.js', ...literalArgs] }, {
    cwd: root, stdio: 'ignore', env: { ...process.env, RUN_TEST_EXIT: '23' }, timeout: 10_000,
  });
  assert.equal(result.code, 23);
  assert.equal(result.signal, null);
  assertReceived(root, literalArgs);
});

test('missing executables report ENOENT rather than succeeding through a shell', async (t) => {
  const root = fixture(t);
  const spec = { command: 'run-cli-test-does-not-exist-872394', args: [] };
  const captured = await captureProcess(spec, { cwd: root });
  assert.equal(captured.ok, false);
  assert.equal(captured.error.code, 'ENOENT');
  const result = await runProcess(spec, { cwd: root, stdio: 'ignore' });
  assert.equal(result.missing, true);
  assert.equal(result.error.code, 'ENOENT');
});

test('Windows batch shims preserve metacharacters, quotes, spaces, and exit codes', { skip: !windows }, async (t) => {
  const root = fixture(t);
  for (const extension of ['cmd', 'bat']) {
    const shim = path.join(root, `record shim.${extension}`);
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0record.js" %*\r\n`);
    const options = {
      cwd: root,
      env: { ...process.env, RUN_TEST_LITERAL: 'MUST_NOT_EXPAND', RUN_TEST_EXIT: '31' },
      timeout: 10_000,
    };
    const spec = { command: shim, args: literalArgs };
    const result = await captureProcess(spec, options);
    assert.equal(result.code, 31, result.stderr);
    assertReceived(root, literalArgs);
    assert.equal((await runProcess(spec, { ...options, stdio: 'ignore' })).code, 31);
    assertReceived(root, literalArgs);
  }
});

test('Windows resolves extensionless batch commands using the supplied PATH and PATHEXT', { skip: !windows }, async (t) => {
  const root = fixture(t);
  const tools = path.join(root, 'tools with spaces & (parens) %RUN_TEST_LITERAL% !');
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, 'record ^& tool.cmd'), `@echo off\r\n"${process.execPath}" "${path.join(root, 'record.js')}" %*\r\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['path', 'pathext'].includes(key.toLowerCase())));
  env.Path = `"${tools}"`;
  env.PathExt = '.EXE;.CMD';
  env.RUN_TEST_LITERAL = 'MUST_NOT_EXPAND';
  const result = await captureProcess({ command: 'record ^& tool', args: literalArgs }, { cwd: root, env, timeout: 10_000 });
  assert.equal(result.ok, true, result.stderr);
  assertReceived(root, literalArgs);
});

test('Windows batch commands reject newlines instead of interpreting another command', { skip: !windows }, async (t) => {
  const root = fixture(t);
  const shim = path.join(root, 'record.cmd');
  fs.writeFileSync(shim, '@echo off\r\n');
  await assert.rejects(captureProcess({ command: shim, args: ['first\necho unsafe'] }, { cwd: root }), /cannot contain newlines/);
});

test('CLI starts a plain npm dev script in a spaced path and forwards argv and exit status', { timeout: 30_000 }, async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'run-integration-fixture', version: '1.0.0', private: true,
    scripts: { dev: 'node record.js', preview: 'node record.js' },
  }));
  for (const selection of [[], ['--script', 'preview']]) {
    const result = await captureProcess({
      command: process.execPath,
      args: [cli, '--cwd', root, '--no-install', ...selection, '--', ...literalArgs],
    }, {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', RUN_TEST_LITERAL: 'MUST_NOT_EXPAND', RUN_TEST_EXIT: '23' },
      timeout: 20_000,
    });
    assert.equal(result.code, 23, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Checking environment/);
    assert.match(result.stdout, /Starting development server/);
    assert.doesNotMatch(result.stdout, /Installing dependencies/);
    assert.doesNotMatch(result.stdout, /\u001b\[/);
    assertReceived(root, literalArgs);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  }
});

test('CLI installs and starts a dependency-free plain npm dev script with no forwarded arguments', { timeout: 30_000 }, async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'run-plain-demo', version: '1.0.0', private: true, scripts: { dev: 'node record.js' },
  }));
  const result = await captureProcess({ command: process.execPath, args: [cli] }, {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true' },
    timeout: 20_000,
  });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Installing dependencies/);
  assert.match(result.stdout, /Dependencies installed/);
  assert.match(result.stdout, /\$ npm run dev/);
  assertReceived(root, []);
});

test('explicit shell commands still support intentional shell syntax', async (t) => {
  const root = fixture(t);
  const result = await captureProcess({ command: 'echo first && echo second', shell: true }, { cwd: root });
  assert.equal(result.ok, true, result.stderr);
  assert.match(result.stdout, /first/);
  assert.match(result.stdout, /second/);
});
