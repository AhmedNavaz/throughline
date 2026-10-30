import assert from 'node:assert/strict';
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
