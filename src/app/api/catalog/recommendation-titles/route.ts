import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  buildAppCatalogTitle,
  GOLD_CATALOG_SIZE,
  type CatalogClassificationRow,
  type CatalogInputRow,
  type CatalogTitleRow,
} from "@/lib/catalog/recommendation-catalog";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Catalog service is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: classifications, error: classificationError } = await supabase
    .from("title_editorial_classifications")
    .select("title_id,primary_subgenre,secondary_subgenre,tone_tags,pacing,confidence,review_status")
    .eq("review_status", "gold")
    .order("title_id");

  if (classificationError) {
    return NextResponse.json(
      { error: "Unable to load editorial catalog." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const gold = (classifications ?? []) as CatalogClassificationRow[];
  if (gold.length !== GOLD_CATALOG_SIZE) {
    return NextResponse.json(
      { error: `Expected ${GOLD_CATALOG_SIZE} gold classifications, found ${gold.length}.` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const titleIds = gold.map((classification) => classification.title_id);
  const [{ data: titles, error: titleError }, { data: inputs, error: inputError }] = await Promise.all([
    supabase
      .from("titles")
      .select("id,tmdb_id,tmdb_media_type,content_type,name,overview,release_date,runtime_minutes,episode_runtime_minutes,season_count,episode_count,original_language,production_countries,popularity,vote_average,vote_count,canonical_score,poster_path,backdrop_path")
      .in("id", titleIds),
    supabase
      .from("title_classification_inputs")
      .select("title_id,tmdb_genres,directors,writers,cinematographers,principal_cast,keywords,raw_payload")
      .in("title_id", titleIds),
  ]);

  if (titleError || inputError) {
    return NextResponse.json(
      { error: "Unable to load catalog metadata." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const titleById = new Map((titles ?? []).map((title) => [title.id, title as CatalogTitleRow]));
  const inputById = new Map((inputs ?? []).map((input) => [input.title_id, input as CatalogInputRow]));
  const catalog = gold.flatMap((classification) => {
    const title = titleById.get(classification.title_id);
    const input = inputById.get(classification.title_id);
    if (!title || !input) return [];
    const mapped = buildAppCatalogTitle(title, input, classification);
    return mapped ? [mapped] : [];
  });

  if (catalog.length !== GOLD_CATALOG_SIZE) {
    return NextResponse.json(
      { error: `Expected ${GOLD_CATALOG_SIZE} mapped titles, found ${catalog.length}.` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  catalog.sort((a, b) => b.baseline - a.baseline || b.popularity - a.popularity || a.name.localeCompare(b.name));

  return NextResponse.json(
    {
      source: "supabase-gold",
      titleCount: catalog.length,
      titles: catalog,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
