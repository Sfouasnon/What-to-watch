import correctionsJson from "../../../curation/pilot/pass2/editorial-corrections-v1.1.json";
import goldJson from "../../../curation/pilot/pass2/final-classifications-v1.0-gold.json";

export type EditorialMediaType = "movie" | "tv";
export type EditorialPacing = "slow" | "moderate" | "fast";

export type GoldEditorialClassification = {
  tmdbId: number;
  mediaType: EditorialMediaType;
  title: string;
  primarySubgenre: string;
  secondarySubgenre?: string;
  toneTags: string[];
  pacing?: EditorialPacing;
  ontologyVersion: string;
  source: string;
};

type GoldField<T> = {
  value: T | null;
  source: string;
  human_review_pending: boolean;
};

type GoldRecord = {
  tmdb_id: number;
  media_type: EditorialMediaType;
  title: string;
  primary_subgenre: GoldField<string>;
  secondary_subgenre: GoldField<string>;
  tone_tags: GoldField<string[]>;
  pacing: GoldField<EditorialPacing>;
};

type GoldSet = {
  ontology_version: string;
  generated_at: string;
  title_count: number;
  pending_human_review_field_count: number;
  classifications: GoldRecord[];
};

type Correction = {
  tmdb_id: number;
  media_type: EditorialMediaType;
  title: string;
  primary_subgenre: { from: string; to: string };
  secondary_subgenre: { from: string | null; to: string | null };
  tone_tags?: { value: string[] };
  source: string;
};

type CorrectionSet = {
  revision: string;
  ontology_version: string;
  corrections: Correction[];
};

const gold = goldJson as GoldSet;
const corrections = correctionsJson as CorrectionSet;
const key = (mediaType: EditorialMediaType, tmdbId: number) => `${mediaType}:${tmdbId}`;
const correctionByIdentity = new Map(
  corrections.corrections.map((correction) => [key(correction.media_type, correction.tmdb_id), correction]),
);
const goldByIdentity = new Map(gold.classifications.map((classification) => [
  key(classification.media_type, classification.tmdb_id),
  classification,
]));

export const GOLD_SET_SIZE = gold.title_count;
export const GOLD_ONTOLOGY_VERSION = gold.ontology_version;

export function goldEditorialClassification(
  mediaType: EditorialMediaType,
  tmdbId: number,
): GoldEditorialClassification | null {
  const record = goldByIdentity.get(key(mediaType, tmdbId));
  if (!record?.primary_subgenre.value) return null;

  const correction = correctionByIdentity.get(key(mediaType, tmdbId));
  return {
    tmdbId,
    mediaType,
    title: record.title,
    primarySubgenre: correction?.primary_subgenre.to ?? record.primary_subgenre.value,
    secondarySubgenre: correction
      ? correction.secondary_subgenre.to ?? undefined
      : record.secondary_subgenre.value ?? undefined,
    toneTags: correction?.tone_tags?.value ?? record.tone_tags.value ?? [],
    pacing: record.pacing.value ?? undefined,
    ontologyVersion: gold.ontology_version,
    source: correction?.source ?? "gold-v1.0",
  };
}

export function allGoldEditorialClassifications(): GoldEditorialClassification[] {
  return gold.classifications
    .map((record) => goldEditorialClassification(record.media_type, record.tmdb_id))
    .filter((record): record is GoldEditorialClassification => record !== null);
}
