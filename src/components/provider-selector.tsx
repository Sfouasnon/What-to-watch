"use client";

import Image from "next/image";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { WatchProviderCatalogItem, WatchProviderCatalogResult } from "@/lib/tmdb";

type ProviderSelectorProps = {
  region: string;
  selected: string[];
  onChange: (selected: string[]) => void;
  mode?: "grid" | "list";
};

type CatalogStatus = "loading" | "live" | "fallback";

const legacySelectionNames: Record<number, string> = {
  8: "Netflix",
  9: "Prime Video",
  15: "Hulu",
  258: "Criterion Channel",
  337: "Disney+",
  350: "Apple TV+",
  386: "Peacock",
  531: "Paramount+",
  1899: "Max",
};

const fallbackProviders: WatchProviderCatalogItem[] = [
  { providerId: 8, providerName: "Netflix", logoUrl: null, displayPriority: 10, mediaTypes: ["movie", "tv"] },
  { providerId: 15, providerName: "Hulu", logoUrl: null, displayPriority: 20, mediaTypes: ["movie", "tv"] },
  { providerId: 337, providerName: "Disney+", logoUrl: null, displayPriority: 30, mediaTypes: ["movie", "tv"] },
  { providerId: 350, providerName: "Apple TV+", logoUrl: null, displayPriority: 40, mediaTypes: ["movie", "tv"] },
  { providerId: 9, providerName: "Prime Video", logoUrl: null, displayPriority: 50, mediaTypes: ["movie", "tv"] },
  { providerId: 1899, providerName: "Max", logoUrl: null, displayPriority: 60, mediaTypes: ["movie", "tv"] },
  { providerId: 386, providerName: "Peacock", logoUrl: null, displayPriority: 70, mediaTypes: ["movie", "tv"] },
  { providerId: 531, providerName: "Paramount+", logoUrl: null, displayPriority: 80, mediaTypes: ["movie", "tv"] },
  { providerId: 258, providerName: "Criterion Channel", logoUrl: null, displayPriority: 90, mediaTypes: ["movie", "tv"] },
];

function selectionName(provider: WatchProviderCatalogItem) {
  return legacySelectionNames[provider.providerId] ?? provider.providerName;
}

function fallbackMark(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ProviderLogo({ provider }: { provider: WatchProviderCatalogItem }) {
  if (!provider.logoUrl) return <span className="service-mark">{fallbackMark(provider.providerName)}</span>;
  return (
    <span
      className="service-mark"
      style={{ overflow: "hidden", padding: 0, background: "#fff" }}
      aria-hidden="true"
    >
      <Image
        src={provider.logoUrl}
        alt=""
        width={38}
        height={38}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </span>
  );
}

export function ProviderSelector({ region, selected, onChange, mode = "grid" }: ProviderSelectorProps) {
  const [providers, setProviders] = useState<WatchProviderCatalogItem[]>(fallbackProviders);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/tmdb/providers?region=${encodeURIComponent(region)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Provider catalog returned ${response.status}`);
        return response.json() as Promise<WatchProviderCatalogResult>;
      })
      .then((result) => {
        if (!result.providers.length) throw new Error("Provider catalog is empty");
        setProviders(result.providers);
        setStatus("live");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProviders(fallbackProviders);
        setStatus("fallback");
      });

    return () => controller.abort();
  }, [region]);

  const filteredProviders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? providers.filter((provider) => provider.providerName.toLowerCase().includes(normalizedQuery))
      : providers;

    if (normalizedQuery || showAll) return matches;

    const selectedProviders = matches.filter((provider) => selected.includes(selectionName(provider)));
    const popular = matches.slice(0, mode === "grid" ? 18 : 24);
    const seen = new Set(popular.map((provider) => provider.providerId));
    return [...popular, ...selectedProviders.filter((provider) => !seen.has(provider.providerId))];
  }, [mode, providers, query, selected, showAll]);

  const toggleProvider = (provider: WatchProviderCatalogItem) => {
    const key = selectionName(provider);
    onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };

  const statusText = status === "loading"
    ? `Loading services for ${region}…`
    : status === "live"
      ? `${providers.length} services available in ${region}`
      : "Showing starter services while the TMDB provider catalog is unavailable.";

  return (
    <div>
      <div className="search-box" style={{ marginTop: mode === "grid" ? 28 : 0 }}>
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search streaming services"
          aria-label="Search streaming services"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear provider search"><X size={17} /></button>}
      </div>
      <p className="form-note" style={{ marginTop: 10 }} aria-live="polite">{statusText}</p>

      {mode === "grid" ? (
        <div className="service-grid">
          {filteredProviders.map((provider) => {
            const key = selectionName(provider);
            const active = selected.includes(key);
            return (
              <button
                type="button"
                key={provider.providerId}
                className={`service-card ${active ? "is-active" : ""}`}
                onClick={() => toggleProvider(provider)}
                aria-pressed={active}
              >
                <ProviderLogo provider={provider} />
                <strong>{provider.providerName}</strong>
                {active && <Check size={17} />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="settings-service-list" style={{ marginTop: 18 }}>
          {filteredProviders.map((provider) => {
            const key = selectionName(provider);
            const active = selected.includes(key);
            return (
              <button type="button" key={provider.providerId} onClick={() => toggleProvider(provider)} aria-pressed={active}>
                <ProviderLogo provider={provider} />
                <span style={{ display: "grid", gap: 3 }}>
                  <strong>{provider.providerName}</strong>
                  <small style={{ color: "var(--muted)" }}>{provider.mediaTypes.length === 2 ? "Movies + TV" : provider.mediaTypes[0] === "movie" ? "Movies" : "TV"}</small>
                </span>
                <span className={`check-circle ${active ? "is-active" : ""}`}>{active && <Check size={14} />}</span>
              </button>
            );
          })}
        </div>
      )}

      {!query && providers.length > filteredProviders.length && (
        <button type="button" className="text-button" style={{ marginTop: 14 }} onClick={() => setShowAll(true)}>
          Show all {providers.length} services
        </button>
      )}
      {!query && showAll && providers.length > 24 && (
        <button type="button" className="text-button" style={{ marginTop: 14 }} onClick={() => setShowAll(false)}>
          Show popular services first
        </button>
      )}
      {status === "live" && <p className="form-note" style={{ marginTop: 10 }}>Streaming provider catalog supplied by TMDB.</p>}
    </div>
  );
}
