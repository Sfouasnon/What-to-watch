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

## Sideload

```bash
adb connect FIRE_TV_IP:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.whattowatch.tv 1
```

The shell only keeps the What to Watch HTTPS origin inside its WebView. Watch options become directly launchable only after a content-specific target has been verified on a real device. The catalog stores web, Android TV, and Fire TV targets separately and may prefer an exact Android TV target over a contentless Fire TV app launch.

Resolver-provided Android intent strings are never forwarded wholesale. The shell extracts the proposed data/action/content ID, checks it against a provider allowlist, and creates a fresh intent without inherited extras or components. Current contracts cover Netflix, Prime Video and Amazon Channels, Hulu, Disney+, Max, Peacock, and Paramount+.

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

## Amazon Content SDK versus provider deep links

The `com.amazon.tv.developer.content.sdk` library is not a directory of streaming-app deep links. Its `AmazonContentId` must use an ID from an app's own Amazon catalog integration (the legacy CDF `CommonWorkType/ID` namespace), and its receivers publish playback state, watchlist activity, interactions, and entitlements back to Fire TV. It becomes relevant only if What to Watch owns playable catalog content and completes Amazon launcher/catalog integration.

What to Watch is currently an aggregator that launches titles owned by other streaming apps. It uses verified, offer-level launch targets and Android `ACTION_VIEW`; it must not claim another provider's content IDs, playback events, or entitlements. Amazon's current catalog path for new partners is EMBER, while CDF is legacy-only. See Amazon's [launcher integration](https://developer.amazon.com/docs/catalog/integrate-with-launcher.html) and [EMBER overview](https://developer.amazon.com/docs/catalog/ember-catalog-integration-overview.html).
