# Roadmap

Where Throughline is heading. Priorities can change with feedback, so treat this as a plan rather than a promise. To work on an item, comment on its issue or open one first so we can agree on the approach.

## Now

- **Notarized macOS builds.** Sign releases with an Apple Developer ID and notarize them, so downloads open without a security prompt. `npm run package` already accepts a signing identity; the release workflow needs the certificate and notarization steps.
- **Automatic updates.** Let the app update itself from GitHub Releases. Depends on signed builds.
- **Homebrew.** `brew install --cask throughline`. Depends on notarized builds.

## Next

- **Windows and Linux builds.** Package and test both platforms in CI, including CLI discovery in `resolve-binary.mjs` and the Git safety settings.
- **Commit from the Git panel.** Stage reviewed changes, write a message and commit. The panel is read-only today.
- **Search the conversation.** Find earlier messages, code and decisions in a long project conversation and jump to them.
- **Easier link-service hosting.** Ready-made deployment templates, so Ask a Friend links work without setting up a server by hand.
- **Run project tests on returned patches.** With your approval, run the project's own test command after applying a friend's patch. Today verification stops at syntax and whitespace checks.

## Big ideas

Things no coding tool brings together in one place today. Each needs design work first, so open an issue to shape one before building it. Like everything else in Throughline, they run on your own Claude and Codex subscriptions.

- **Voice mode.** Talk to your project hands-free: say what you want, the agent does it, then reads back a short spoken summary of what changed. Ask about the project out loud too, such as "what did we decide about payments?" or "what's left before the release?". Speech recognition runs on your Mac where possible.
- **Tag-team agents.** One agent builds while the other reviews the diff before you see it, for example Claude implements and Codex checks the result.
- **Race mode.** Send the same task to Claude and Codex at once, each in its own Git worktree, then compare the results side by side and keep the better one.
- **Budget-aware handoff.** When one agent nears its usage limit mid-task, Throughline offers the switch to the other (or makes it, if you allow that) and can queue work to start when a limit resets.
- **Everything in the thread.** Bring GitHub issues, pull requests, CI failures, terminal output and error logs into the project conversation as context, and open a pull request from it.
- **Point and tell.** Run your app's preview inside the workspace, click an element and say or type what should change.
- **Rewind.** One timeline of messages, file changes and commits, with checkpoints that undo exactly what an agent did at any step.
- **Project memory.** A living brief of goals, decisions and conventions that every agent reads, updated from the conversation with your approval.
- **"While you were away" recaps.** A short written or spoken briefing of what ran, what changed and what is waiting for you.
- **Approve from your phone.** Follow runs, answer approval requests and hear recaps on your phone while the work runs on your Mac.
- **Live multiplayer.** Teammates join the same project conversation in real time, each running agents on their own subscription.

## Later

- Support for more coding-agent CLIs alongside Claude Code and Codex.
- Binary files in Ask a Friend patches.
- An accessibility pass covering keyboard navigation and screen readers, and translations of the interface.

## Good places to start

- Issues labelled [good first issue](https://github.com/AhmedNavaz/throughline/labels/good%20first%20issue) or [help wanted](https://github.com/AhmedNavaz/throughline/labels/help%20wanted).
- Small interface polish, bugs you hit while using the app, and clearer documentation in the [guide](docs/guide.md).
- Tests for Windows and Linux paths, which also move the platform work forward.

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and a map of the codebase.
