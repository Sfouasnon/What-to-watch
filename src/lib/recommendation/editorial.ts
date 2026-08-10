import corrections from "../../../curation/pilot/pass2/editorial-corrections-v1.1.json";
import goldSet from "../../../curation/pilot/pass2/final-classifications-v1.0-gold.json";
import ontology from "../../../curation/ontology/v0.1.1/ontology.json";

import type { Title } from "./types";

export interface EditorialClassification {
  primarySubgenre: string;
  secondarySubgenre?: string;
  primaryFamily: string;
  secondaryFamily?: string;
  toneTags: string[];
  pacing: Title["pacing"];
  ontologyVersion: string;
}

type GoldClassification = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  primary_subgenre: { value: string | null };
  secondary_subgenre: { value: string | null };
  tone_tags: { value: string[] | null };
  pacing: { value: Title["pacing"] | null };
};

type EditorialCorrection = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  primary_subgenre: { to: string };
  secondary_subgenre: { to: string | null };
  tone_tags?: { value: string[] };
};

type OntologyFamily = {
  family_id: string;
  terms: Array<{ id: string }>;
};

type EditorialIdentity = `${"movie" | "tv"}:${number}`;

function editorialIdentity(mediaType: "movie" | "tv", tmdbId: number): EditorialIdentity {
  return `${mediaType}:${tmdbId}`;
}

const classifications = goldSet.classifications as GoldClassification[];
const byIdentity = new Map<EditorialIdentity, GoldClassification>(
  classifications.map((classification) => [
    editorialIdentity(classification.media_type, classification.tmdb_id),
    classification,
  ]),
);

const correctionByIdentity = new Map<EditorialIdentity, EditorialCorrection>(
  (corrections.corrections as EditorialCorrection[]).map((correction) => [
    editorialIdentity(correction.media_type, correction.tmdb_id),
    correction,
  ]),
);

const familyBySubgenre = new Map(
  (ontology.subgenre_families as OntologyFamily[]).flatMap((family) =>
    family.terms.map((term) => [term.id, family.family_id] as const),
  ),
);

export function editorialFamilyForSubgenre(subgenre: string): string | undefined {
  return familyBySubgenre.get(subgenre);
}

/**
 * Returns the human-adjudicated semantic classification when a live TMDB title
 * is part of the editorial gold set. Frozen v1.0 remains untouched; explicit
 * human corrections are layered on top through the versioned v1.1 correction
 * file. Unknown titles deliberately return null so live recommendations can
 * continue using provider-neutral TMDB metadata.
 */
export function editorialClassification(
  mediaType: "movie" | "tv",
  tmdbId: number,
): EditorialClassification | null {
  const identity = editorialIdentity(mediaType, tmdbId);
  const classification = byIdentity.get(identity);
  if (!classification) return null;

  const correction = correctionByIdentity.get(identity);
  const primarySubgenre = correction?.primary_subgenre.to ?? classification.primary_subgenre.value;
  if (!primarySubgenre) return null;

  const primaryFamily = editorialFamilyForSubgenre(primarySubgenre);
  if (!primaryFamily) return null;

  const secondarySubgenre = correction
    ? correction.secondary_subgenre.to ?? undefined
    : classification.secondary_subgenre.value ?? undefined;

  return {
    primarySubgenre,
    secondarySubgenre,
    primaryFamily,
    secondaryFamily: secondarySubgenre ? editorialFamilyForSubgenre(secondarySubgenre) : undefined,
    toneTags: correction?.tone_tags?.value ?? classification.tone_tags.value ?? [],
    pacing: classification.pacing.value ?? "moderate",
    ontologyVersion: goldSet.ontology_version,
  };
}
