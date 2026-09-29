#!/usr/bin/env node

const { main } = require('../src/cli');

main().then((code) => {
  if (typeof code === 'number' && code !== 0) process.exitCode = code;
});
