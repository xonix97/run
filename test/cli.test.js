const assert = require('node:assert/strict');
const { Console } = require('node:console');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');
const { main, parseArgs } = require('../src/cli');
const { execute } = require('../src/runner');

test('options requiring values reject absent, empty, or option-shaped values', async () => {
  for (const flag of ['-c', '--cwd', '-s', '--script', '--command']) {
    for (const remaining of [[], [''], ['--dry-run'], ['--'], ['-h']]) {
      assert.throws(() => parseArgs([flag, ...remaining]), {
        code: 'ARGUMENT_ERROR', message: `Missing value for ${flag}`,
      });
      const errors = [];
      const code = await main([flag, ...remaining], {
        log: () => assert.fail('Invalid options must not start execution'),
        error: (message) => errors.push(message),
      });
      assert.equal(code, 2);
      assert.deepEqual(errors, [`Error: Missing value for ${flag}`, 'Run "run --help" for usage.']);
    }
  }
});

test('option values retain spaces and explicit shell commands', () => {
  assert.deepEqual(parseArgs(['-c', './project with spaces', '-s', 'preview', '--command', 'node app.js && echo done']), {
    forwardedArgs: [], cwd: './project with spaces', script: 'preview', command: 'node app.js && echo done',
  });
  assert.deepEqual(parseArgs(['--', '--cwd', '', '&', '"literal"']).forwardedArgs,
    ['--cwd', '', '&', '"literal"']);
});

test('color follows the Console output stream and honors NO_COLOR and explicit overrides', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run color test '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js' } }));
  const previous = process.env.NO_COLOR;
  t.after(() => {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  });

  for (const [tty, noColor, color, expected] of [
    [true, undefined, undefined, true],
    [false, undefined, undefined, false],
    [true, '1', undefined, false],
    [true, undefined, false, false],
  ]) {
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
    let output = '';
    const stdout = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
    stdout.isTTY = tty;
    const io = new Console({ stdout, stderr: stdout, colorMode: false });
    assert.equal(await execute({ cwd: root, dryRun: true, noInstall: true, color }, io), 0);
    assert.equal(/\u001b\[/.test(output), expected);
  }
});
