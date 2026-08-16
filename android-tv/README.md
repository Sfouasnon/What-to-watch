# Fire TV development shell

This Android TV project wraps the dedicated `/tv` route in a small native WebView shell. The shell supplies the one capability the hosted web tester cannot guarantee: handing a verified title URL to Fire OS as an Android `ACTION_VIEW` intent so the installed streaming app can claim it.

## Device target

- Insignia NS-50F301NA22
- Fire OS 7 / Android 9 compatibility
- Minimum Android API 22; tested target is API 28 on the television

## Build in Android Studio

1. Install current Android Studio and open this `android-tv` directory.
2. Let Android Studio install Android SDK 35 and sync Gradle.
3. If testing a preview rather than production, change `WEB_APP_URL` in `app/build.gradle.kts` to that preview's `/tv` URL.
4. Build the debug APK with **Build → Build APK(s)**. Android Studio writes it below `app/build/outputs/apk/debug/`.

## Build with the Gradle Wrapper

The checked-in Wrapper pins Gradle 8.11.1, the version required by Android Gradle Plugin 8.9.1, and verifies the downloaded distribution with its published SHA-256 checksum. Install JDK 17 and Android SDK 35, then run:

```bash
cd android-tv
JAVA_HOME=/path/to/jdk-17 \
ANDROID_HOME=/path/to/android-sdk \
./gradlew lintDebug testDebugUnitTest assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. On the development Mac used for the 2026-08-15 device pass, the corresponding environment is:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
./gradlew lintDebug testDebugUnitTest assembleDebug
```

## Sideload

```bash
adb connect FIRE_TV_IP:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.whattowatch.tv 1
```

The shell only keeps the What to Watch HTTPS origin inside its WebView. Watch options become directly launchable only after a content-specific target has been verified on a real device. The catalog stores web, Android TV, and Fire TV targets separately. A provider target may be a URI, a serialized Android intent URI, or a scalar string extra named by the provider's Fire TV launcher capability.

Resolver-provided Android intent strings are never forwarded wholesale. The shell extracts the proposed data/action/content ID, checks it against a provider allowlist, and creates a fresh intent without inherited extras or components. Scalar-extra targets require an exact allowlisted package, class, action, and extra name; arbitrary JSON fields never become Android intent extras. Current contracts cover Netflix, Prime Video and Amazon Channels, Hulu, Disney+, Max, Peacock, and Paramount+.

### Production Fire TV evidence, 2026-08-15

Device `AFTDCT31`, Fire OS build `PS7713.5443N`, exposed PLAY capabilities for Netflix, Hulu, Disney+, and Apple TV. The device-owner verification scope is Netflix, Hulu, Disney+, Apple TV+, and Prime Video. Netflix 13.1.2 advertised `android.intent.action.VIEW`, `com.netflix.ninja.MainActivity`, flags `268435456`, and the scalar extra `amzn_deeplink_data`.

For *Bo Burnham: Inside*, the WatchHub HTTPS/intent candidate opened Netflix's top page and is rejected. A cold-start replay with `amzn_deeplink_data=81289483` opened the exact title and is the verified Fire TV target. Raw device fingerprints, package declarations, and logcat captures live under the Git-ignored `.firetv-captures/` directory.

Hulu's advertised `VIEW` contract uses `com.hulu.plus.SplashActivity` and the scalar extra `content_id`; `55349764-323e-4d0e-898f-a4c12c9bf615` continued to *Prey* after sign-in and is verified. Disney+'s explicit `MainActivity` plus its official entity URI continued to *Finding Nemo* after sign-in and is verified. Apple TV 16.2.0 advertised an explicit URI-based `VIEW` contract; its official *Severance* URI opened the exact series page and is verified.

Prime Video remains unverified on this build. Fire launcher `amzn://.../detail` candidates produced an error, the constructed Prime app `detail?gti=` route produced error 5004, and the official public *Fallout* URL opened Prime Video without retaining the title. None of those targets may be published as content-specific.

## Verify a launch target on the television

Only debug builds accept the `launch_target_json` ADB extra.

1. Import a bounded candidate after reviewing the dry run:

   ```bash
   npm run catalog:refresh-launch-targets -- --tmdb=movie:823754 --limit=1
   npm run catalog:refresh-launch-targets -- --tmdb=movie:823754 --limit=1 --write
   ```

2. Inspect the stored candidate and copy one compact object from `adbPayloads`:

   ```bash
   npm run catalog:verify-launch-target -- --tmdb=movie:823754 --provider=netflix --platform=fire_tv
   ```

3. Launch that payload through the same sanitizer used by the production bridge:

   ```bash
   adb shell am start -S \
     -n com.whattowatch.tv/.MainActivity \
     --es launch_target_json 'PASTE_COMPACT_ADB_PAYLOAD_JSON_HERE'
   ```

4. Confirm that the installed provider opened the exact title—not its home screen, search screen, or a browser—then persist the result:

   ```bash
   npm run catalog:verify-launch-target -- \
     --tmdb=movie:823754 \
     --provider=netflix \
     --platform=fire_tv \
     --status=verified \
     --notes='Fire OS 7 exact-title launch' \
     --write
   ```

Use `--status=rejected` when the target opens the wrong surface. If the resolver later changes the target, publication automatically resets it to `unverified`.

When Comrade reports a scalar `DATA_EXTRA_NAME`, record the typed contract before verifying it:

```bash
npm run catalog:record-fire-tv-extra -- \
  --tmdb=movie:823754 \
  --provider=netflix \
  --package=com.netflix.ninja \
  --component=com.netflix.ninja.MainActivity \
  --action=android.intent.action.VIEW \
  --data-extra-name=amzn_deeplink_data \
  --data-extra-value=81289483 \
  --device-model=AFTDCT31 \
  --fire-os-build=PS7713.5443N \
  --app-version=13.1.2 \
  --write
```

## Amazon Content SDK versus provider deep links

The `com.amazon.tv.developer.content.sdk` library is not a directory of streaming-app deep links. Its `AmazonContentId` must use an ID from an app's own Amazon catalog integration (the legacy CDF `CommonWorkType/ID` namespace), and its receivers publish playback state, watchlist activity, interactions, and entitlements back to Fire TV. It becomes relevant only if What to Watch owns playable catalog content and completes Amazon launcher/catalog integration.

What to Watch is currently an aggregator that launches titles owned by other streaming apps. It uses verified, offer-level launch targets and Android `ACTION_VIEW`; it must not claim another provider's content IDs, playback events, or entitlements. Amazon's current catalog path for new partners is EMBER, while CDF is legacy-only. See Amazon's [launcher integration](https://developer.amazon.com/docs/catalog/integrate-with-launcher.html) and [EMBER overview](https://developer.amazon.com/docs/catalog/ember-catalog-integration-overview.html).
