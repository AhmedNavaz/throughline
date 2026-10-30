# Roadmap

Where Throughline is heading. Priorities can change with feedback, so treat this as a plan rather than a promise. To work on an item, comment on its issue or open one first so we can agree on the approach.

## Use it and tell us what breaks

The fastest way to make Throughline better is to use it on your real projects and tell us what you find: bugs, confusing screens, slow spots and rough edges in the design. A small UI or UX note is as welcome as a crash report. [Report a bug](https://github.com/AhmedNavaz/throughline/issues/new?template=bug_report.yml) or [share design feedback](https://github.com/AhmedNavaz/throughline/issues/new?template=ux_feedback.yml).

## Now

- **Notarized macOS builds.** Sign releases with an Apple Developer ID and notarize them, so downloads open without a security prompt. `npm run package` already accepts a signing identity; the release workflow needs the certificate and notarization steps.
- **Automatic updates.** Let the app update itself from GitHub Releases. Depends on signed builds.
- **Homebrew.** `brew install --cask throughline`. Depends on notarized builds.

## Next

- **More agents and models.** Gemini, Grok, DeepSeek, Qwen and local models (for example through Ollama) in the same project conversation, each on your own account or API key, using official CLIs where they exist.
- **Windows and Linux builds.** Package and test both platforms in CI, including CLI discovery in `resolve-binary.mjs` and the Git safety settings.
- **Commit from the Git panel.** Stage reviewed changes, write a message and commit. The panel is read-only today.
- **Integrated workspace terminal.** A collapsible, resizable bottom panel for running your own shell in a chosen workspace folder. Run tests, install dependencies and keep a dev server running alongside the conversation. Each workspace keeps its terminal session while you switch projects; hiding the panel leaves processes running, and closing a session or quitting the app cleans them up. Start with one terminal per workspace on macOS, then add tabs and split panes. Later, send selected output to the conversation for help debugging.
- **Search the conversation.** Find earlier messages, code and decisions in a long project conversation and jump to them.
- **Easier link-service hosting.** Ready-made deployment templates, so Ask a Friend links work without setting up a server by hand.
- **Run project tests on returned patches.** With your approval, run the project's own test command after applying a friend's patch. Today verification stops at syntax and whitespace checks.

## Big ideas

Things no coding tool brings together in one place today. Each needs design work first, so open an issue to shape one before building it. Like everything else in Throughline, they run on your own subscriptions.

- **Voice mode.** Talk to your project hands-free: say what you want, the agent does it, then reads back a short spoken summary of what changed. Ask about the project out loud too, such as "what did we decide about payments?" or "what's left before the release?". Speech recognition runs on your Mac where possible.
- **Smart model and effort.** Throughline reads each request and picks the agent, model and reasoning effort that fit it: a quick rename gets a fast, light model, a tricky architecture change gets the strongest one. It shows its choice before running so you can change it, and saves usage on simple tasks.
- **Live status at a glance.** A menu bar item and a notch-style overlay on your Mac show the current step, highlights of what changed and when the agent needs your input, so you can work in other apps while it runs.
- **Play while it works.** Small built-in games for long runs that pause the moment the agent needs you. Vibe coding should be fun.
- **Tag-team agents.** One agent builds while the other reviews the diff before you see it, for example Claude implements and Codex checks the result.
- **Race mode.** Send the same task to two agents at once, each in its own Git worktree, then compare the results side by side and keep the better one.
- **Budget-aware handoff.** When one agent nears its usage limit mid-task, Throughline offers the switch to another (or makes it, if you allow that) and can queue work to start when a limit resets.
- **Everything in the thread.** Bring GitHub issues, pull requests, CI failures, terminal output and error logs into the project conversation as context, and open a pull request from it.
- **Point and tell.** Run your app's preview inside the workspace, click an element and say or type what should change.
- **Rewind.** One timeline of messages, file changes and commits, with checkpoints that undo exactly what an agent did at any step.
- **Project memory.** A living brief of goals, decisions and conventions that every agent reads, updated from the conversation with your approval.
- **"While you were away" recaps.** A short written or spoken briefing of what ran, what changed and what is waiting for you.
- **Approve from your phone.** Follow runs, answer approval requests and hear recaps on your phone, with progress in iPhone Live Activities, while the work runs on your Mac.
- **Live multiplayer.** Teammates join the same project conversation in real time, each running agents on their own subscription.

## Later

- Binary files in Ask a Friend patches.
- An accessibility pass covering keyboard navigation and screen readers, and translations of the interface.

## Good places to start

- Use Throughline on a real project and report what you notice, from bugs to design details.
- Issues labelled [good first issue](https://github.com/AhmedNavaz/throughline/labels/good%20first%20issue) or [help wanted](https://github.com/AhmedNavaz/throughline/labels/help%20wanted).
- Small interface polish and clearer documentation in the [guide](docs/guide.md).
- Tests for Windows and Linux paths, which also move the platform work forward.

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and a map of the codebase.
