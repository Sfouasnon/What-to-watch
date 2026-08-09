import goldSet from "../../../curation/pilot/pass2/final-classifications-v1.0-gold.json";

import type { Title } from "./types";

export interface EditorialClassification {
  primarySubgenre: string;
  secondarySubgenre?: string;
  toneTags: string[];
  pacing: Title["pacing"];
}

type GoldClassification = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  primary_subgenre: { value: string | null };
  secondary_subgenre: { value: string | null };
  tone_tags: { value: string[] | null };
  pacing: { value: Title["pacing"] | null };
};

const classifications = (goldSet.classifications as GoldClassification[]);
const byIdentity = new Map(
  classifications.map((classification) => [
    `${classification.media_type}:${classification.tmdb_id}`,
    classification,
  ] as const),
);

/**
 * Returns the human-adjudicated semantic classification when a live TMDB title
 * is part of the editorial gold set. Unknown titles deliberately return null so
 * live recommendations can continue using provider-neutral TMDB metadata.
 */
export function editorialClassification(
  mediaType: "movie" | "tv",
  tmdbId: number,
): EditorialClassification | null {
  const classification = byIdentity.get(`${mediaType}:${tmdbId}`);
  if (!classification || !classification.primary_subgenre.value) return null;

  return {
    primarySubgenre: classification.primary_subgenre.value,
    secondarySubgenre: classification.secondary_subgenre.value ?? undefined,
    toneTags: classification.tone_tags.value ?? [],
    pacing: classification.pacing.value ?? "moderate",
  };
}
