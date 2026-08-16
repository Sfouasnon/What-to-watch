import { describe, expect, it } from "vitest";

import {
  bestWatchHubStream,
  isContentSpecificTarget,
  normalizeWatchHubProvider,
  parseAndroidIntentUri,
  preferredVerifiedTarget,
  targetsFromWatchHubStream,
} from "./watchhub-launch-targets.mjs";

describe("WatchHub launch target normalization", () => {
  it("keeps direct services distinct from Amazon Channels", () => {
    expect(normalizeWatchHubProvider("Amazon Video")?.providerKey).toBe("prime-video");
    expect(normalizeWatchHubProvider("HBO Max")?.providerKey).toBe("max");
    expect(normalizeWatchHubProvider("HBO Max Amazon Channel")?.providerKey).toBe("max-amazon-channel");
    expect(normalizeWatchHubProvider("Paramount+ Amazon Channel")?.providerKey).toBe("paramount-plus-amazon-channel");
  });

  it("extracts only non-sensitive routing metadata from Android intent URIs", () => {
    expect(parseAndroidIntentUri(
      "intent://example.test/watch#Intent;package=com.example.tv;action=android.intent.action.VIEW;S.secret=ignored;end",
    )).toEqual({ packageName: "com.example.tv", action: "android.intent.action.VIEW" });
  });

  it("does not mistake a contentless app launch for an exact title target", () => {
    expect(isContentSpecificTarget(
      "intent://#Intent;launchFlags=0x00800000;component=com.peacock.peacockfiretv/com.peacock.MainActivity;end",
    )).toBe(false);
    expect(isContentSpecificTarget(
      "intent://www.peacocktv.com/deeplink?deeplinkData=%7B%22pvid%22%3A%22abc%22%7D#Intent;scheme=https;end",
    )).toBe(true);
    expect(isContentSpecificTarget("https://www.netflix.com/")).toBe(false);
    expect(isContentSpecificTarget(
      "intent://www.netflix.com#Intent;scheme=https;package=com.netflix.ninja;end",
    )).toBe(false);
  });

  it("preserves all platform targets and chooses the richer provider stream", () => {
    const weak = { name: "Netflix", externalUrl: "https://www.netflix.com/search?q=test" };
    const strong = {
      name: "Netflix",
      externalUrl: "https://www.netflix.com/title/81289483",
      androidTvUrl: "intent://www.netflix.com/watch/81289483#Intent;package=com.netflix.ninja;scheme=https;end",
      fireTvUrl: "intent://www.netflix.com/watch/81289483#Intent;package=com.netflix.ninja;scheme=https;end",
    };
    expect(bestWatchHubStream([weak, strong], "netflix")).toBe(strong);
    expect(targetsFromWatchHubStream(strong).map((target) => target.platform)).toEqual(["web", "android_tv", "fire_tv"]);
  });

  it("preserves provider-native URI schemes for the device sanitizer", () => {
    const targets = targetsFromWatchHubStream({
      name: "Amazon Video",
      fireTvUrl: "amzn://com.amazon.tv.launcher/detail?provider=aiv&providerId=abc123",
      androidTvUrl: "pplus://play/video/xyz789",
    });
    expect(targets.map((target) => target.target_uri)).toEqual([
      "pplus://play/video/xyz789",
      "amzn://com.amazon.tv.launcher/detail?provider=aiv&providerId=abc123",
    ]);
    expect(targets.every((target) => target.target_kind === "uri" && target.content_specific)).toBe(true);
  });

  it("prefers a verified exact Fire TV target but falls back to Android TV", () => {
    const fire = { platform: "fire_tv", verification_status: "verified", content_specific: false };
    const android = { platform: "android_tv", verification_status: "verified", content_specific: true };
    expect(preferredVerifiedTarget([fire, android])).toBe(android);
  });
});
