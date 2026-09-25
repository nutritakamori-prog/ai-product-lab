#!/usr/bin/env bash
# Minimal security check: Gitleaks (versioned secrets) + OSV-Scanner (known
# vulnerabilities in package-lock.json). Both tools are expected to already
# be installed — this script does not install anything and never masks a
# real finding; it exits non-zero if either tool reports one.
#
# Install (once, outside this script):
#   go install github.com/zricethezav/gitleaks/v8@latest
#   go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest

set -uo pipefail

find_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  local gopath
  gopath="$(go env GOPATH 2>/dev/null)"
  gopath="${gopath:-$HOME/go}"
  if [ -x "$gopath/bin/$name" ]; then
    echo "$gopath/bin/$name"
    return 0
  fi
  return 1
}

GITLEAKS_BIN="$(find_tool gitleaks)" || {
  echo "security:check — gitleaks not found on PATH or in \$(go env GOPATH)/bin." >&2
  echo "Install with: go install github.com/zricethezav/gitleaks/v8@latest" >&2
  exit 1
}

OSV_SCANNER_BIN="$(find_tool osv-scanner)" || {
  echo "security:check — osv-scanner not found on PATH or in \$(go env GOPATH)/bin." >&2
  echo "Install with: go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest" >&2
  exit 1
}

echo "=== security:check — Gitleaks (versioned secrets) ==="
set +e
"$GITLEAKS_BIN" detect --source . --redact -v
GITLEAKS_EXIT=$?
set -e

echo ""
echo "=== security:check — OSV-Scanner (known dependency vulnerabilities) ==="
set +e
"$OSV_SCANNER_BIN" scan source --lockfile package-lock.json --download-offline-databases --offline-vulnerabilities
OSV_EXIT=$?
set -e

echo ""
if [ "$GITLEAKS_EXIT" -ne 0 ] || [ "$OSV_EXIT" -ne 0 ]; then
  echo "security:check — FAILED (gitleaks exit=$GITLEAKS_EXIT, osv-scanner exit=$OSV_EXIT)"
  exit 1
fi

echo "security:check — passed (no leaks, no known vulnerabilities)"
exit 0
