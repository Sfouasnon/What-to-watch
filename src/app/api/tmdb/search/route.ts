import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isTmdbConfigured,
  tmdb,
  TmdbUpstreamError,
} from "@/lib/tmdb";

export const runtime = "nodejs";

const searchSchema = z.object({
  query: z.string().trim().min(2).max(100),
  page: z.coerce.number().int().min(1).max(20).default(1),
});

export async function GET(request: Request) {
  if (!isTmdbConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "TMDB_NOT_CONFIGURED",
          message: "Title search is unavailable until TMDB_TOKEN is configured.",
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const parsed = searchSchema.safeParse({
    query: url.searchParams.get("query") ?? url.searchParams.get("q"),
    page: url.searchParams.get("page") ?? 1,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SEARCH",
          message: "Provide a search query between 2 and 100 characters.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await tmdb.searchTitles(parsed.data.query, parsed.data.page);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
    });
  } catch (error) {
    const message = error instanceof TmdbUpstreamError
      ? "TMDB could not complete the title search."
      : "Title search failed unexpectedly.";
    return NextResponse.json(
      { error: { code: "TMDB_UPSTREAM_ERROR", message } },
      { status: 502 },
    );
  }
}

