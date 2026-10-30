<p align="center"><img src="assets/icon.svg" width="120" alt="Throughline logo: one thread, teal to coral, looping once"></p>

<h1 align="center">Throughline</h1>

<p align="center">One coding conversation per project, shared across Claude Code, Codex and your teammates.<br>Runs on your own Claude and Codex subscriptions.</p>

<p align="center"><a href="https://github.com/AhmedNavaz/throughline/actions/workflows/ci.yml"><img src="https://github.com/AhmedNavaz/throughline/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="https://github.com/AhmedNavaz/throughline/releases/latest"><img src="https://img.shields.io/github/v/release/AhmedNavaz/throughline" alt="Latest release"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a></p>

<p align="center"><img src="docs/screenshot.png" alt="Throughline: a project conversation shared by Claude and Codex, with the file browser, Git activity and plan usage" width="900"></p>

Throughline is a desktop app for working with AI coding agents. Each project is a workspace with one or more folders and exactly one permanent conversation. Use Claude Code or Codex in that conversation and switch between them whenever you like; the history, saved context and drafts stay in one place.

- **One thread per project.** Frontend, backend and website folders can share a single conversation.
- **Switch agents without losing context.** When one agent hits a usage limit, continue with the other.
- **Bring your history.** Import existing Claude Code and Codex chats from any project and merge them in time order.
- **Hand off to a person.** Export a conversation file for another Throughline user, or ask a friend for a reviewable patch.
- **See what changed.** Git activity with per-file diffs, a file browser and plan usage for both agents.
- **Your accounts, your machine.** Throughline drives the official Claude Code and Codex CLIs you already have installed. It ships no API keys and adds no service of its own.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/AhmedNavaz/throughline/main/install.sh | sh
```

This installs the latest release for your Mac (Apple Silicon or Intel) after checking its published checksum. You also need [Claude Code](https://code.claude.com/docs/en/overview) and/or the [Codex CLI](https://github.com/openai/codex) installed and signed in.

<details>
<summary>Other ways to install</summary>

**Download the app.** Get the zip for your Mac from [Releases](https://github.com/AhmedNavaz/throughline/releases/latest) and move **Throughline** to Applications. The app is not notarized by Apple yet, so the first time you open a browser download macOS says it cannot verify the developer: open **System Settings › Privacy & Security** and click **Open Anyway**. If macOS says the app is damaged, run `xattr -cr /Applications/Throughline.app`.

**Run from source** with Node.js 22.12 or later:

```sh
git clone https://github.com/AhmedNavaz/throughline.git
cd throughline
npm ci
npm start
```

</details>

## How it works

1. **Create a workspace** and add your project's folders.
2. **Pick Claude or Codex** in the composer, choose the model and send. Switch agents whenever you like; the next one receives the shared conversation as context.
3. **Bring people and history in.** Use **Import chat** for existing Claude Code and Codex chats, **Export** to hand a conversation to someone else, and **Ask a Friend** to get a reviewable patch back.

Nothing runs until you press **Send**, and every run uses your own installed CLI and account. The [guide](docs/guide.md) covers each feature in detail, including limits and what is stored where.

## Roadmap

Next up: notarized macOS builds, automatic updates, Windows and Linux builds, and committing from the Git panel. See [ROADMAP.md](ROADMAP.md) for the full plan and good places to help.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup, maps the codebase and lists where to start. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Throughline is an independent project, not affiliated with or endorsed by Anthropic or OpenAI. Claude, Claude Code, Codex and related names are trademarks of their respective owners.
