#!/bin/sh
# Xcode Cloud — runs after xcodebuild (success or failure).
# Upload App Store IPA when present so Development/Ad Hoc export failures do not
# leave a store-ready binary stranded without an ASC upload.
#
# Requires Xcode Cloud shared environment variables (secret):
#   APP_STORE_CONNECT_API_KEY_ID
#   APP_STORE_CONNECT_API_ISSUER_ID
#   APP_STORE_CONNECT_API_KEY_P8_BASE64   (entire .p8 file, base64)
#
# Docs: docs/ios-xcode-cloud.md
set -euo pipefail

echo "==> Ponder Xcode Cloud post-xcodebuild"
echo "CI_XCODEBUILD_EXIT_CODE=${CI_XCODEBUILD_EXIT_CODE:-unset}"
echo "CI_BUILD_NUMBER=${CI_BUILD_NUMBER:-unset}"
echo "CI_ARCHIVE_PATH=${CI_ARCHIVE_PATH:-unset}"
echo "CI_APP_STORE_SIGNED_APP_PATH=${CI_APP_STORE_SIGNED_APP_PATH:-unset}"

# Locate signed App Store product (.ipa or .app under export)
IPA=""
if [ -n "${CI_APP_STORE_SIGNED_APP_PATH:-}" ] && [ -e "$CI_APP_STORE_SIGNED_APP_PATH" ]; then
  if [ -f "$CI_APP_STORE_SIGNED_APP_PATH" ] && echo "$CI_APP_STORE_SIGNED_APP_PATH" | grep -qi '\.ipa$'; then
    IPA="$CI_APP_STORE_SIGNED_APP_PATH"
  elif [ -d "$CI_APP_STORE_SIGNED_APP_PATH" ]; then
    # Sometimes this points at .app; search sibling/export dirs for ipa
    PARENT="$(dirname "$CI_APP_STORE_SIGNED_APP_PATH")"
    IPA="$(find "$PARENT" -maxdepth 3 -name '*.ipa' 2>/dev/null | head -1 || true)"
  fi
fi

if [ -z "$IPA" ]; then
  # Common Cloud workspace layouts after archive+export
  for root in \
    "${CI_PRIMARY_REPOSITORY_PATH:-}" \
    "${CI_WORKSPACE:-}" \
    /Volumes/workspace \
    /Volumes/workspace/repository
  do
    [ -n "$root" ] && [ -d "$root" ] || continue
    # pipefail-safe: find may return 1 when empty
    found="$(find "$root" -name '*.ipa' 2>/dev/null | head -1)" || true
    if [ -n "${found:-}" ]; then
      IPA="$found"
      break
    fi
  done
fi

if [ -z "$IPA" ] || [ ! -f "$IPA" ]; then
  echo "No App Store IPA found — skip upload (archive/export may have failed earlier)."
  # Do not fail the script: preserve original xcodebuild outcome.
  exit 0
fi

echo "Found IPA: $IPA ($(wc -c < "$IPA" | tr -d ' ') bytes)"

KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:-}"
ISSUER="${APP_STORE_CONNECT_API_ISSUER_ID:-}"
P8_B64="${APP_STORE_CONNECT_API_KEY_P8_BASE64:-}"

if [ -z "$KEY_ID" ] || [ -z "$ISSUER" ] || [ -z "$P8_B64" ]; then
  echo "ASC API secrets not set in Xcode Cloud env — skip auto-upload."
  echo "Set APP_STORE_CONNECT_API_KEY_ID / ISSUER_ID / API_KEY_P8_BASE64 (shared env)."
  echo "Fallback: download ARCHIVE_EXPORT from the build and run Scripts/upload-app-store-ipa.sh"
  exit 0
fi

# Install API key where altool expects it
KEY_DIR="${HOME}/.appstoreconnect/private_keys"
mkdir -p "$KEY_DIR"
KEY_FILE="${KEY_DIR}/AuthKey_${KEY_ID}.p8"
printf '%s' "$P8_B64" | base64 -d >"$KEY_FILE"
chmod 600 "$KEY_FILE"
echo "Installed API key AuthKey_${KEY_ID}.p8"

# Prefer non-beta Xcode for delivery tools when both exist
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

echo "Uploading IPA to App Store Connect via altool..."
if xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$KEY_ID" --apiIssuer "$ISSUER"; then
  echo "UPLOAD SUCCEEDED"
else
  echo "error: altool upload failed" >&2
  # Fail the Cloud action so the dashboard is red when the store binary is not delivered.
  exit 1
fi

echo "==> post-xcodebuild complete"
