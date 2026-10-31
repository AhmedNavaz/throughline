import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchDesktop } from '../desktop/launch.mjs';

test('desktop launcher opens Electron normally when its parent uses Node-only mode', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', AI_RELAY_DESKTOP_DATA: '/temporary/profile', PATH: '/usr/bin' };
  const child = {};
  let launch;
  assert.equal(launchDesktop({ args: ['--smoke-test'], env, spawnImpl: (...values) => { launch = values; return child; } }), child);
  assert.equal(launch[1][0], path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  assert.deepEqual(launch[1].slice(1), ['--smoke-test']);
  assert.equal(launch[2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch[2].env.AI_RELAY_DESKTOP_DATA, env.AI_RELAY_DESKTOP_DATA);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1', 'Provider workers retain their parent environment.');
});

test('fresh desktop launches isolate setup and legacy data, preserve agent sign-ins and clean up after closing', () => {
  const env = { AI_RELAY_DESKTOP_DATA: '/saved/profile', AI_RELAY_LEGACY_DATA_DIR: '/saved/legacy', AI_RELAY_CODEX_BIN: '/installed/codex', AI_RELAY_CLAUDE_BIN: '/installed/claude', ELECTRON_RUN_AS_NODE: '1' };
  const launches = [];
  const spawnImpl = (...values) => { const child = new EventEmitter(); launches.push({ values, child }); return child; };
  const first = launchDesktop({ args: ['--fresh'], env, spawnImpl });
  const second = launchDesktop({ args: ['--fresh'], env, spawnImpl });
  const firstEnv = launches[0].values[2].env, secondEnv = launches[1].values[2].env;
  const firstRoot = path.dirname(firstEnv.AI_RELAY_DESKTOP_DATA), secondRoot = path.dirname(secondEnv.AI_RELAY_DESKTOP_DATA);
  try {
    assert.notEqual(firstRoot, secondRoot, 'Each launch starts with its own empty profile.');
    assert.notEqual(firstEnv.AI_RELAY_DESKTOP_DATA, env.AI_RELAY_DESKTOP_DATA);
    assert.equal(firstEnv.AI_RELAY_LEGACY_DATA_DIR, path.join(firstRoot, 'no-legacy-data'));
    assert.equal(fs.existsSync(firstEnv.AI_RELAY_LEGACY_DATA_DIR), false, 'Saved workspaces cannot migrate into the fresh profile.');
    assert.equal(firstEnv.AI_RELAY_CODEX_BIN, env.AI_RELAY_CODEX_BIN);
    assert.equal(firstEnv.AI_RELAY_CLAUDE_BIN, env.AI_RELAY_CLAUDE_BIN);
    assert.equal(firstEnv.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(launches[0].values[1].includes('--fresh'), false);
    assert.equal(env.AI_RELAY_DESKTOP_DATA, '/saved/profile');
    first.emit('close', 0);assert.equal(fs.existsSync(firstRoot), false);assert.equal(fs.existsSync(secondRoot), true);
    second.emit('close', 0);assert.equal(fs.existsSync(secondRoot), false);
  } finally { first.emit('close', 0);second.emit('close', 0); }
});

test('the no-agents preview hides installed agents only in its isolated child process', () => {
  const env = { AI_RELAY_CODEX_BIN: '/installed/codex', AI_RELAY_CLAUDE_BIN: '/installed/claude', AI_RELAY_GEMINI_BIN: '/installed/gemini' };
  const child = new EventEmitter();let launch;
  launchDesktop({ args: ['--fresh', '--no-agents'], env, spawnImpl: (...values) => { launch = values;return child; } });
  const childEnv = launch[2].env, previewRoot = path.dirname(childEnv.AI_RELAY_DESKTOP_DATA);
  try {
    assert.equal(childEnv.AI_RELAY_CODEX_BIN, path.join(previewRoot, 'not-installed-codex'));
    assert.equal(childEnv.AI_RELAY_CLAUDE_BIN, path.join(previewRoot, 'not-installed-claude'));
    assert.equal(childEnv.AI_RELAY_GEMINI_BIN, path.join(previewRoot, 'not-installed-gemini'));
    assert.equal(fs.existsSync(childEnv.AI_RELAY_CODEX_BIN), false);
    assert.equal(fs.existsSync(childEnv.AI_RELAY_CLAUDE_BIN), false);
    assert.equal(fs.existsSync(childEnv.AI_RELAY_GEMINI_BIN), false);
    assert.deepEqual(launch[1].slice(1), []);
    assert.deepEqual(env, { AI_RELAY_CODEX_BIN: '/installed/codex', AI_RELAY_CLAUDE_BIN: '/installed/claude', AI_RELAY_GEMINI_BIN: '/installed/gemini' });
  } finally { child.emit('close', 0); }
  assert.equal(fs.existsSync(previewRoot), false);
});

test('a failed fresh launch cleans up its temporary profile', () => {
  let previewRoot;
  assert.throws(() => launchDesktop({ args: ['--fresh'], spawnImpl: (_bin, _args, options) => {
    previewRoot = path.dirname(options.env.AI_RELAY_DESKTOP_DATA);
    throw new Error('Electron could not start.');
  } }), /Electron could not start/);
  assert.equal(fs.existsSync(previewRoot), false);
});
