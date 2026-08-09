import { NextResponse } from "next/server";
import { z } from "zod";

import { isTmdbConfigured, tmdb, TmdbUpstreamError } from "@/lib/tmdb";

export const runtime = "nodejs";

const providerSchema = z.object({
  mediaType: z.enum(["movie", "tv"]),
  id: z.coerce.number().int().positive(),
  region: z.string().trim().length(2).transform((value) => value.toUpperCase()),
});

export async function GET(request: Request) {
  if (!isTmdbConfigured()) {
    return NextResponse.json({ error: { code: "TMDB_NOT_CONFIGURED", message: "Provider availability is unavailable until TMDB_TOKEN is configured." } }, { status: 503 });
  }
  const url = new URL(request.url);
  const parsed = providerSchema.safeParse({
    mediaType: url.searchParams.get("mediaType"),
    id: url.searchParams.get("id"),
    region: url.searchParams.get("region") ?? "US",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_PROVIDER_LOOKUP", message: "Provide mediaType=movie|tv, a positive TMDB id, and a two-letter region." } }, { status: 400 });
  }
  try {
    const result = await tmdb.getWatchProviders(parsed.data.mediaType, parsed.data.id, parsed.data.region);
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch (error) {
    const message = error instanceof TmdbUpstreamError ? "TMDB could not complete the provider lookup." : "Provider lookup failed unexpectedly.";
    return NextResponse.json({ error: { code: "TMDB_UPSTREAM_ERROR", message } }, { status: 502 });
  }
}
