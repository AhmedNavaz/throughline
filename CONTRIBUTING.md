# Contributing to Throughline

Thanks for helping. Bug reports, fixes and focused improvements are all welcome.

## Set up

You need Node.js 22.12 or later. Claude Code and/or the Codex CLI are only needed to try real runs; the test suite uses mocks.

```sh
npm ci
npm start        # desktop app
npm run web      # browser-only session on http://127.0.0.1:4318
```

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

Open an issue with your OS, Node.js version, which agent you used (Claude Code or Codex, with its version) and the steps to reproduce. Please remove anything private from logs and screenshots. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
