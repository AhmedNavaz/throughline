# Changelog

Notable changes to Throughline. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.10.1] - 2026-10-31

### Added

- **Google Antigravity (`agy`) for Gemini**: Gemini now connects through the official Google Antigravity CLI (`agy`) with your Google account, featuring real-time streaming, safe workspace edit permissions, and model selection filtered exclusively for Gemini models.
- **Agent installation guidance**: When an assistant is not detected, Settings and the connection banner display the install command and a direct link to the setup guide.

### Changed

- **What’s New** in the app now shows short, plain-language highlights from the user's perspective without GitHub issue or pull request numbers. Select **Full release notes** at any time to read the complete technical story on GitHub.

### Fixed

- Throughline now finds Gemini CLI / Antigravity, Claude Code and Codex installed with Volta, nvm, pnpm, Bun, mise, asdf or fnm when opened from Applications on macOS. Child CLI runs also keep that runtime directory on `PATH` so Node-based shims start reliably.

## [0.10.0] - 2026-10-31

### Added

- **Gemini**: use Gemini CLI alongside Claude Code and Codex in the same project conversation, signed in with your own Google account. Runs over the Agent Client Protocol (`0.66.0+`) with read-only and edit access modes, isolated per-run policies, in-app approvals for edits and shell commands, verified custom model selection, quota and interruption handoffs, and conversation export ([#4](https://github.com/AhmedNavaz/throughline/issues/4)).
- **Continue locally**: hand off a task to a downloaded Ollama coding model with your saved project context and workspace approvals. Uses Codex's native workspace tools with separate model and billing attribution, preserves cloud settings and sessions, and never falls back to a cloud model ([#4](https://github.com/AhmedNavaz/throughline/issues/4)).
- **What’s New** shows recent highlights right after an update and from **Help › What’s New**, including while offline. Dismiss it once per update or open the full release notes for every technical detail.

### Fixed

- Updating or reinstalling the desktop app opens your saved workspaces directly instead of asking to continue or start fresh. Version tracking replaces app-bundle identity checks, and new profiles still receive first-run setup.

## [0.9.1] - 2026-10-31

### Fixed

- Runs ended by the broker for oversized output or a provider-message handling failure now retain the actual error instead of appearing as a user stop. A later Stop does not replace that reason, and failed cross-agent reviews are reported as failures ([#61](https://github.com/AhmedNavaz/throughline/pull/61)).
- Enter and Escape shortcuts in the workspace filter, workspace forms, conversation search and file preview leave in-progress input-method composition alone ([#62](https://github.com/AhmedNavaz/throughline/pull/62)).
- After a model or effort selection fails to save, the pickers return to the saved values that the next run will use ([#63](https://github.com/AhmedNavaz/throughline/pull/63)).
- Removed and sent image attachments release their cached thumbnails when no workspace draft still uses them, reducing memory retained during long sessions ([#65](https://github.com/AhmedNavaz/throughline/pull/65)).

Thanks to [@seeebbii](https://github.com/seeebbii) for these fixes.

## [0.9.0] - 2026-10-31

### Added

- Cross-agent code review: choose current Git changes, preview their exact scope, then ask the other agent for a fresh read-only review. Saved findings include severity and file locations, preserve the original reviewed diffs, and become outdated when selected files, the Git base or workspace folders change. Selected findings can prepare a fix draft for the builder without starting it automatically. Review runs preserve coding preferences and sessions, retain explicit usage/billing consent, and support cancellation ([#15](https://github.com/AhmedNavaz/throughline/issues/15)).

### Fixed

- Git diff path arguments are treated literally, so a filename containing wildcard characters cannot expand the selected scope.
- Before the first Git commit, a new staged file's diff includes its current working contents, including edits made after staging.

## [0.8.0] - 2026-10-31

### Added

- Native desktop menus for workspace, conversation, agent and appearance controls, with their keyboard shortcuts and current selection states. Help links open the guide, roadmap, release notes and feedback forms; bug reports include the app and system versions ([#59](https://github.com/AhmedNavaz/throughline/pull/59)).

### Fixed

- Conversation files exported near the 2 MB limit can be imported again, including formatted JSON files that grow beyond 2 MB on disk. Multiple valid large files can also be imported together while retaining per-file limits and the existing limits on other requests ([#54](https://github.com/AhmedNavaz/throughline/pull/54)).
- Failed **Approve** and **Deny** actions show a visible notice. Approval cards refresh after either outcome, removing stale requests and allowing pending requests to be retried ([#56](https://github.com/AhmedNavaz/throughline/pull/56)).
- Failed lock and lease writes no longer leave partial files that block later changes. Failed updates preserve existing leases, and unreadable older files are named without clearing unknown owners ([#57](https://github.com/AhmedNavaz/throughline/pull/57)).
- Startup and save errors identify a damaged settings file and explain how to recover. The file is preserved, along with the running settings, when it cannot be read ([#58](https://github.com/AhmedNavaz/throughline/pull/58)).
- Claude run cards include cache reads and writes in their input-token total, making the count consistent with Codex. Existing saved runs show the corrected total too ([#60](https://github.com/AhmedNavaz/throughline/pull/60)).

Thanks to [@seeebbii](https://github.com/seeebbii) for these improvements.

## [0.7.0] - 2026-10-31

### Added

- Find in the conversation with Cmd/Ctrl+F: highlight matches across text formatting and code, move between results, and reveal matches in collapsed activity groups ([#39](https://github.com/AhmedNavaz/throughline/pull/39), thanks [@seeebbii](https://github.com/seeebbii)).
- System appearance follows your computer's light or dark setting while the app is open. Onboarding, Settings, the status bar and native dialogs share the same preference; existing Light and Dark choices are preserved ([#52](https://github.com/AhmedNavaz/throughline/pull/52), thanks [@seeebbii](https://github.com/seeebbii)).

### Fixed

- A failed conversation save no longer corrupts the next saved message. Empty or incomplete unused journals no longer prevent the workspace from opening after restart ([#41](https://github.com/AhmedNavaz/throughline/pull/41), thanks [@seeebbii](https://github.com/seeebbii)).
- On a Mac's case-insensitive disk, a folder typed in another letter case is now the same folder: no duplicate workspace or folder, and two agents can't edit it at once. Workspaces saved by earlier versions keep their IDs and history ([#40](https://github.com/AhmedNavaz/throughline/pull/40), thanks [@seeebbii](https://github.com/seeebbii)).
- Connection status no longer flickers to "Checking…" when you switch back to the app. A slow check keeps the last verified result and is reported as a timeout instead of "not installed", and Settings shows when each connection was last checked ([#50](https://github.com/AhmedNavaz/throughline/pull/50), thanks [@seeebbii](https://github.com/seeebbii)).
- Newly saved macOS locks and run records identify their owning process, allowing safe recovery when an exited process's ID is reused. Live owners and their child processes remain protected across clock and time-zone changes; older records retain conservative locking behavior ([#42](https://github.com/AhmedNavaz/throughline/pull/42), thanks [@seeebbii](https://github.com/seeebbii)).
- Onboarding's **Skip for now** and step buttons receive clicks correctly instead of being covered by the window-drag area ([#53](https://github.com/AhmedNavaz/throughline/pull/53), thanks [@seeebbii](https://github.com/seeebbii)).

### Security

- Packaging dependencies use glob 14.0.2 and minimatch 11.0.1 to address published denial-of-service advisories in cancellation and pattern processing. The overrides apply to Electron's archive tooling ([glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)).

## [0.6.2] - 2026-10-30

### Fixed

- Deliver long agent replies and CLI output completely before the provider worker exits ([#34](https://github.com/AhmedNavaz/throughline/pull/34)).
- Keep code blocks with language labels such as `constructor` or `__proto__` from blanking the conversation ([#35](https://github.com/AhmedNavaz/throughline/pull/35)).
- Preserve Unicode characters split across HTTP request chunks ([#36](https://github.com/AhmedNavaz/throughline/pull/36)).
- Save a custom model on Enter without submitting the conversation draft ([#37](https://github.com/AhmedNavaz/throughline/pull/37)).
- Import the newest visible messages from long Claude conversations ([#38](https://github.com/AhmedNavaz/throughline/pull/38)).

Thanks to [@seeebbii](https://github.com/seeebbii) for these five fixes.

## [0.6.1] - 2026-10-30

### Changed

- Tests cover Claude Code and Codex discovery on Windows and Linux ([#31](https://github.com/AhmedNavaz/throughline/pull/31), thanks @Vamsi-2581).

### Fixed

- The app stays responsive while it checks Claude Code and Codex at launch ([#33](https://github.com/AhmedNavaz/throughline/pull/33), thanks @ungaaaabungaaa).
- **Start fresh** restarts immediately instead of waiting for launch-time checks to finish.
- Stopping a run on macOS no longer reports a false error or leaves the run marked as running when the agent has just exited ([#30](https://github.com/AhmedNavaz/throughline/issues/30)).

### Security

- Electron 44.10.0, which no longer trusts the compromised eMudhra intermediate certificates.
- body-parser 2.4.0 and fast-uri 3.1.9, fixing a denial of service from compressed request bodies and URL parsing flaws in the Claude Agent SDK's dependencies.

## [0.6.0] - 2026-10-30

### Added

- Optional suggestions for previous Claude Code and Codex conversations matching an opened workspace's folders, with a remembered **Not now** choice for each workspace.
- `npm run start:fresh` and `npm start -- --fresh` replay onboarding in an isolated temporary profile. Add `--no-agents` to preview setup without installed agents; existing workspaces and CLI sign-ins stay intact.
- Patreon support links in the README and the repository's Sponsor button.
- A contributor architecture guide and a roadmap proposal for an integrated workspace terminal.

### Changed

- Onboarding completes the project-folder step and final summary before opening the workspace and suggesting previous chats.
- **Previous chats** reviews and merges selected conversations into the open workspace. Its folders are the default search scope; browsing other projects and opening shared conversation files remain optional.
- Conversation discovery, import and export have separate interface and HTTP route modules, keeping them independent of Git and account-usage controls.
- Clearer Throughline positioning in the README, welcome screen, package description and social-preview artwork: your workspace for AI coding agents, using your own accounts.

### Fixed

- Workspace-scoped chat discovery excludes Throughline's own agent sessions.
- Desktop packages exclude disposable generated assets in `output/`.

## [0.5.0] - 2026-10-30

### Changed

- A new first-run experience: a launch screen, an animated welcome, three short setup steps and a summary, then the app fades in.
- A newly installed copy that finds saved workspaces asks whether to continue with them or start fresh. Starting fresh keeps the old data as a backup.

## [0.4.0] - 2026-10-30

First public release.

### Added

- Workspaces with one or more folders and one permanent conversation, shared by Claude Code and Codex.
- Switch agents mid-task without losing context, for example when one reaches its usage limit.
- Import existing Claude Code and Codex chats from any project, merged in time order.
- Export a conversation file for another Throughline user, with secrets and local paths redacted.
- Ask a Friend: share an approved snapshot and apply the reviewable patch that comes back.
- Git activity with per-file diffs, a file browser with syntax highlighting, and plan usage for each agent.
- Keep awake, which stops your Mac sleeping while agents are working.
- Dark and light themes, keyboard shortcuts and a short setup guide.
- macOS builds for Apple Silicon and Intel, and a container image for the private-link service.

[0.10.1]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.10.1
[0.10.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.10.0
[0.9.1]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.9.1
[0.9.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.9.0
[0.8.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.8.0
[0.7.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.7.0
[0.6.2]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.6.2
[0.6.1]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.6.1
[0.6.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.6.0
[0.5.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.5.0
[0.4.0]: https://github.com/AhmedNavaz/throughline/releases/tag/v0.4.0
