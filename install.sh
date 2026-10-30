#!/bin/sh
# Installs the latest Throughline release on macOS:
#   curl -fsSL https://raw.githubusercontent.com/AhmedNavaz/throughline/main/install.sh | sh
# THROUGHLINE_VERSION=0.4.0 installs a specific version. THROUGHLINE_INSTALL_DIR changes the folder (default /Applications).
set -eu

repo="AhmedNavaz/throughline"

fail() { printf 'throughline: %s\n' "$1" >&2; exit 1; }

main() {
  [ "$(uname -s)" = "Darwin" ] || fail "Throughline is currently available for macOS only."

  # Reported by Apple Silicon hardware even when the terminal runs under Rosetta.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then build="apple-silicon"; name="Apple Silicon"; else build="intel"; name="Intel"; fi

  version="${THROUGHLINE_VERSION:-}"
  if [ -z "$version" ]; then
    latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") || fail "Could not reach GitHub."
    version=${latest##*/v}
  fi
  version=${version#v}
  case "$version" in ''|*/*) fail "Could not find the latest release." ;; esac

  dest="${THROUGHLINE_INSTALL_DIR:-/Applications}"
  if [ -z "${THROUGHLINE_INSTALL_DIR:-}" ] && [ ! -w "$dest" ]; then dest="$HOME/Applications"; fi
  mkdir -p "$dest"
  [ -w "$dest" ] || fail "Cannot write to $dest."
  if pgrep -qf '/Throughline.app/Contents/MacOS/Throughline'; then fail "Quit Throughline, then run the installer again."; fi

  file="Throughline-$version-mac-$build.zip"
  base="https://github.com/$repo/releases/download/v$version"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' INT TERM

  printf 'Downloading Throughline %s for %s Macs...\n' "$version" "$name"
  curl -fL --progress-bar -o "$tmp/$file" "$base/$file" || fail "Could not download $file."
  curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt" || fail "Could not download the checksums."
  expected=$(awk -v file="$file" '$2 == file { print $1 }' "$tmp/SHA256SUMS.txt")
  actual=$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then fail "The download does not match its published checksum. Nothing was installed."; fi

  ditto -x -k "$tmp/$file" "$tmp/app"
  [ -d "$tmp/app/Throughline.app" ] || fail "The download does not contain Throughline.app."
  rm -rf "$dest/Throughline.app"
  mv "$tmp/app/Throughline.app" "$dest/Throughline.app"

  printf 'Installed Throughline %s in %s.\n' "$version" "$dest"
  printf 'Open it with: open "%s/Throughline.app"\n' "$dest"
  printf 'Throughline uses Claude Code and/or the Codex CLI, installed and signed in with your own accounts.\n'
}

main "$@"
