#!/usr/bin/env bash
# Archive and export a signed App Store IPA from apps/ios.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED="${PONDER_IOS_DERIVED:-$ROOT/build}"
ARCHIVE_PATH="${PONDER_IOS_ARCHIVE:-$DERIVED/Ponder.xcarchive}"
EXPORT_PATH="${PONDER_IOS_EXPORT:-$DERIVED/export}"
EXPORT_OPTIONS="${PONDER_IOS_EXPORT_OPTIONS:-$ROOT/ExportOptions.plist}"

# Prefer stable Xcode for App Store (beta SDKs are rejected by App Store Connect).
if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
fi
echo "Using $(xcodebuild -version | tr '\n' ' ')"

# Beta host macOS stamps BuildMachineOSBuild; ASC often rejects as ITMS-90111.
# Prefer Xcode Cloud for store binaries (docs/ios-xcode-cloud.md).
# Heuristic: Apple seed builds usually end with a lowercase letter (e.g. 26A5368g);
# GM/release builds typically end with digits (e.g. 24G90).
HOST_OS_BUILD="$(sw_vers -buildVersion 2>/dev/null || true)"
HOST_OS_VER="$(sw_vers -productVersion 2>/dev/null || true)"
if [[ "$HOST_OS_BUILD" =~ [a-z]$ ]]; then
  echo "WARNING: Host macOS ${HOST_OS_VER} (${HOST_OS_BUILD}) looks like a seed/beta build." >&2
  echo "WARNING: App Store Connect may reject this IPA with ITMS-90111 even if Xcode is a release build." >&2
  echo "WARNING: Use Xcode Cloud (manual Archive workflow) for store uploads — see docs/ios-xcode-cloud.md" >&2
  if [[ "${PONDER_IOS_ALLOW_BETA_HOST:-0}" != "1" ]]; then
    echo "Refusing local App Store archive on beta host. Set PONDER_IOS_ALLOW_BETA_HOST=1 to override." >&2
    exit 1
  fi
fi

cd "$ROOT"

if [[ "${PONDER_IOS_SKIP_EDITOR_BUILD:-0}" != "1" ]]; then
  bash "$ROOT/Scripts/build-editor-bundle.sh"
fi

if command -v xcodegen >/dev/null 2>&1; then
  xcodegen generate
fi

mkdir -p "$DERIVED"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"

echo "Archiving Ponder for App Store..."
xcodebuild \
  -project "$ROOT/Ponder.xcodeproj" \
  -scheme Ponder \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED/DerivedData" \
  archive

echo "Exporting IPA..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

IPA="$(find "$EXPORT_PATH" -name '*.ipa' | head -1)"
if [[ -z "$IPA" || ! -f "$IPA" ]]; then
  echo "Export did not produce an IPA under $EXPORT_PATH" >&2
  exit 1
fi

echo "IPA=$IPA"
echo "ARCHIVE=$ARCHIVE_PATH"
