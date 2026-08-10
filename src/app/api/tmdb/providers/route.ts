import { NextResponse } from "next/server";
import { z } from "zod";

import { isTmdbConfigured, tmdb, TmdbUpstreamError } from "@/lib/tmdb";

export const runtime = "nodejs";

const providerCatalogSchema = z.object({
  region: z.string().trim().length(2).transform((value) => value.toUpperCase()),
});

export async function GET(request: Request) {
  if (!isTmdbConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "TMDB_NOT_CONFIGURED",
          message: "Streaming provider discovery is unavailable until TMDB_TOKEN is configured.",
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const parsed = providerCatalogSchema.safeParse({
    region: url.searchParams.get("region") ?? "US",
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PROVIDER_REGION",
          message: "Provide a two-letter watch region.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await tmdb.getProviderCatalog(parsed.data.region);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    const message = error instanceof TmdbUpstreamError
      ? "TMDB could not complete the provider catalog lookup."
      : "Provider catalog lookup failed unexpectedly.";
    return NextResponse.json(
      { error: { code: "TMDB_UPSTREAM_ERROR", message } },
      { status: 502 },
    );
  }
}
