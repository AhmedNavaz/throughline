# Security policy

Throughline runs coding agents against your local files, so security reports are taken seriously.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue. Include what is affected, how to reproduce it and the impact you expect. You should receive a reply within a few days.

## How Throughline is meant to be safe

- The local server listens on `127.0.0.1` only and rejects other hosts and cross-origin requests. The desktop app also requires a per-launch access token.
- Agents run through the official Claude Code and Codex CLIs with their own sign-in. Throughline ships no API keys and never copies provider credentials.
- Tool approvals are shown in the app. No unrestricted execution mode is enabled.
- Git reads disable hooks, filesystem monitors, external diff programs, text converters and filter drivers.
- Shared files (exports, friend requests) are reviewed before they leave your machine. Secret scanning helps, but it cannot guarantee that nothing sensitive is included.

Reports that bypass any of these are especially welcome.
