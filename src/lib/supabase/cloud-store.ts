"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database, FriendShareMode } from "./database.types";

export type CloudRentalMode = "never" | "exceptional" | "always";

export type CloudProfile = {
  id: string;
  accountId: string;
  name: string;
  avatar: string;
  color: string;
  guest: false;
  onboardingCompleted: boolean;
  region: string;
  subscriptions: string[];
  ratings: Record<string, number>;
  questionnaire: Record<string, number>;
  rentalMode: CloudRentalMode;
  modelVersion: number;
  shareWithFriends: FriendShareMode;
};

type Client = SupabaseClient<Database>;

const PROFILE_COLORS = ["ochre", "plum", "olive", "slate"] as const;

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function decodeAvatar(value: string | null, name: string) {
  const [storedColor, storedAvatar] = value?.split(":", 2) ?? [];
  return {
    color: PROFILE_COLORS.includes(storedColor as (typeof PROFILE_COLORS)[number])
      ? storedColor
      : "ochre",
    avatar: storedAvatar?.slice(0, 2) || name.slice(0, 1).toUpperCase(),
  };
}

function encodeAvatar(profile: Pick<CloudProfile, "avatar" | "color">) {
  return `${profile.color}:${profile.avatar.slice(0, 2)}`;
}

function externalTitleId(mediaType: "movie" | "tv", tmdbId: number) {
  return `tmdb:${mediaType}:${tmdbId}`;
}

export function parseExternalTitleId(value: string) {
  const match = /^tmdb:(movie|tv):(\d+)$/.exec(value);
  if (!match) return null;
  const tmdbId = Number.parseInt(match[2], 10);
  return Number.isSafeInteger(tmdbId) && tmdbId > 0
    ? { mediaType: match[1] as "movie" | "tv", tmdbId }
    : null;
}

export async function loadCloudProfiles(client: Client, user: User): Promise<CloudProfile[]> {
  const { data: profileRows, error: profileError } = await client
    .from("profiles")
    .select("*")
    .eq("account_id", user.id)
    .order("created_at", { ascending: true });
  throwIfError(profileError);
  if (!profileRows?.length) return [];

  const profileIds = profileRows.map((profile) => profile.id);
  const [settingsResult, serviceLinksResult, servicesResult, ratingsResult] = await Promise.all([
    client.from("profile_settings").select("*").in("profile_id", profileIds),
    client.from("profile_streaming_services").select("*").in("profile_id", profileIds),
    client.from("streaming_services").select("id, slug").eq("active", true),
    client.from("ratings").select("*").in("profile_id", profileIds),
  ]);
  throwIfError(settingsResult.error);
  throwIfError(serviceLinksResult.error);
  throwIfError(servicesResult.error);
  throwIfError(ratingsResult.error);

  const titleIds = [...new Set((ratingsResult.data ?? []).map((rating) => rating.title_id))];
  const titlesResult = titleIds.length
    ? await client.from("titles").select("id, tmdb_id, tmdb_media_type").in("id", titleIds)
    : { data: [], error: null };
  throwIfError(titlesResult.error);

  const serviceSlugById = new Map((servicesResult.data ?? []).map((service) => [service.id, service.slug]));
  const titleExternalIdById = new Map(
    (titlesResult.data ?? []).flatMap((title) =>
      title.tmdb_id && title.tmdb_media_type
        ? [[title.id, externalTitleId(title.tmdb_media_type, title.tmdb_id)] as const]
        : [],
    ),
  );

  return profileRows.map((row) => {
    const settings = settingsResult.data?.find((item) => item.profile_id === row.id);
    const avatar = decodeAvatar(row.avatar_key, row.display_name);
    const ratings = Object.fromEntries(
      (ratingsResult.data ?? []).flatMap((rating) => {
        if (rating.profile_id !== row.id) return [];
        const externalId = titleExternalIdById.get(rating.title_id);
        return externalId ? [[externalId, rating.score]] : [];
      }),
    );
    const subscriptions = (serviceLinksResult.data ?? []).flatMap((link) => {
      if (link.profile_id !== row.id) return [];
      const slug = serviceSlugById.get(link.service_id);
      return slug ? [slug] : [];
    });

    return {
      id: row.id,
      accountId: row.account_id,
      name: row.display_name,
      avatar: avatar.avatar,
      color: avatar.color,
      guest: false,
      onboardingCompleted: row.onboarding_completed,
      region: row.region,
      subscriptions,
      ratings,
      questionnaire: {},
      rentalMode: settings?.rental_policy ?? "exceptional",
      modelVersion: 1,
      shareWithFriends: row.share_with_friends,
    };
  });
}

