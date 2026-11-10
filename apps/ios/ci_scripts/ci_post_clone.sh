#!/bin/sh
# Xcode Cloud — runs after the repository is cloned, before xcodebuild.
# Keep this lightweight: local day-to-day builds stay on the developer Mac;
# Cloud is only for App Store / TestFlight archives (manual workflow).
#
# Lifecycle: ci_post_clone → ci_pre_xcodebuild → xcodebuild → ci_post_xcodebuild
# Docs: docs/ios-xcode-cloud.md
set -euo pipefail

echo "==> Ponder Xcode Cloud post-clone"

# Resolve monorepo paths. CI_PRIMARY_REPOSITORY_PATH is the Git clone root.
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-}"
if [ -z "$REPO_ROOT" ]; then
  # Local dry-run: this file lives at apps/ios/ci_scripts/
  REPO_ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)"
fi
IOS_ROOT="$REPO_ROOT/apps/ios"

if [ ! -d "$IOS_ROOT" ]; then
  echo "error: expected apps/ios at $IOS_ROOT" >&2
  exit 1
fi

cd "$IOS_ROOT"
echo "IOS_ROOT=$IOS_ROOT"
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"

# --- Toolchain: bun (EditorSource) + XcodeGen ---
export PATH="${HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "==> Installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi
command -v bun >/dev/null 2>&1 || {
  echo "error: bun install failed; EditorSource build needs bun or npm" >&2
  exit 1
}
echo "bun: $(bun --version)"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "==> Installing XcodeGen"
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  else
    echo "error: brew not found; cannot install xcodegen" >&2
    exit 1
  fi
fi
echo "xcodegen: $(xcodegen --version 2>/dev/null || true)"

# --- TipTap EditorBundle + regenerate Xcode project ---
echo "==> Building EditorBundle"
bash "$IOS_ROOT/Scripts/build-editor-bundle.sh"

echo "==> Running xcodegen generate"
xcodegen generate

if [ ! -f "$IOS_ROOT/Ponder.xcodeproj/project.pbxproj" ]; then
  echo "error: Ponder.xcodeproj missing after xcodegen" >&2
  exit 1
fi

echo "==> post-clone complete"
