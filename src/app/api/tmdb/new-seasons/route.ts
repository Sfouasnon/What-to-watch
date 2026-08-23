import { NextRequest, NextResponse } from "next/server";

import { isTmdbConfigured, tmdb } from "@/lib/tmdb";

const MAX_SHOWS = 25;

export async function GET(request: NextRequest) {
  const ids = [...new Set(
    (request.nextUrl.searchParams.get("ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];

  if (!ids.length) return NextResponse.json({ seasons: [] });
  if (ids.length > MAX_SHOWS) {
    return NextResponse.json({ error: `A maximum of ${MAX_SHOWS} shows can be checked at once.` }, { status: 400 });
  }
  if (!isTmdbConfigured()) {
    return NextResponse.json({ error: "TMDB is not configured." }, { status: 503 });
  }

  const results = await Promise.allSettled(ids.map((id) => tmdb.getLatestReleasedSeason(id)));
  const seasons = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed === results.length) {
    return NextResponse.json({ error: "Unable to check television seasons." }, { status: 502 });
  }
  return NextResponse.json(
    { seasons, failed },
    { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
