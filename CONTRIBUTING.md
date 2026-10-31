# Contributing to Throughline

Thanks for helping. Bug reports, fixes and focused improvements are all welcome.

## Where to start

- Check the [roadmap](ROADMAP.md) for planned work, and issues labelled [good first issue](https://github.com/AhmedNavaz/throughline/labels/good%20first%20issue) or [help wanted](https://github.com/AhmedNavaz/throughline/labels/help%20wanted).
- For anything bigger than a bug fix, open an issue first so we can agree on the approach before you write code.
- The [guide](docs/guide.md) describes how each feature behaves, which is useful context before changing it.

## Set up

You need Node.js 22.12 or later. Claude Code, Codex CLI or Gemini CLI are only needed to try real runs; the test suite uses mocks.

```sh
npm ci
npm start        # desktop app
npm run start:fresh # replay onboarding with a temporary profile
npm run web      # browser-only session on http://127.0.0.1:4318
```

## Project map

The app is plain JavaScript with no build step: a local Node.js server, an Electron shell and a static web interface.

The [architecture guide](docs/architecture.md) explains service boundaries, data flow, persistence and where new features belong.

| Path | What it does |
| --- | --- |
| `server.mjs` | Local HTTP server bound to 127.0.0.1, with host, origin and token checks |
| `projects.mjs` | Workspace registry: folders and each workspace's single conversation |
| `broker.mjs`, `context.mjs` | Conversation journal, runs, and the shared context handed to each agent |
| `gemini.mjs`, `providers.mjs`, `provider-worker.mjs` | Claude Agent SDK, Codex app-server and Gemini CLI ACP adapters, accounts and plan usage; runs happen in a worker process |
| `local-models.mjs` | Ollama local-model discovery, validation and scoped Codex tool-harness launch routes |
| `resolve-binary.mjs` | Finds the installed `claude`, `codex` and `gemini` executables |
| `conversation-routes.mjs`, `conversation-import.mjs`, `conversation-export.mjs` | Previous-chat discovery, reviewed imports and conversation files for other users |
| `collaboration*.mjs`, `patches.mjs`, `sharing-client.mjs` | Ask a Friend: approved packages, returned patches and the private-link client |
| `workspace-*.mjs`, `file-explorer.mjs`, `mutation-lock.mjs` | Safe file access, Git activity, snapshots and locks that prevent conflicting edits |
| `public/` | Interface: `app.js` (core), `insights.js` (models, progress, Git and usage), `conversation-history.js` (import and export), `conversation-search.js` (find in the conversation), `files.js`, `setup.js`, `workbench.js` (Ask a Friend) and the CSS |
| `desktop/` | Electron main process, preload bridge, packaging and icon generation |
| `sharing/` | The self-hostable private-link service and its container image |
| `test/` | Node test runner suites; the interface tests use a small fake DOM |
| `assets/`, `output/` | Shipped branding assets, and disposable generated assets excluded from Git and desktop packages |

## Before you open a pull request

```sh
npm test
npm run test:desktop
```

- Keep changes focused, and add or update tests for behavior you change.
- Tests must never call a real model or touch your saved history.
- Match the surrounding style: plain JavaScript ES modules, no build step and no new runtime dependencies without discussion.
- The interface must work under the server's Content Security Policy: no inline scripts or `style` attributes, and no `innerHTML` for provider or user content. Build DOM nodes instead.
- Colors, sizes and icons come from the tokens in `public/editor-theme.css`; please don't hard-code colors in components.
- Some identifiers still use the project's former name (`ai-relay.*` file formats, the `X-AI-Relay` header, `AI_RELAY_*` variables). They are kept on purpose for compatibility; don't rename them without a migration.

## Reporting bugs

Use the [bug report](https://github.com/AhmedNavaz/throughline/issues/new?template=bug_report.yml) form, or [design feedback](https://github.com/AhmedNavaz/throughline/issues/new?template=ux_feedback.yml) for anything confusing or rough in the interface. Include your Throughline and macOS versions, the agent you used and the steps to reproduce. Please remove anything private from logs and screenshots. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Releasing

Maintainers: bump `version` in `package.json`, add a section to [CHANGELOG.md](CHANGELOG.md) and push a matching tag such as `v0.4.1`. GitHub Actions tests and builds both macOS apps, publishes the private-link service image and creates the release.

The in-app **What’s New** panel reads versioned entries from the bundled changelog. Move completed **Unreleased** entries into the matching release section before packaging; unreleased and newer-version entries are excluded from the panel.
