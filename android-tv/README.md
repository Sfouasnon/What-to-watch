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

The shell only keeps the What to Watch HTTPS origin inside its WebView. Watch-option and verified streamer URLs are sent through Fire OS so an installed provider app can handle them. If no app claims a link, Fire OS may offer a browser; the UI therefore says **View watch options** until a provider/title pair has a verified `deeplink_url`.

## Amazon Content SDK versus provider deep links

The `com.amazon.tv.developer.content.sdk` library is not a directory of streaming-app deep links. Its `AmazonContentId` must use an ID from an app's own Amazon catalog integration (the legacy CDF `CommonWorkType/ID` namespace), and its receivers publish playback state, watchlist activity, interactions, and entitlements back to Fire TV. It becomes relevant only if What to Watch owns playable catalog content and completes Amazon launcher/catalog integration.

What to Watch is currently an aggregator that launches titles owned by other streaming apps. It must therefore continue to use verified provider-specific `availability_offers.deeplink_url` values and Android `ACTION_VIEW`; it must not claim another provider's content IDs, playback events, or entitlements. Amazon's current catalog path for new partners is EMBER, while CDF is legacy-only. See Amazon's [launcher integration](https://developer.amazon.com/docs/catalog/integrate-with-launcher.html) and [EMBER overview](https://developer.amazon.com/docs/catalog/ember-catalog-integration-overview.html).
