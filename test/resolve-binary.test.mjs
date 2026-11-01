import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBinary } from '../src/resolve-binary.mjs';
import { Broker } from '../src/broker.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-relay-resolver-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    home, env: { PATH: path.join(root, 'empty-path') }, platform: 'darwin', arch: 'arm64',
    applicationRoots: [], extensionRoots: [], systemBinDirs: [],
  };
  function executable(filename, source = '#!/bin/sh\nexit 0\n') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source, { mode: 0o700 });
    return filename;
  }
  return { root, home, options, executable };
}

test('explicit overrides win, expand home paths, and do not silently fall back when invalid', t => {
  const f = setup(t);
  const onPath = f.executable(path.join(f.root, 'path-bin', 'codex'));
  const environment = f.executable(path.join(f.root, 'env-bin', 'codex'));
  const explicit = f.executable(path.join(f.root, 'explicit-bin', 'codex'));
  const options = { ...f.options, env: { PATH: path.dirname(onPath), AI_RELAY_CODEX_BIN: environment } };
  assert.equal(resolveBinary('codex', { ...options, override: explicit }), explicit);
  assert.equal(resolveBinary('codex', options), environment);
  assert.equal(resolveBinary('codex', { ...options, override: '~/selected/codex' }), path.join(f.home, 'selected', 'codex'));
  const missing = path.join(f.root, 'missing', 'codex');
  assert.equal(resolveBinary('codex', { ...options, override: missing }), missing);
  assert.equal(resolveBinary('codex', { ...f.options, override: 'deliberately-selected-command' }), 'deliberately-selected-command');
  const custom = f.executable(path.join(f.root, 'path-bin', 'custom-codex'));
  assert.equal(resolveBinary('codex', { ...options, override: 'custom-codex' }), custom);
});

test('PATH order wins over install fallbacks and skips non-executable files and directories', t => {
  const f = setup(t);
  const notExecutable = path.join(f.root, 'non-executable', 'codex');
  f.executable(notExecutable);
  fs.chmodSync(notExecutable, 0o600);
  const directory = path.join(f.root, 'directory-bin', 'codex');
  fs.mkdirSync(directory, { recursive: true });
  const first = f.executable(path.join(f.root, 'first bin', 'codex'));
  const second = f.executable(path.join(f.root, 'second-bin', 'codex'));
  f.executable(path.join(f.home, '.local', 'bin', 'codex'));
  const env = { PATH: [path.dirname(notExecutable), path.dirname(directory), path.dirname(first), path.dirname(second)].join(path.delimiter) };
  assert.equal(resolveBinary('codex', { ...f.options, env }), first);
});

test('standard home install locations and CODEX_INSTALL_DIR are discovered without PATH', t => {
  const f = setup(t);
  const local = f.executable(path.join(f.home, '.local', 'bin', 'codex'));
  assert.equal(resolveBinary('codex', f.options), local);
  const custom = f.executable(path.join(f.root, 'custom-install', 'codex'));
  assert.equal(resolveBinary('codex', { ...f.options, env: { PATH: '', CODEX_INSTALL_DIR: path.dirname(custom) } }), custom);
  const claude = f.executable(path.join(f.home, '.npm-global', 'bin', 'claude'));
  assert.equal(resolveBinary('claude', f.options), claude);
});

test('Antigravity CLI takes priority over deprecated Gemini CLI and explicit overrides stay respected', t => {
  const f = setup(t);
  const legacyGemini = f.executable(path.join(f.home, '.local', 'bin', 'gemini'));
  const agy = f.executable(path.join(f.home, '.gemini', 'bin', 'agy'));
  assert.equal(resolveBinary('gemini', f.options), agy);
  assert.equal(resolveBinary('gemini', { ...f.options, override: legacyGemini }), legacyGemini);
  fs.unlinkSync(agy);
  assert.equal(resolveBinary('gemini', f.options), legacyGemini);
});

test('Windows CLI discovery splits PATH entries and ignores non-runnable .cmd shims', t => {
  const f = setup(t);
  const codex = f.executable(path.join(f.root, 'windows path', 'codex.exe'));
  const claudeShim = f.executable(path.join(f.root, 'npm bin', 'claude.cmd'));
  const options = {
    ...f.options,
    platform: 'win32',
    arch: 'x64',
    env: { Path: [path.dirname(codex), path.dirname(claudeShim)].join(';') },
  };

  assert.equal(resolveBinary('codex', options), codex);
  assert.equal(resolveBinary('claude', options), null,
    'npm .cmd shims are not selected because spawning them needs a shell');
});