export async function createCloudProfile(
  client: Client,
  user: User,
  input: Pick<CloudProfile, "name" | "avatar" | "color">,
): Promise<CloudProfile> {
  const { data, error } = await client
    .from("profiles")
    .insert({
      account_id: user.id,
      display_name: input.name.trim(),
      avatar_key: `${input.color}:${input.avatar.slice(0, 2)}`,
      is_guest: false,
      onboarding_completed: false,
      region: "US",
      share_with_friends: "ratings_and_reviews",
    })
    .select("*")
    .single();
  throwIfError(error);
  if (!data) throw new Error("Supabase did not return the new profile.");

  return {
    id: data.id,
    accountId: data.account_id,
    name: data.display_name,
    avatar: input.avatar,
    color: input.color,
    guest: false,
    onboardingCompleted: data.onboarding_completed,
    region: data.region,
    subscriptions: [],
    ratings: {},
    questionnaire: {},
    rentalMode: "exceptional",
    modelVersion: 1,
    shareWithFriends: data.share_with_friends,
  };
}

export async function persistCloudProfile(client: Client, profile: CloudProfile) {
  const [profileResult, settingsResult, subscriptionsResult] = await Promise.all([
    client
      .from("profiles")
      .update({
        display_name: profile.name.trim(),
        avatar_key: encodeAvatar(profile),
        onboarding_completed: profile.onboardingCompleted,
        region: profile.region,
        share_with_friends: profile.shareWithFriends,
      })
      .eq("id", profile.id),
    client
      .from("profile_settings")
      .update({ rental_policy: profile.rentalMode })
      .eq("profile_id", profile.id),
    client.rpc("set_profile_streaming_services", {
      target_profile_id: profile.id,
      service_slugs: profile.subscriptions,
    }),
  ]);
  throwIfError(profileResult.error);
  throwIfError(settingsResult.error);
  throwIfError(subscriptionsResult.error);
}

export async function persistCloudQuestionnaire(
  client: Client,
  profileId: string,
  questionnaire: Record<string, number>,
) {
  const { error } = await client.rpc("save_profile_questionnaire", {
    target_profile_id: profileId,
    questionnaire_scores: questionnaire,
  });
  throwIfError(error);
}

export async function persistCloudRating(
  client: Client,
  profileId: string,
  externalId: string,
  score: number,
  sourceContext: "onboarding" | "search" | "recommendation" = "search",
) {
  const parsed = parseExternalTitleId(externalId);
  if (!parsed) throw new Error("Only TMDB movie and TV identities can be saved to Supabase.");
  const { error } = await client.rpc("save_profile_rating", {
    target_profile_id: profileId,
    external_tmdb_id: parsed.tmdbId,
    external_media_type: parsed.mediaType,
    rating_score: score,
    rating_source: sourceContext,
  });
  throwIfError(error);
}

export async function deleteCloudProfile(client: Client, profileId: string) {
  const { error } = await client.from("profiles").delete().eq("id", profileId);
  throwIfError(error);
}

export async function persistRecommendationFeedback(
  client: Client,
  profileId: string,
  recommendationItemId: string,
  input: { recommendationScore?: number; reason?: string },
) {
  const { error } = await client.rpc("save_recommendation_feedback", {
    target_profile_id: profileId,
    target_recommendation_item_id: recommendationItemId,
    feedback_score: input.recommendationScore ?? null,
    feedback_reason: input.reason ?? null,
  });
  throwIfError(error);
}
