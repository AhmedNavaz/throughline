<p align="center"><img src="assets/icon.svg" width="120" alt="Throughline logo: one thread, teal to coral, looping once"></p>

<h1 align="center">Throughline</h1>

<p align="center">Your control plane for agentic development.<br>Coordinate Claude Code and Codex with persistent project context and your own accounts.</p>

<p align="center"><a href="https://github.com/AhmedNavaz/throughline/actions/workflows/ci.yml"><img src="https://github.com/AhmedNavaz/throughline/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="https://github.com/AhmedNavaz/throughline/releases/latest"><img src="https://img.shields.io/github/v/release/AhmedNavaz/throughline" alt="Latest release"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a> <a href="https://www.patreon.com/17048317/join"><img src="https://img.shields.io/badge/Support-Patreon-FF424D?logo=patreon&amp;logoColor=white" alt="Support Throughline on Patreon"></a></p>

<p align="center"><img src="docs/screenshot.png" alt="Throughline: a project conversation shared by Claude and Codex, with the file browser, Git activity and plan usage" width="900"></p>

Throughline is an open-source desktop control plane for agentic development. It brings Claude Code and Codex into a unified workspace for multi-agent orchestration, persistent project context, and human-in-the-loop collaboration.

Each project becomes a continuous working thread: its folders, conversation, saved context, and agent activity stay together as the work evolves. Carry work between agents, consolidate fragmented chat histories, inspect execution and code changes, and exchange reviewable patches with collaborators. Throughline runs through your installed agent CLIs and existing accounts, with you directing the workflow.

## Features

**Multi-agent orchestration and continuity**

- One permanent conversation per project, shared by all its folders, such as frontend, backend and website.
- Switch between Claude Code and Codex mid-task, for example when one hits its usage limit. The next agent picks up the shared context.
- Choose the model, reasoning effort and access (read only or can edit files) for every message.
- Approve agent actions in the app and follow each run live: current step, tool calls, elapsed time and token counts.
- Run agents in several workspaces at once; the sidebar shows which ones are busy.
- Find earlier messages and code with Cmd/Ctrl+F, highlighted matches and next/previous navigation.

**Execution visibility and developer controls**

- Git activity for each folder: changed files with diffs, and recent commits.
- A file browser with syntax-highlighted previews. Attach files and images by clicking, dragging or pasting.
- Plan usage for both agents in the status bar, with reset times.
- Keep awake: your Mac stays awake while agents are working and sleeps normally once they finish.

**Context portability and human collaboration**

- Import Claude Code and Codex chats from any project, merged in time order.
- Export a conversation file for another Throughline user, with secrets and local paths removed.
- Ask a Friend: share an approved snapshot of your code and get back a patch you review before applying.

**A local workspace, powered by your accounts**

- System appearance alongside explicit Dark and Light themes, keyboard shortcuts, Markdown replies with highlighted code and copy buttons, and a short setup guide.
- Runs the official Claude Code and Codex CLIs you already have, on your own subscriptions. It ships no API keys and adds no service of its own.

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
3. **Bring people and history in.** After opening a workspace, review the previous chats found for its folders, or use **Previous chats** to select and merge Claude Code and Codex conversations. **Export** hands a conversation to someone else, and **Ask a Friend** brings back a patch you review.

Nothing runs until you press **Send**, and every run uses your own installed CLI and account. The [guide](docs/guide.md) covers each feature in detail, including limits and what is stored where.

## Roadmap

Next up: notarized macOS builds, automatic updates, resuming work as soon as a usage limit resets, Windows and Linux builds, and more agents and models such as Gemini, Grok and DeepSeek. Further out: voice mode (say what you want, hear a short summary of what changed), automatic model and effort choice for each request, live progress in your Mac's menu bar or notch, and agents that review each other's work. See [ROADMAP.md](ROADMAP.md) for what has shipped and the full plan.

## Support Throughline

If Throughline helps your work, you can [support its development on Patreon](https://www.patreon.com/17048317/join). Sponsorship helps fund maintenance, fixes and new features.

## Contributing

The most helpful thing you can do right now is use Throughline and tell us what you find: [report a bug](https://github.com/AhmedNavaz/throughline/issues/new?template=bug_report.yml) or [share design feedback](https://github.com/AhmedNavaz/throughline/issues/new?template=ux_feedback.yml). Code contributions are welcome too; [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup, maps the codebase and lists where to start. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Throughline is an independent project, not affiliated with or endorsed by Anthropic or OpenAI. Claude, Claude Code, Codex and related names are trademarks of their respective owners.
