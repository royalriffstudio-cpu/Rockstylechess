#!/usr/bin/env bash
# Release-APK build helper. Run from anywhere:  bash scripts/build-apk.sh [fast|full]
#
#   fast  (default)  arm64-v8a only. Compiles the native C++ once instead of four
#                    times (roughly a quarter of the native build time) and gives a
#                    ~half-size APK. Installs on virtually every modern Android
#                    phone; will NOT install on old 32-bit phones or x86 emulators.
#                    Use for test builds you sideload on your own phone.
#   full             all four ABIs (armeabi-v7a, arm64-v8a, x86, x86_64) -- what
#                    android/gradle.properties declares. Use for anything you
#                    distribute / upload to the Play Store.
#
# The ABI list is passed as a Gradle -P flag, so android/gradle.properties (which
# `expo prebuild` regenerates and is gitignored) is never edited and the two modes
# can't drift. Gradle gets 4 GB of heap (the default there is 2 GB; the machine has
# the room). EXPO_PUBLIC_SERVER_URL is read from the root .env at bundle time --
# the script prints it so you can see which server the APK will talk to.
set -euo pipefail

MODE="${1:-fast}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$MODE" in
  fast) ABIS="arm64-v8a" ;;
  full) ABIS="armeabi-v7a,arm64-v8a,x86,x86_64" ;;
  *) echo "usage: bash scripts/build-apk.sh [fast|full]" >&2; exit 2 ;;
esac

# Node 22 (see README / memory notes) and a full JDK 17 (a JRE-only java fails deep in the build).
# shellcheck disable=SC1091
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 || true
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$PATH"

# Sentry: .env.sentry (gitignored) holds SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT / SENTRY_URL.
# With it, the Gradle plugin uploads source maps + native symbols so crash stack traces are readable;
# without it the build still succeeds (nothing is uploaded). Never print the token.
if [ -f "$ROOT/.env.sentry" ]; then
  set -a; source "$ROOT/.env.sentry"; set +a
fi
export SENTRY_ALLOW_FAILURE=true
if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then SENTRY_STATE="upload enabled (${SENTRY_ORG:-?}/${SENTRY_PROJECT:-?})"; else SENTRY_STATE="no token -- source maps will NOT be uploaded"; fi

echo "mode:    $MODE ($ABIS)"
echo "sentry:  $SENTRY_STATE"
echo "server:  $(grep -E '^EXPO_PUBLIC_SERVER_URL=' "$ROOT/.env" 2>/dev/null || echo 'EXPO_PUBLIC_SERVER_URL not set in .env')"

cd "$ROOT/android"
./gradlew assembleRelease \
  -PreactNativeArchitectures="$ABIS" \
  -Dorg.gradle.jvmargs="-Xmx4096m -XX:MaxMetaspaceSize=768m"

echo "APK: $ROOT/android/app/build/outputs/apk/release/app-release.apk"
