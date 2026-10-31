# Throughline guide

Everything the [README](../README.md) leaves out: how each feature works, what it stores and where its limits are.

- [Workspaces, accounts and switching](#workspaces-accounts-and-switching)
- [Models, runs, Git and usage](#models-runs-git-and-usage)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Files and attachments](#files-and-attachments)
- [Import Claude Code and Codex chats](#import-claude-code-and-codex-chats)
- [Export a conversation](#export-a-conversation)
- [Ask a Friend](#ask-a-friend)
- [Private-link service](#private-link-service)
- [Saved data and migration](#saved-data-and-migration)
- [Running from source](#running-from-source)
- [Limitations](#limitations)
- [References](#references)

## Workspaces, accounts and switching

Click **New workspace** or **Add workspace**, name the project, and select its folders. For example, a Shop workspace can contain its admin panel, backend and website together. Its single chat opens automatically; there is no New chat button or conversation list. Use **Workspace settings › Add folder** to attach more folders, and the remove control next to a folder to detach one. Files remain on disk, and folder changes preserve the same chat and drafts. The final folder cannot be removed.

The sidebar switches between workspaces and displays their attached folders. Codex and Claude receive every current folder when you explicitly run them. Adding/removing folders reconstructs provider sessions with the current access scope while retaining application history. Folder changes are blocked during active runs or file mutations. Missing folders stay listed with the saved chat available; remove or restore them before starting another run.

Existing projects migrate without changing IDs or deleting journals. The most recently updated legacy chat becomes the permanent chat; additional old chats remain saved as read-only archives. The previous registry is backed up as `projects.json.v1-backup`. Existing independent projects are not automatically combined; attach the relevant folders to the workspace you want to use.

Open **Settings** to inspect authentication, billing and usage; choose the model and effort in the composer. Installed and authenticated are different states. Background checks keep the last result on screen; Settings shows when each connection was last checked, says when a newer check timed out or failed, and **Refresh status** checks again. Connect uses the provider's own supported authentication flow. Claude runs the official unmodified installed Claude Code binary; login happens through Claude Code. Existing native login methods remain available. Throughline does not extract tokens or copy another application's credential store.

Subscription, API and unknown billing are shown separately. Unknown or separately billed modes require explicit acceptance before an explicit provider run. There is no automatic API fallback. Usage stays unknown when the provider cannot report it. A model can be selected from current provider metadata or entered explicitly; selected models persist separately for each provider. Effective models are recorded when reported.

Use either assistant in the project’s existing chat. Wait or press **Stop** before switching. Ordinary messages resume that provider's native session and supply unseen shared context. **Continue with…** explicitly reconstructs a fresh session from saved application history after an interruption or an unusable native session. Switching the selector alone makes no model request. Only **Send** or **Continue** starts inference.

The application history is canonical. Native Claude and Codex sessions remain separate. Hidden reasoning, native tool execution state and unfinished OS processes are not transferred. Full history stays saved; each run receives bounded recent context from the shared conversation. Summaries are not automatically generated with AI. Errors distinguish quota, authentication, installation, permission, interruption and protocol failures.

Codex normally uses its official app-server with GUI approval requests. Claude uses the official Agent SDK with its installed binary and GUI `canUseTool` approvals. No unrestricted execution flag is enabled. The optional explicit CLI adapter has no GUI approval capability. Read-only uses the provider's sandbox/restricted tools; Claude restrictions are not an operating-system sandbox. User/project hooks are disabled for managed runs where supported; administrator provider policy can still apply. These controls do not isolate unrelated host processes.

Automatic executable discovery checks absolute PATH entries, common install folders, macOS app bundles and compatible Codex VS Code extensions. Overrides are explicit and do not silently fall back:

```sh
AI_RELAY_CODEX_BIN=/absolute/path/to/codex AI_RELAY_CLAUDE_BIN=/absolute/path/to/claude npm start
```

## Models, runs, Git and usage

The sidebar lists workspaces with search. A workspace with several folders shows them under its name; the selected folder is the one the **Files** view and **Git activity** show. Add, remove and rename are in **Workspace settings** (the ··· that appears when you hover a workspace). Each workspace still has one permanent conversation. File previews and code blocks in replies are syntax colored.

Choose the agent, model, reasoning effort and access mode directly in the composer. Model and effort choices come from the installed provider's catalogue; custom model IDs remain available through **Enter a model ID…**. Effort is remembered separately for each provider/model pair. The provider default remains an explicit choice. Reply headers show the model/effort recorded for that response when available; older replies are not given guessed model labels.

The run card shows elapsed time, the last provider activity, tool steps and provider-reported token counts when available. It distinguishes startup, provider-reported reasoning, tool execution, response streaming, approval requests and app reconnection. After 30 seconds without provider events it says **Waiting for provider**, rather than claiming the model is thinking or stuck. Stop remains available. No private reasoning text or invented percentage is shown.

**Git activity** opens the repository inspector. For each attached folder it shows the current branch, staged/unstaged/untracked changes and the latest 15 local commits. GitHub origin repositories also get repository/commit links. This is local history, not a remote fetch or a commit/push action. The panel refreshes while visible; configured hooks, fsmonitor and external clean/process filters are disabled for its Git reads. Select a changed file to review its diff against the last commit (staged and unstaged together; new files in full). External diff drivers and textconv are disabled for diffs too. On wide windows the panel stays open unless you close it, and it refreshes when a run finishes.

The status bar shows the plan usage left for both agents (5-hour and weekly windows, plus model-specific weekly limits when the provider reports them); the composer shows the tightest limit for the selected agent and model. Select a meter or the composer chip to see that agent's windows and reset times. Codex usage comes from its app-server. Claude usage comes from an experimental Claude Agent SDK call and is shown as unavailable if a future SDK removes it. Reading usage never starts inference.

**Keep awake** in the status bar (desktop app) stops your Mac and its display from sleeping while any workspace has an agent running, so a long run is not interrupted. It shows **Auto** while switched on and waiting, **On** while it is holding the Mac awake, and releases as soon as the last run finishes. The setting is remembered between launches.

The appearance buttons in the status bar choose **System**, **Dark** or **Light**, and **Settings › Appearance** and setup offer the same choice. **System**, the default, follows your computer's light or dark setting as it changes; **Dark** and **Light** stay as chosen. In the desktop app, native menus and dialogs use the same appearance.

Messages and code blocks have copy buttons.

## Keyboard shortcuts

Shortcuts use ⌘ on macOS and Ctrl elsewhere:

- ⌘K filters workspaces. Enter opens the first match and Escape clears the filter.
- ⌘1–9 open the first nine workspaces the filter shows.
- ⌘L focuses the message box.
- ⌘F finds text in the conversation. Enter and Shift+Enter move between matches, and Escape closes the search.
- ⇧⌘G shows or hides Git activity.
- ⌘. stops the current run.

The desktop app's menu bar lists these shortcuts too, and adds ⌘, for **Settings…**, ⌘N for **New Workspace** and ⌘G for **Find Next**. Each menu item does what its shortcut or button does. Items are dimmed when they don't apply, such as **Stop Run** when nothing is running, and while a dialog is open, items for the controls behind it do nothing. **Agent** ticks the selected agent and **Keep Awake**, **Workspace** ticks the open workspace, and **View** ticks **Show Files**, **Show Git Activity** and the appearance. **Help** opens this guide, the roadmap, the release notes and the bug and design feedback forms on GitHub. The bug form starts with your Throughline and macOS versions filled in.

## Files and attachments

The sidebar’s **Files** section shows each workspace folder as a separate root. Expand directories, preview text/code with line numbers or images, then choose **Attach to message**. Previews are read only. The explorer hides private app data, credentials, provider sessions, dependency folders and symbolic links. Large directories load in pages.

Click **Attach** in the composer, drag files onto it, or paste an image from your clipboard. Click an attachment chip to preview it, or its × to remove it before sending. Supported inputs:

- PNG, JPEG, GIF and WebP images, up to 5 MiB each.
- UTF-8 text and code (including Markdown, JSON, CSV and source files), up to 64 KiB each.
- Up to six files and 20 MiB per message, with a combined text limit of 128 KiB. The prompt context budget still applies.

PDF, Office, audio, video and other binary attachments are not supported. SVG is treated as text, never rendered as active content. Images require the native Codex app-server or Claude SDK connection; the optional plain CLI adapter rejects image input explicitly.

Files are saved as immutable snapshots in the workspace’s local application storage. Selecting or previewing a file starts no inference; **Send** transmits it to the selected agent. Draft attachments stay with their workspace and survive reloads and failed sends. Journals store attachment metadata, not image base64. Recent unseen text/image attachments are included on model handoff within context/image limits; the agent is told when older images are omitted.

The first launch opens a short setup: a welcome, then three steps (connect your agents, choose the theme and default access, and choose your project folders) and a summary before the app appears. **Finish** leads to the summary, and **Open Throughline** completes setup. Previous conversations are offered inside the workspace after setup. **Skip for now** leaves a **Getting started** shortcut in the sidebar, and **Settings › Setup guide** reopens the steps at any time. Setup never changes existing chats.

When a newly installed copy of the desktop app finds saved workspaces, it asks whether to **continue where you left off** or **start fresh**. Starting fresh renames the saved data to `relay-data-backup-<date>` in the same folder instead of deleting it; rename it back while the app is closed to restore it.

## Import Claude Code and Codex chats

Create or open a workspace first. Throughline checks its project folders for previous Claude Code and Codex conversations and offers **Review conversations** when it finds chats that have not been merged. The suggestion never opens a dialog or merges messages by itself. **Not now** is remembered for that workspace across restarts; after a successful merge, the automatic suggestion is also dismissed.

Choose **Review conversations** or **Previous chats** in the workspace header. The list defaults to **This workspace**, matches folder paths, and groups chats by project folder. Select one or several conversations from either agent, review their messages together, and confirm **Merge conversations**. Nothing is selected automatically. Messages merge into the open workspace’s single conversation by their original times, with their source and timestamps preserved.

**Browse other projects** is a secondary option for explicitly choosing unrelated chats. Their existing folders are attached to the open workspace if needed, with those additions shown before merging. Folders that no longer exist are reported and not attached. **Open conversation file…** brings a shared conversation into the workspace you have already opened. The destination workspace is always shown in the review.

Importing copies visible user and assistant text, original timestamps and available model provenance. Claude Code slash-command records, native tool state and hidden reasoning are not imported. Import never resumes a native session, starts inference or modifies the provider's original conversation. When you next press **Send**, the selected agent starts with the imported history as shared context (most recent messages first, within the context budget) and runs on your own installed CLI and account. Throughline supplies no API keys of its own.

Discovery and preview use the installed Claude Agent SDK session readers and the Codex app-server history APIs; both read local history. Throughline's own runs are excluded from the list. Each import confirms that the reviewed content has not changed; a changed source must be previewed again. Repeated imports are deduplicated, and a reviewed import of a grown conversation updates its partial messages. Each conversation is limited to its most recent 1,000 text messages and 2 MiB, with clipping disclosed, and up to 20 conversations can be imported at once.

## Export a conversation

**Export** in the workspace header saves the conversation as a `.throughline.json` file that another Throughline user can open with **Previous chats › Open conversation file…** after opening their own project workspace. They review the messages and continue with their own Claude or Codex account. Nothing runs during export or import.

By default an export contains the user and assistant text of the whole conversation plus the saved goal, decisions and tasks. Secrets and local paths are removed, and workspace paths become folder names such as `[frontend]/src/app.js`. You can limit it to recent messages, include tool activity, or turn removal off; the dialog shows what the file contains before you save it. **Save as Markdown** writes a readable copy instead. A file holds up to 2 MB of conversation (the oldest messages are left out first). A file that was edited after export is rejected on import. On import, shared context fills only fields the receiving conversation has not set, and the other person's messages are shown as theirs. Import files only from people you trust, because their messages become context for your assistant. To ask someone for code changes and receive a reviewable patch instead, use **Ask a Friend**.

## Ask a Friend

1. In the original conversation click **Ask a Friend**. Enter the problem and expected outcome; select individual messages or tool logs.
2. Choose **Context only** or **Selected source**. Enter only approved workspace-relative text-file paths. Add specific permitted new-file paths if a returned patch may create files. The repository is never selected automatically.
3. In multi-folder workspaces use the displayed folder prefix, such as `frontend/src/app.js`, to distinguish files. Prepare the offline preview. Inspect and edit the actual outgoing JSON, inventory and warnings. Refresh an edited preview to recalculate its integrity. Confirm and approve that exact content.
4. Export the approved JSON offline, or configure a separate sharing service under **Solutions & links** and create a private link.
5. Your friend can view/download the approved material and submit a solution in a normal browser. They use their own tools and account; the website cannot access their local subscriptions. Throughline is optional for them.
6. If they use Throughline, **Help a friend** imports into a deliberately selected local workspace and its existing chat; map each shared folder to an attached local folder. Importing writes no source files and starts no assistant. They can prepare files locally, then build/export an exact solution against the approved baseline. Upload that solution through the friend webpage, or return the JSON offline.
7. Retrieve or import solutions under **Solutions & links**. Explanations and contributor verification appear in the original conversation. Review each diff before choosing **Apply reviewed patch**. Instructions-only solutions have no automatically applicable code.
8. Run an explicitly reviewed local syntax/whitespace check. Recovery restores affected baseline files when safe and preserves unrelated or newer edits.

A private link grants its holders view and submission access until expiry or revocation. The owner capability remains in local private storage. Default expiry is seven days; the service supports bounded expiry and revocation. Creation/delivery needs connectivity; preparation, approval, export/import, diff, application, recovery and supported verification do not need AI or internet. Lost upload responses retry with the same persisted upload identity. One rejected patch does not prevent receiving other valid solutions.

Source baselines retain exact approved content and SHA-256 hashes, including dirty and selected untracked files. Git commit identity alone is insufficient. Patches support explicit UTF-8 text-file create/replace/delete operations for approved paths, up to 128 files and 256 KiB per file, within the 2 MiB portable-package limit. Unsafe paths, private runtime paths, symlinks, binary content and unapproved baselines are rejected. Changed target files become conflicts and are not overwritten. The app never resets, stashes or commits a user's project. Request and solution IDs make delivery/application idempotent. Previews bind to a private workspace snapshot; changing workspace folders requires preparing a new preview. Approved requests and recovery checkpoints keep their original folder mapping and refuse writes to detached roots. Durable recovery checkpoints precede file writes.

Verification is intentionally limited to reviewed `node --check relative-file.js` and `git diff --check`. Imported commands and arbitrary package scripts never run automatically. Git external diffs, text converters, hooks and configured clean/process filters are disabled for this whitespace check. Broader tests can be run deliberately in your own terminal.

Default exclusions cover environment/credential files, provider session stores, runtime data and unnecessary absolute paths. Transcript redaction and secret scans assist review; they cannot guarantee that sensitive content has been removed. Review source and conversation text yourself before approving.

## Private-link service

For a same-computer test:

```sh
npm run sharing
```

Set the GUI service URL to `http://127.0.0.1:4319`. These are local test links; another computer cannot open them. Remote links require a separately deployed HTTPS service with persistent private storage. Each release publishes a container image, `ghcr.io/ahmednavaz/throughline-sharing`. Deployment, Docker, limits, capabilities and proxy configuration are in [sharing/README.md](../sharing/README.md). `AI_RELAY_SHARING_URL` can configure the client, and `AI_RELAY_SHARING_CREATE_KEY` can provide the service's optional creation key.

The sharing service stores only approved packages and solutions. It has no execution endpoints, provider credentials, repository mounts or account integration. Do not expose or tunnel the local coding server. Production hosting has **not** been deployed or verified by this implementation.

## Saved data and migration

Desktop data lives under Electron's OS application-data directory in `Throughline/relay-data` (on macOS, `~/Library/Application Support/Throughline/relay-data`). Projects, append-only journals, local collaboration associations, owner capabilities and recovery files stay there. Treat this directory as private. Source folders do not need Throughline files.

The first development launch copies the old checkout's `.data` into OS storage if no desktop data exists. The original remains untouched, and `migration.json` records the source. Migration refuses live legacy locks, invalid locks or unfinished guards. Stop all old Throughline instances first. To import from a different checkout on first launch:

```sh
AI_RELAY_LEGACY_DATA_DIR=/absolute/old/AI-Relay/.data npm start
```

For an existing installation, perform that one-time development launch before moving to the packaged build. Packaged apps deliberately exclude `.data`; they use the same OS storage. Migration never merges over an existing destination. For rollback, quit all instances and retain both copies; reopen the original checkout with its original `.data`. Restoring old data does not undo later file edits. Workspace mutation locks also exclude overlapping folders across different history roots on the same user account. A surviving provider process after a crash blocks conflicting edits until it has stopped; an unfinished guard fails closed with recovery instructions.

For a browser-only development session use `npm run web`, optionally with `-- --workspace /absolute/project --port 4318`. This uses checkout `.data` by default. Set `AI_RELAY_DATA_DIR` explicitly if you want it to use another history store. The execution server binds to loopback, checks Host/Origin and mutation headers; desktop additionally uses a per-launch token and isolated renderer with narrow folder/external-link IPC.

## Running from source

Build a standalone app for your OS and architecture with `npm run package`; the result is written to `dist/`. Regenerate the app icons from `assets/icon.svg` and `public/icon.svg` with `npm run icons`.

Electron starts and stops the loopback backend itself. No separate server terminal is required. Close the app to stop its managed provider processes. A second desktop launch focuses the existing window. Without a signing identity, `npm run package` signs macOS builds ad hoc; they are not notarized.

The development launcher clears an inherited `ELECTRON_RUN_AS_NODE` flag before opening Electron, so `npm start` also works from terminals hosted by an Electron-based editor or coding agent. Provider workers retain their own Node-mode configuration.

To replay onboarding from the welcome screen, run `npm run start:fresh` or `npm start -- --fresh`. Each launch uses an empty temporary profile and skips legacy-data migration. Setup changes and imported chats in that session are discarded when the window closes; existing saved workspaces stay intact. Installed agent sign-ins are still detected. To preview a new user with neither agent installed, run `npm run start:fresh -- --no-agents`; this hides the agents only for that temporary session and leaves their installations and sign-ins unchanged.

If package installation disabled lifecycle scripts, run `node node_modules/electron/install.js` once to install Electron's official runtime. Build a fresh app for the current OS/architecture with `npm run package`; output goes to `dist/`. `AI_RELAY_SIGN_IDENTITY` can supply an installed macOS signing identity. Notarization requires separate Apple credentials/configuration.

## Limitations

- macOS builds are signed ad hoc and not notarized, so macOS asks you to approve a browser download once. Windows and Linux builds are not provided yet.
- The private-link sharing service is not hosted for you. Run the container image yourself with HTTPS and persistent storage (see `sharing/README.md`) before sharing remote links.
- Returned patches support UTF-8 text files only; binary files and symlinks are rejected, and stale baselines need a new solution.
- Built-in verification covers reviewed JavaScript syntax and `git diff --check`, not arbitrary test scripts.
- Secret scanning and redaction help you review what you share; they cannot guarantee that every secret is removed.
- Claude's restricted tools are not an operating-system sandbox. Hidden reasoning and native process state do not move between providers.
- Claude plan usage comes from an experimental Claude Agent SDK call and may stop being reported after an SDK update.

## References

Official integration documentation: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [OpenAI sign-in token-sharing guidance](https://developers.openai.com/siwc/token-sharing-open-source), [Claude legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Claude headless](https://code.claude.com/docs/en/headless), [Electron distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution).
