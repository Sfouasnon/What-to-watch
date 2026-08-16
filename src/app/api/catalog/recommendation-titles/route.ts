import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  buildAppCatalogTitle,
  GOLD_CATALOG_SIZE,
  type CatalogAvailabilityRow,
  type CatalogCastContextRow,
  type CatalogClassificationRow,
  type CatalogInputRow,
  type CatalogLaunchTargetRow,
  type CatalogTitleRow,
} from "@/lib/catalog/recommendation-catalog";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";
const MINIMUM_PUBLISHED_CATALOG_SIZE = 1_000;
const QUERY_CHUNK_SIZE = 200;

async function fetchInChunks<T>(
  titleIds: readonly string[],
  query: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const data: T[] = [];
  for (let index = 0; index < titleIds.length; index += QUERY_CHUNK_SIZE) {
    const result = await query(titleIds.slice(index, index + QUERY_CHUNK_SIZE));
    if (result.error) return { data: [], error: result.error };
    data.push(...(result.data ?? []));
  }
  return { data, error: null };
}

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

  const classifications: CatalogClassificationRow[] = [];
  let classificationError: unknown = null;
  for (let from = 0; ; from += 500) {
    const result = await supabase
      .from("title_editorial_classifications")
      .select("title_id,primary_subgenre,secondary_subgenre,tone_tags,pacing,confidence,review_status")
      .in("review_status", ["gold", "accepted"])
      .order("title_id")
      .range(from, from + 499);
    if (result.error) {
      classificationError = result.error;
      break;
    }
    classifications.push(...((result.data ?? []) as CatalogClassificationRow[]));
    if ((result.data ?? []).length < 500) break;
  }

  if (classificationError) {
    return NextResponse.json(
      { error: "Unable to load editorial catalog." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const goldCount = classifications.filter((classification) => classification.review_status === "gold").length;
  if (goldCount !== GOLD_CATALOG_SIZE || classifications.length < MINIMUM_PUBLISHED_CATALOG_SIZE) {
    return NextResponse.json(
      {
        error: `Expected ${GOLD_CATALOG_SIZE} gold and at least ${MINIMUM_PUBLISHED_CATALOG_SIZE} published classifications; found ${goldCount}/${classifications.length}.`,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const titleIds = classifications.map((classification) => classification.title_id);
  const [
    { data: titles, error: titleError },
    { data: inputs, error: inputError },
    { data: castContexts, error: castContextError },
    { data: availability, error: availabilityError },
  ] = await Promise.all([
    fetchInChunks<CatalogTitleRow>(titleIds, (ids) => supabase
      .from("titles")
      .select("id,tmdb_id,tmdb_media_type,content_type,name,overview,release_date,runtime_minutes,episode_runtime_minutes,season_count,episode_count,original_language,production_countries,popularity,vote_average,vote_count,canonical_score,poster_path,backdrop_path")
      .in("id", ids)),
    fetchInChunks<CatalogInputRow>(titleIds, (ids) => supabase
      .from("title_classification_inputs")
      .select("title_id,tmdb_genres,directors,writers,cinematographers,principal_cast,keywords,raw_payload")
      .in("title_id", ids)),
    fetchInChunks<CatalogCastContextRow>(titleIds, (ids) => supabase
      .from("title_cast_context_cache")
      .select("title_id,cast_context")
      .in("title_id", ids)),
    fetchInChunks<CatalogAvailabilityRow>(titleIds, (ids) => supabase
      .from("availability_offers")
      .select("id,title_id,provider_key,provider_name,offer_type,deeplink_url")
      .in("title_id", ids)
      .eq("region", "US")
      .gt("expires_at", new Date().toISOString())),
  ]);

  if (titleError || inputError || castContextError || availabilityError) {
    return NextResponse.json(
      { error: "Unable to load catalog metadata." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const offerIds = (availability ?? []).map((offer) => offer.id);
  const { data: launchTargets, error: launchTargetError } = await fetchInChunks<CatalogLaunchTargetRow>(
    offerIds,
    (ids) => supabase
      .from("offer_launch_targets")
      .select("availability_offer_id,platform,target_kind,target_uri,package_name,component_name,action,content_specific,verification_status")
      .in("availability_offer_id", ids)
      .eq("verification_status", "verified")
      .eq("content_specific", true)
      .gt("expires_at", new Date().toISOString()),
  );
  if (launchTargetError) {
    return NextResponse.json(
      { error: "Unable to load verified launch targets." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const titleById = new Map((titles ?? []).map((title) => [title.id, title as CatalogTitleRow]));
  const inputById = new Map((inputs ?? []).map((input) => [input.title_id, input as CatalogInputRow]));
  const castContextById = new Map((castContexts ?? []).map((context) => [
    context.title_id,
    (context as CatalogCastContextRow).cast_context,
  ]));
  const availabilityById = new Map<string, CatalogAvailabilityRow[]>();
  const launchTargetsByOfferId = new Map<string, CatalogLaunchTargetRow[]>();
  for (const target of launchTargets ?? []) {
    launchTargetsByOfferId.set(target.availability_offer_id, [
      ...(launchTargetsByOfferId.get(target.availability_offer_id) ?? []),
      target,
    ]);
  }
  for (const offer of availability ?? []) {
    const enrichedOffer = { ...offer, launch_targets: launchTargetsByOfferId.get(offer.id) ?? [] };
    availabilityById.set(offer.title_id, [...(availabilityById.get(offer.title_id) ?? []), enrichedOffer]);
  }
  const catalog = classifications.flatMap((classification) => {
    const title = titleById.get(classification.title_id);
    const input = inputById.get(classification.title_id);
    if (!title || !input) return [];
    const mapped = buildAppCatalogTitle(
      title,
      input,
      classification,
      castContextById.get(classification.title_id),
      availabilityById.get(classification.title_id),
    );
    return mapped ? [mapped] : [];
  });

  if (catalog.length !== classifications.length) {
    return NextResponse.json(
      { error: `Expected ${classifications.length} mapped titles, found ${catalog.length}.` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  catalog.sort((a, b) => b.baseline - a.baseline || b.popularity - a.popularity || a.name.localeCompare(b.name));

  return NextResponse.json(
    {
      source: "supabase-editorial",
      titleCount: catalog.length,
      titles: catalog,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
