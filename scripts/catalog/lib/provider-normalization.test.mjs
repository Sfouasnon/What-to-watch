import { describe, expect, it } from "vitest";

import {
  databaseOfferType,
  normalizedProvider,
  providerKey,
} from "./provider-normalization.mjs";

describe("provider normalization", () => {
  it("keeps profile service labels stable across TMDB provider variants", () => {
    expect(normalizedProvider("Amazon Prime Video")).toEqual({ providerName: "Prime Video", serviceSlug: "prime-video" });
    expect(normalizedProvider("Amazon Video")).toEqual({ providerName: "Prime Video", serviceSlug: "prime-video" });
    expect(normalizedProvider("HBO Max Amazon Channel")).toEqual({ providerName: "Max Amazon Channel", serviceSlug: "max-amazon-channel" });
    expect(normalizedProvider("Paramount+ Amazon Channel")).toEqual({ providerName: "Paramount+ Amazon Channel", serviceSlug: "paramount-plus-amazon-channel" });
    expect(normalizedProvider("Lionsgate+ Amazon Channels")).toEqual({ providerName: "Lionsgate+ Amazon Channels", serviceSlug: null });
  });

  it("derives bounded database keys and offer types", () => {
    expect(providerKey("Lionsgate+ Amazon Channels")).toBe("lionsgate-amazon-channels");
    expect(databaseOfferType("subscription")).toBe("subscription");
    expect(databaseOfferType("free")).toBe("free_ad_supported");
    expect(databaseOfferType("rental")).toBe("rent");
    expect(databaseOfferType("purchase")).toBe("buy");
  });
});