test('Windows Codex install under LOCALAPPDATA is discovered', t => {
  const f = setup(t);
  const localAppData = path.join(f.root, 'local app data');
  const codex = f.executable(path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  const options = {
    ...f.options,
    platform: 'win32',
    arch: 'x64',
    env: { PATH: '', LOCALAPPDATA: localAppData },
  };

  assert.equal(resolveBinary('codex', options), codex);
});

test('Linux user install locations are discovered without PATH', t => {
  const f = setup(t);
  const codex = f.executable(path.join(f.home, '.local', 'bin', 'codex'));
  const claude = f.executable(path.join(f.home, '.npm-global', 'bin', 'claude'));
  const options = { ...f.options, platform: 'linux', arch: 'x64', env: { PATH: '' } };

  assert.equal(resolveBinary('codex', options), codex);
  assert.equal(resolveBinary('claude', options), claude);
});

test('macOS app bundles are discovered after standard installs', t => {
  const f = setup(t);
  const applications = path.join(f.root, 'Applications');
  const bundled = f.executable(path.join(applications, 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'));
  const options = { ...f.options, applicationRoots: [applications] };
  assert.equal(resolveBinary('codex', options), bundled);
  const onPath = f.executable(path.join(f.root, 'preferred-bin', 'codex'));
  assert.equal(resolveBinary('codex', { ...options, env: { PATH: path.dirname(onPath) } }), onPath);
  assert.equal(resolveBinary('claude', options), null, 'a bundled Codex executable is never used for Claude');
});

test('VS Code fallback selects the highest numeric version for the host architecture', t => {
  const f = setup(t);
  const extensions = path.join(f.root, 'extensions');
  const old = f.executable(path.join(extensions, 'openai.chatgpt-0.9.0-darwin-arm64', 'bin', 'macos-aarch64', 'codex'));
  const latest = f.executable(path.join(extensions, 'openai.chatgpt-0.10.0-darwin-arm64', 'bin', 'macos-aarch64', 'codex'));
  const x64 = f.executable(path.join(extensions, 'openai.chatgpt-99.0.0-darwin-x64', 'bin', 'macos-x86_64', 'codex'));
  f.executable(path.join(extensions, 'openai.chatgpt-100.0.0-linux-x64', 'bin', 'linux-x86_64', 'codex'));
  const options = { ...f.options, extensionRoots: [extensions] };
  assert.equal(resolveBinary('codex', options), latest);
  assert.equal(resolveBinary('codex', { ...options, arch: 'x64' }), x64);
  fs.unlinkSync(latest);
  assert.equal(resolveBinary('codex', options), old, 'a stale extension without its executable is skipped');
});

test('relative and empty PATH entries never discover executables inside the target workspace', t => {
  const f = setup(t);
  const workspace = path.join(f.root, 'untrusted-project');
  f.executable(path.join(workspace, 'codex'));
  f.executable(path.join(workspace, 'node_modules', '.bin', 'codex'));
  const previous = process.cwd();
  try {
    process.chdir(workspace);
    assert.equal(resolveBinary('codex', { ...f.options, env: { PATH: ['', '.', 'node_modules/.bin'].join(path.delimiter) } }), null);
  } finally { process.chdir(previous); }
});

test('Broker status probes and actual runs use the same selected executable', async t => {
  const f = setup(t);
  const workspace = path.join(f.root, 'project');
  fs.mkdirSync(workspace);
  const capture = path.join(f.root, 'invocations.jsonl');
  const source = `#!${process.execPath}\n`
    + `import fs from 'node:fs';\n`
    + `fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');\n`
    + `if(process.argv.includes('--version')){console.log('resolver-fixture 1.0');process.exit(0);}\n`
    + `for await(const chunk of process.stdin){}\n`
    + `console.log(JSON.stringify({type:'thread.started',thread_id:'resolver-thread'}));\n`
    + `console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'Resolved binary ran.'}}));\n`
    + `console.log(JSON.stringify({type:'turn.completed'}));\n`;
  const selected = f.executable(path.join(f.root, 'selected binary', 'codex.mjs'), source);
  const broker = new Broker({ workspace, dataDir: path.join(f.root, 'history'), bins: { codex: selected, claude: selected } });
  t.after(() => broker.close());
  const status = await broker.status();
  assert.equal(status.providers.codex.available, true);
  assert.equal(status.providers.codex.version, 'resolver-fixture 1.0');
  assert.equal(broker.bins.codex, selected);
  await broker.status();
  assert.equal(fs.readFileSync(capture, 'utf8').trim().split('\n').length, 2);
  broker.providerStatusCheckedAt = 0;
  await Promise.all([broker.status(), broker.status()]);
  const c = broker.get(broker.create().id);
  broker.start(c, { text: 'Run the selected binary', provider: 'codex', mode: 'read' });
  await broker.running.done;
  assert.equal(c.status, 'complete');
  assert.ok(c.messages.some(message => message.text === 'Resolved binary ran.'));
  const invocations = fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(invocations.filter(invocation => invocation.args.includes('--version')).length, 4);
  assert.equal(invocations.filter(invocation => invocation.args.includes('exec')).length, 1);
  assert.ok(invocations.every(invocation => invocation.cwd === fs.realpathSync(workspace) || invocation.args.includes('--version')));
});
