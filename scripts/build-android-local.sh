#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"
ANDROID_DIR="$MOBILE_DIR/android"
MODE="${1:-fast}"

if [[ "$MODE" != "fast" && "$MODE" != "apk" && "$MODE" != "play" ]]; then
  echo "Usage: $0 [fast|apk|play]" >&2
  exit 2
fi

if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java 17 not found. Run first: brew install openjdk@17" >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools ]]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
export NODE_ENV="${NODE_ENV:-production}"

run_timed() {
  local label="$1"
  shift
  local started_at=$SECONDS

  echo "[$(date '+%H:%M:%S')] Start: ${label}"
  "$@"
  echo "[$(date '+%H:%M:%S')] Done: ${label} ($((SECONDS - started_at)) s)"
}

if [[ -z "$ANDROID_SDK_ROOT" ]]; then
  echo "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT." >&2
  exit 1
fi

cd "$PROJECT_ROOT"
run_timed "Install JavaScript dependencies" bun install --frozen-lockfile
run_timed "Prepare mobile icons" bun run prepare:mobile:icons

PREBUILD_FINGERPRINT="$({
  shasum \
    apps/mobile/app.json \
    apps/mobile/assets/adaptive-icon-transparent.svg \
    apps/web/public/pwa-512x512.png \
    patches/expo-sharing@57.0.22.patch \
    bun.lock
} | shasum | awk '{print $1}')"
PREBUILD_STAMP="$ANDROID_DIR/.ponder-prebuild-fingerprint"
PREVIOUS_FINGERPRINT="$(test -f "$PREBUILD_STAMP" && cat "$PREBUILD_STAMP" || true)"

if [[ ! -x "$ANDROID_DIR/gradlew" || "$PREBUILD_FINGERPRINT" != "$PREVIOUS_FINGERPRINT" ]]; then
  echo "Updating the Android native project (keeping the existing compile cache)..."
  cd "$MOBILE_DIR"
  run_timed "Generate the Android native project" bunx expo prebuild --platform android
  printf '%s' "$PREBUILD_FINGERPRINT" > "$PREBUILD_STAMP"
else
  echo "Skipping Android prebuild: native configuration has not changed."
fi

cd "$ANDROID_DIR"
COMMON_ARGS=(
  --build-cache
  --parallel
  --daemon
  -Dorg.gradle.jvmargs=-Xmx6g\ -XX:MaxMetaspaceSize=1g\ -Dfile.encoding=UTF-8
)

: "${ANDROID_KEYSTORE_FILE:?Set ANDROID_KEYSTORE_FILE (local upload key path)}"
: "${ANDROID_KEYSTORE_PASSWORD:?Set ANDROID_KEYSTORE_PASSWORD}"
: "${ANDROID_KEY_ALIAS:?Set ANDROID_KEY_ALIAS}"
: "${ANDROID_KEY_PASSWORD:?Set ANDROID_KEY_PASSWORD}"

# Expo's DOM exporter writes current files without pruning old files. React Native's
# Gradle inputs also omit workspace packages. Rebuild only the generated JS/DOM
# assets from an empty directory; native compilation keeps its existing caches.
rm -rf "$ANDROID_DIR/app/build/generated/assets/react/release" \
  "$ANDROID_DIR/app/build/generated/res/react/release"
run_timed "Refresh production JavaScript and DOM assets" ./gradlew \
  :app:createBundleReleaseJsAndAssets --rerun --no-build-cache "${COMMON_ARGS[@]:1}"


PLAY_ARCHS="${PONDER_ANDROID_PLAY_ARCHS:-arm64-v8a}"
APK_ARCHS="${PONDER_ANDROID_APK_ARCHS:-arm64-v8a}"
KEYSTORE_FILE="$(cd "$(dirname "$ANDROID_KEYSTORE_FILE")" && pwd)/$(basename "$ANDROID_KEYSTORE_FILE")"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
APKSIGNER_PATH="$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner"

if [[ "$MODE" == "fast" ]]; then
  echo "Building a production-signed arm64 fast APK (R8, resource shrinking and PNG crunch off)..."
  run_timed "Gradle fast APK build" ./gradlew assembleRelease \
    "${COMMON_ARGS[@]}" \
    -PreactNativeArchitectures=arm64-v8a \
    -Pandroid.enableMinifyInReleaseBuilds=false \
    -Pandroid.enableShrinkResourcesInReleaseBuilds=false \
    -Pandroid.enablePngCrunchInReleaseBuilds=false \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
    -Pandroid.injected.signing.store.type=PKCS12
  test -s "$APK_PATH"
  test -x "$APKSIGNER_PATH"
  run_timed "Verify the fixed APK signature" \
    node "$PROJECT_ROOT/scripts/verify-android-apk-signature.mjs" \
    "$APK_PATH" "$APKSIGNER_PATH"
  echo "Done: $APK_PATH"
  exit 0
fi

if [[ "$MODE" == "apk" ]]; then
  echo "Building production-signed APK (${APK_ARCHS})..."
  run_timed "Gradle production APK build" ./gradlew assembleRelease \
    "${COMMON_ARGS[@]}" \
    -PreactNativeArchitectures="$APK_ARCHS" \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
    -Pandroid.injected.signing.store.type=PKCS12
  AAPT2_PATH="$ANDROID_SDK_ROOT/build-tools/36.0.0/aapt2"
  test -s "$APK_PATH"
  test -x "$APKSIGNER_PATH"
  test -x "$AAPT2_PATH"
  run_timed "Verify the fixed APK signature" \
    node "$PROJECT_ROOT/scripts/verify-android-apk-signature.mjs" \
    "$APK_PATH" "$APKSIGNER_PATH"
  run_timed "Read APK info" bash -c '"$1" dump badging "$2" | sed -n "1p"' _ "$AAPT2_PATH" "$APK_PATH"
  run_timed "Compute APK SHA-256" shasum -a 256 "$APK_PATH"
  echo "Done: $APK_PATH"
  exit 0
fi

echo "Building Play-signed AAB (${PLAY_ARCHS})..."
run_timed "Gradle production AAB build" ./gradlew bundleRelease \
  "${COMMON_ARGS[@]}" \
  -PreactNativeArchitectures="$PLAY_ARCHS" \
  -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
  -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
  -Pandroid.injected.signing.store.type=PKCS12

AAB_PATH="app/build/outputs/bundle/release/app-release.aab"
PACKAGED_MANIFEST="app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml"
test -s "$PACKAGED_MANIFEST"
if grep -q "android.permission.REQUEST_INSTALL_PACKAGES" "$PACKAGED_MANIFEST"; then
  echo "The final merged Play AAB manifest still contains REQUEST_INSTALL_PACKAGES. Stopping the release." >&2
  exit 1
fi
ACTUAL_PLAY_ARCHS="$(unzip -Z1 "$AAB_PATH" | sed -n 's#^base/lib/\([^/]*\)/.*#\1#p' | sort -u | paste -sd, -)"
if [[ "$ACTUAL_PLAY_ARCHS" != "$PLAY_ARCHS" ]]; then
  echo "AAB architectures are not as expected: wanted ${PLAY_ARCHS}, got ${ACTUAL_PLAY_ARCHS:-no native libraries}." >&2
  exit 1
fi

run_timed "Verify AAB signature" jarsigner -verify "$AAB_PATH"
test -s app/build/outputs/mapping/release/mapping.txt
echo "Done: $ANDROID_DIR/$AAB_PATH"
echo "Deobfuscation file: $ANDROID_DIR/app/build/outputs/mapping/release/mapping.txt"
