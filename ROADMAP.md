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

## Later

- Support for more coding-agent CLIs alongside Claude Code and Codex.
- Optional summaries of long conversations, written by the agent you choose and reviewed before they are saved.
- Binary files in Ask a Friend patches.
- An accessibility pass covering keyboard navigation and screen readers, and translations of the interface.

## Good places to start

- Issues labelled [good first issue](https://github.com/AhmedNavaz/throughline/labels/good%20first%20issue) or [help wanted](https://github.com/AhmedNavaz/throughline/labels/help%20wanted).
- Small interface polish, bugs you hit while using the app, and clearer documentation in the [guide](docs/guide.md).
- Tests for Windows and Linux paths, which also move the platform work forward.

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and a map of the codebase.
