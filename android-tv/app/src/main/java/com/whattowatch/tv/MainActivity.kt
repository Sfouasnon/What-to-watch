package com.whattowatch.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.addCallback
import androidx.activity.ComponentActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private data class ProviderContract(
        val packages: Set<String>,
        val schemes: Set<String> = setOf("https"),
        val hosts: Set<String> = emptySet(),
        val webHosts: Set<String> = hosts,
        val forcedPackage: String? = null,
        val forcedClass: String? = null,
        val action: String? = null,
        val dataExtraName: String? = null,
        val contentExtra: String? = null,
    )

    private lateinit var webView: WebView
    private val appOrigin by lazy { Uri.parse(BuildConfig.WEB_APP_URL).host.orEmpty() }
    private val providerContracts = mapOf(
        "netflix" to ProviderContract(
            packages = setOf("com.netflix.ninja"),
            hosts = setOf("netflix.com"),
            forcedPackage = "com.netflix.ninja",
            forcedClass = "com.netflix.ninja.MainActivity",
            action = Intent.ACTION_VIEW,
            dataExtraName = "amzn_deeplink_data",
        ),
        "prime-video" to primeVideoContract(),
        "max-amazon-channel" to primeVideoContract(),
        "paramount-plus-amazon-channel" to primeVideoContract(),
        "apple-tv-plus" to ProviderContract(
            packages = setOf("com.apple.atve.amazon.appletv"),
            hosts = setOf("tv.apple.com"),
            forcedPackage = "com.apple.atve.amazon.appletv",
            forcedClass = "com.apple.atve.amazon.appletv.MainActivity",
        ),
        "hulu" to ProviderContract(
            packages = setOf("com.hulu.plus"),
            webHosts = setOf("hulu.com"),
            forcedPackage = "com.hulu.plus",
            forcedClass = "com.hulu.plus.SplashActivity",
            action = Intent.ACTION_VIEW,
            dataExtraName = "content_id",
        ),
        "disney-plus" to ProviderContract(
            packages = setOf("com.disney.disneyplus"),
            hosts = setOf("disneyplus.com"),
            forcedPackage = "com.disney.disneyplus",
            forcedClass = "com.bamtechmedia.dominguez.main.MainActivity",
        ),
        "max" to ProviderContract(
            packages = setOf("com.hbo.hbonow"),
            hosts = setOf("max.com", "play.max.com"),
        ),
        "peacock" to ProviderContract(
            packages = setOf("com.peacock.peacockfiretv"),
            hosts = setOf("peacocktv.com"),
            forcedPackage = "com.peacock.peacockfiretv",
        ),
        "paramount-plus" to ProviderContract(
            packages = setOf("com.cbs.app"),
            schemes = setOf("https", "pplus"),
            hosts = setOf("paramountplus.com"),
            forcedPackage = "com.cbs.app",
        ),
    )

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(8, 7, 8))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            webChromeClient = WebChromeClient()
            webViewClient = TrustedAppWebViewClient()
            addJavascriptInterface(StreamerBridge(this@MainActivity), "WhatToWatchNative")
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }

        setContentView(webView)
        if (savedInstanceState == null) webView.loadUrl(BuildConfig.WEB_APP_URL)
        else webView.restoreState(savedInstanceState)
        webView.requestFocus()

        if (BuildConfig.DEBUG) {
            intent.getStringExtra(TEST_LAUNCH_TARGET_EXTRA)?.let { payload ->
                webView.post { openLaunchTarget(payload, allowUnverified = true) }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (BuildConfig.DEBUG) {
            intent.getStringExtra(TEST_LAUNCH_TARGET_EXTRA)?.let { payload ->
                openLaunchTarget(payload, allowUnverified = true)
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            webView.evaluateJavascript(
                "document.activeElement && document.activeElement.click && document.activeElement.click()",
                null,
            )
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun openExternal(target: String) {
        val uri = runCatching { Uri.parse(target) }.getOrNull() ?: return
        if (uri.scheme != "https" && uri.scheme != "http") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            webView.loadUrl(target)
        }
    }

    private fun hostAllowed(host: String?, allowedHosts: Set<String>): Boolean {
        val value = host?.lowercase() ?: return false
        return allowedHosts.any { allowed -> value == allowed || value.endsWith(".$allowed") }
    }

    private fun sanitizedLaunchIntent(payload: JSONObject, allowUnverified: Boolean): Intent? {
        val providerKey = payload.optString("providerKey")
        val contract = providerContracts[providerKey] ?: return null
        if (!payload.optBoolean("contentSpecific", false)) return null
        if (!allowUnverified && payload.optString("verificationStatus") != "verified") return null
        if (payload.optString("platform") !in setOf("web", "android_tv", "fire_tv")) return null

        val targetKind = payload.optString("targetKind")
        if (targetKind == "android_string_extra") {
            val packageName = payload.optString("packageName")
            val componentName = payload.optString("componentName")
            val action = payload.optString("action")
            val extraName = payload.optString("dataExtraName")
            val extraValue = payload.optString("dataExtraValue")
            if (
                packageName !in contract.packages || packageName != contract.forcedPackage ||
                componentName != contract.forcedClass || action != contract.action ||
                extraName != contract.dataExtraName ||
                extraValue.length !in 1..512 || extraValue.any { it.isISOControl() }
            ) return null
            return Intent(action)
                .setClassName(packageName, componentName)
                .putExtra(extraName, extraValue)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val targetUri = payload.optString("targetUri")
        if (targetUri.length !in 1..4096) return null
        val isIntentUri = targetUri.startsWith("intent:")
        if (targetKind !in setOf("uri", "android_intent_uri")) return null
        if ((targetKind == "android_intent_uri") != isIntentUri) return null
        val parsed = runCatching {
            if (isIntentUri) Intent.parseUri(targetUri, Intent.URI_INTENT_SCHEME)
            else Intent(Intent.ACTION_VIEW, Uri.parse(targetUri))
        }.getOrNull() ?: return null

        val parsedPackage = parsed.`package` ?: parsed.component?.packageName
        if (parsedPackage != null && parsedPackage !in contract.packages) return null

        if (contract.action != null && contract.contentExtra != null) {
            if (parsed.action != contract.action) return null
            val contentId = parsed.getStringExtra(contract.contentExtra) ?: return null
            if (!contentId.matches(Regex("^[A-Za-z0-9._:-]{1,240}$"))) return null
            return Intent(contract.action)
                .setPackage(contract.forcedPackage)
                .putExtra(contract.contentExtra, contentId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        if (parsed.action != null && parsed.action != Intent.ACTION_VIEW) return null
        val data = parsed.data ?: return null
        val scheme = data.scheme?.lowercase() ?: return null
        if (scheme !in contract.schemes) return null
        if (scheme == "http" || scheme == "https") {
            if (!hostAllowed(data.host, contract.hosts)) return null
        } else if (providerKey == "prime-video" || providerKey.endsWith("-amazon-channel")) {
            if (scheme != "amzn" || data.host != "com.amazon.tv.launcher" || data.path != "/detail") return null
            if (data.getQueryParameter("provider") != "aiv" || data.getQueryParameter("providerId").isNullOrBlank()) return null
        } else if (providerKey == "paramount-plus") {
            val nativeVideoRoute = data.host == "play" && data.path?.startsWith("/video/") == true
            if (scheme != "pplus" || (!nativeVideoRoute && !hostAllowed(data.host, contract.hosts))) return null
        } else {
            return null
        }

        return Intent(Intent.ACTION_VIEW, data)
            .apply {
                if (contract.forcedPackage != null && contract.forcedClass != null) {
                    setClassName(contract.forcedPackage, contract.forcedClass)
                } else {
                    (parsedPackage ?: contract.forcedPackage)?.let(::setPackage)
                }
            }
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun openLaunchTarget(payload: String, allowUnverified: Boolean = false) {
        val target = runCatching { JSONObject(payload) }.getOrNull() ?: return
        val launchIntent = sanitizedLaunchIntent(target, allowUnverified)
        val contract = providerContracts[target.optString("providerKey")]
        val webFallback = target.optString("webUrl").takeIf { url ->
            val uri = runCatching { Uri.parse(url) }.getOrNull()
            uri?.scheme in setOf("https", "http") &&
                contract != null && hostAllowed(uri?.host, contract.webHosts)
        }
        if (launchIntent == null || launchIntent.resolveActivity(packageManager) == null) {
            webFallback?.let(::openExternal)
            return
        }
        try {
            startActivity(launchIntent)
        } catch (_: ActivityNotFoundException) {
            webFallback?.let(::openExternal)
        }
    }

    private inner class TrustedAppWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "https" && uri.host == appOrigin) return false
            openExternal(uri.toString())
            return true
        }
    }

    class StreamerBridge(private val activity: Activity) {
        @JavascriptInterface
        fun openExternal(target: String) {
            activity.runOnUiThread {
                (activity as? MainActivity)?.openExternal(target)
            }
        }

        @JavascriptInterface
        fun openLaunchTarget(payload: String) {
            activity.runOnUiThread {
                (activity as? MainActivity)?.openLaunchTarget(payload)
            }
        }
    }

    companion object {
        private const val TEST_LAUNCH_TARGET_EXTRA = "launch_target_json"

        private fun primeVideoContract() = ProviderContract(
            packages = setOf("com.amazon.tv.launcher"),
            schemes = setOf("amzn"),
            webHosts = setOf("amazon.com"),
            forcedPackage = "com.amazon.tv.launcher",
        )
    }
}
