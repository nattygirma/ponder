#!/usr/bin/env bash
# Upload an already-exported App Store IPA to App Store Connect (altool).
# Use after Xcode Cloud ARCHIVE_EXPORT download, or after local archive-app-store.sh.
#
# Required env:
#   APP_STORE_CONNECT_API_KEY_ID
#   APP_STORE_CONNECT_API_ISSUER_ID
#   APP_STORE_CONNECT_API_KEY_P8_BASE64   OR key file at:
#     ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
#
# Usage:
#   bash Scripts/upload-app-store-ipa.sh /path/to/Ponder.ipa
#   bash Scripts/upload-app-store-ipa.sh /path/to/app-store.zip   # zip from Cloud
set -euo pipefail

INPUT="${1:-}"
if [[ -z "$INPUT" || ! -e "$INPUT" ]]; then
  echo "Usage: $0 <app.ipa|app-store-export.zip>" >&2
  exit 1
fi

KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:?APP_STORE_CONNECT_API_KEY_ID required}"
ISSUER="${APP_STORE_CONNECT_API_ISSUER_ID:?APP_STORE_CONNECT_API_ISSUER_ID required}"

KEY_DIR="${HOME}/.appstoreconnect/private_keys"
mkdir -p "$KEY_DIR"
KEY_FILE="${KEY_DIR}/AuthKey_${KEY_ID}.p8"
if [[ ! -f "$KEY_FILE" ]]; then
  P8_B64="${APP_STORE_CONNECT_API_KEY_P8_BASE64:?Need API key file at $KEY_FILE or APP_STORE_CONNECT_API_KEY_P8_BASE64}"
  printf '%s' "$P8_B64" | base64 -d >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

IPA=""
WORKDIR=""
cleanup() {
  if [[ -n "$WORKDIR" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

if [[ "$INPUT" == *.ipa ]]; then
  IPA="$INPUT"
elif [[ "$INPUT" == *.zip ]]; then
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/ponder-ipa.XXXXXX")"
  unzip -q -o "$INPUT" -d "$WORKDIR"
  IPA="$(find "$WORKDIR" -name '*.ipa' | head -1 || true)"
  if [[ -z "$IPA" ]]; then
    echo "No .ipa inside $INPUT" >&2
    exit 1
  fi
else
  echo "Expected .ipa or .zip, got: $INPUT" >&2
  exit 1
fi

if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

echo "IPA=$IPA ($(wc -c <"$IPA" | tr -d ' ') bytes)"
# Show version stamp for operator confirmation
TMP_UNPACK="$(mktemp -d "${TMPDIR:-/tmp}/ponder-ipa-info.XXXXXX")"
unzip -q -o "$IPA" -d "$TMP_UNPACK" || true
PLIST="$(find "$TMP_UNPACK" -path '*/Payload/*.app/Info.plist' | head -1 || true)"
if [[ -n "$PLIST" ]]; then
  echo "CFBundleShortVersionString=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || true)"
  echo "CFBundleVersion=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST" 2>/dev/null || true)"
  echo "BuildMachineOSBuild=$(/usr/libexec/PlistBuddy -c 'Print :BuildMachineOSBuild' "$PLIST" 2>/dev/null || true)"
fi
rm -rf "$TMP_UNPACK"

echo "Uploading..."
xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$KEY_ID" --apiIssuer "$ISSUER"
echo "UPLOAD SUCCEEDED"
