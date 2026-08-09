import { NextResponse } from "next/server";
import { z } from "zod";

import { tmdbDetailsToDomainTitle } from "@/lib/tmdb/domain";
import { isTmdbConfigured, tmdb, TmdbUpstreamError } from "@/lib/tmdb";

export const runtime = "nodejs";

const titleSchema = z.object({
  mediaType: z.enum(["movie", "tv"]),
  id: z.coerce.number().int().positive(),
  region: z.string().trim().length(2).transform((value) => value.toUpperCase()).default("US"),
});

export async function GET(request: Request) {
  if (!isTmdbConfigured()) {
    return NextResponse.json(
      { error: { code: "TMDB_NOT_CONFIGURED", message: "Live title metadata is not configured." } },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const parsed = titleSchema.safeParse({
    mediaType: url.searchParams.get("mediaType"),
    id: url.searchParams.get("id"),
    region: url.searchParams.get("region") ?? "US",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_TITLE_LOOKUP", message: "Provide a movie or TV TMDB identity." } },
      { status: 400 },
    );
  }

  try {
    const details = await tmdb.getTitleDetails(
      parsed.data.mediaType,
      parsed.data.id,
      parsed.data.region,
    );
    return NextResponse.json(
      { title: tmdbDetailsToDomainTitle(details) },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    const status = error instanceof TmdbUpstreamError && error.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: { code: "TMDB_TITLE_ERROR", message: status === 404 ? "Title not found." : "TMDB title metadata is temporarily unavailable." } },
      { status },
    );
  }
}
