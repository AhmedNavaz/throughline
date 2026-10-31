# Roadmap

What Throughline already does, what is coming next and the bigger ideas being explored. **Now** is the current focus, **Next** is follow-up work, **Later** is further out, and **Exploring** holds larger ideas that need design before implementation. Dependencies are listed per item; blocked work does not hold up independent improvements. Priorities can change with feedback, so treat this as a plan rather than a promise.

Every planned item has an issue. Comment there to shape it or to pick it up, and open one first for anything new. Release-by-release details are in the [changelog](CHANGELOG.md); bugs are tracked under the [bug label](https://github.com/AhmedNavaz/throughline/labels/bug).

## Use it and tell us what breaks

The fastest way to make Throughline better is to use it on your real projects and tell us what you find: bugs, confusing screens, slow spots and rough edges in the design. A small UI or UX note is as welcome as a crash report. [Report a bug](https://github.com/AhmedNavaz/throughline/issues/new?template=bug_report.yml) or [share design feedback](https://github.com/AhmedNavaz/throughline/issues/new?template=ux_feedback.yml).

## Shipped

| Feature | Since |
| --- | --- |
| Workspaces with one or more folders and one permanent conversation | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Claude Code and Codex in the same conversation, switching mid-task with shared context | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Model, reasoning effort and access chosen per message, with approvals and a live run view | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Import Claude Code and Codex chats from any project, merged in time order | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Conversation export for other Throughline users, with secrets and local paths removed | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Ask a Friend: share an approved snapshot and apply a reviewed patch | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Git activity with per-file diffs and recent commits | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| File browser with syntax-highlighted previews, and file and image attachments | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Plan usage for each agent, with reset times | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Keep awake while agents are working | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| Dark and light themes and keyboard shortcuts | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| macOS builds for Apple Silicon and Intel, and a container image for the private-link service | [0.4.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0) |
| One-line install from Terminal, checked against published checksums | [0.5.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.5.0) |
| First-run welcome and setup, and a continue-or-start-fresh choice after reinstalling | [0.5.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.5.0) |
| Suggestions for earlier Claude Code and Codex chats that match a workspace's folders | [0.6.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.6.0) |
| Search the conversation with Cmd/Ctrl+F, highlights and next/previous matches | [0.7.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.7.0) |
| System appearance alongside explicit Light and Dark themes | [0.7.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.7.0) |
| Quiet background agent checks that preserve verified connection status | [0.7.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.7.0) |
| Native desktop menus for workspace, conversation, agent, appearance and Help controls | [0.8.0](https://github.com/AhmedNavaz/throughline/releases/tag/v0.8.0) |

## Now

| Feature | Status | Issue |
| --- | --- | --- |
| Compact workspace activity with clear actions, results and expandable details | Planned, help wanted | [#45](https://github.com/AhmedNavaz/throughline/issues/45) |
| Persistent approval indicators and desktop notifications that open the right request | Planned | [#46](https://github.com/AhmedNavaz/throughline/issues/46) |
| Notarized macOS builds, so downloads open without a security prompt | Waiting on an Apple Developer account | [#1](https://github.com/AhmedNavaz/throughline/issues/1) |
| Update button: get new versions from inside the app with one click | Planned | [#2](https://github.com/AhmedNavaz/throughline/issues/2) |
| Install with Homebrew: `brew install --cask throughline` | Depends on #1 | [#3](https://github.com/AhmedNavaz/throughline/issues/3) |

## Next

| Feature | Status | Issue |
| --- | --- | --- |
| Run, test and stop the current project with saved commands and live output | Planned; first step toward the terminal | [#47](https://github.com/AhmedNavaz/throughline/issues/47) |
| Full auto-approval for agent tool requests, with an explicit visible permission mode | Provider permission mapping needs design | [#48](https://github.com/AhmedNavaz/throughline/issues/48) |
| Resume when limits reset: continue on whichever agent resets first, and queue prompts until then | Planned, help wanted | [#32](https://github.com/AhmedNavaz/throughline/issues/32) |
| More agents and models: Gemini, Grok, DeepSeek, Qwen and local models, on your own accounts | Planned, help wanted | [#4](https://github.com/AhmedNavaz/throughline/issues/4) |
| Windows and Linux builds | Planned, help wanted | [#5](https://github.com/AhmedNavaz/throughline/issues/5) |
| Commit reviewed changes from the Git panel | Planned | [#6](https://github.com/AhmedNavaz/throughline/issues/6) |
| Integrated workspace terminal | Follows project command controls; PTY design needed | [#7](https://github.com/AhmedNavaz/throughline/issues/7) |
| Deployment templates for the private-link service | Planned, help wanted | [#9](https://github.com/AhmedNavaz/throughline/issues/9) |
| Run the project's own tests on a returned patch, with approval | Planned | [#10](https://github.com/AhmedNavaz/throughline/issues/10) |

## Later

| Feature | Status | Issue |
| --- | --- | --- |
| Binary files in Ask a Friend patches | Planned | [#25](https://github.com/AhmedNavaz/throughline/issues/25) |
| Accessibility pass for keyboard navigation and screen readers | Help wanted | [#26](https://github.com/AhmedNavaz/throughline/issues/26) |
| Interface translations | Help wanted | [#27](https://github.com/AhmedNavaz/throughline/issues/27) |

## Exploring

Larger ideas for bringing project context, execution and collaboration into one workspace. Each needs design work first, so join the issue before building. They continue to use your own agent accounts.

| Idea | Issue |
| --- | --- |
| **Voice mode.** Say what you want, the agent does it, then reads back a short spoken summary. Ask about the project out loud too. | [#11](https://github.com/AhmedNavaz/throughline/issues/11) |
| **Smart model and effort.** Pick the agent, model and effort that fit each request, to save usage on simple tasks. | [#12](https://github.com/AhmedNavaz/throughline/issues/12) |
| **Live status at a glance.** Progress and input requests in the Mac menu bar and around the notch, extending the desktop approval alerts in [#46](https://github.com/AhmedNavaz/throughline/issues/46). | [#13](https://github.com/AhmedNavaz/throughline/issues/13) |
| **Play while it works.** Small built-in games for long runs that pause the moment the agent needs you. | [#14](https://github.com/AhmedNavaz/throughline/issues/14) |
| **Tag-team agents.** One agent builds while the other reviews the diff before you see it. | [#15](https://github.com/AhmedNavaz/throughline/issues/15) |
| **Race mode.** Two agents take the same task in separate worktrees; keep the better result. | [#16](https://github.com/AhmedNavaz/throughline/issues/16) |
| **Budget-aware handoff.** Offer to switch agents before a usage limit stops the run. | [#17](https://github.com/AhmedNavaz/throughline/issues/17) |
| **Everything in the thread.** Issues, pull requests, CI failures and logs as context, and pull requests from the conversation. | [#18](https://github.com/AhmedNavaz/throughline/issues/18) |
| **Point and tell.** Click an element in your app's preview and say what should change. | [#19](https://github.com/AhmedNavaz/throughline/issues/19) |
| **Rewind.** One timeline of messages, file changes and commits, with checkpoints to undo any step. | [#20](https://github.com/AhmedNavaz/throughline/issues/20) |
| **Project memory.** A living brief of goals, decisions and conventions that every agent reads. | [#21](https://github.com/AhmedNavaz/throughline/issues/21) |
| **"While you were away" recaps.** A short written or spoken briefing of what ran and what is waiting. | [#22](https://github.com/AhmedNavaz/throughline/issues/22) |
| **Approve from your phone.** Extend desktop approval alerts to a paired phone, with run progress and iPhone Live Activities. | [#23](https://github.com/AhmedNavaz/throughline/issues/23) |
| **Live multiplayer.** Teammates in the same conversation in real time, each on their own subscription. | [#24](https://github.com/AhmedNavaz/throughline/issues/24) |

## Good places to start

- Use Throughline on a real project and report what you notice, from bugs to design details.
- Issues labelled [good first issue](https://github.com/AhmedNavaz/throughline/labels/good%20first%20issue) or [help wanted](https://github.com/AhmedNavaz/throughline/labels/help%20wanted), such as tests for Windows and Linux CLI discovery ([#28](https://github.com/AhmedNavaz/throughline/issues/28)).
- Small interface polish and clearer documentation in the [guide](docs/guide.md).

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and a map of the codebase.
