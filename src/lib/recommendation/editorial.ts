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

type OntologyFamily = {
  family_id: string;
  terms: Array<{ id: string }>;
};

const classifications = goldSet.classifications as GoldClassification[];
const byIdentity = new Map(
  classifications.map((classification) => [
    `${classification.media_type}:${classification.tmdb_id}`,
    classification,
  ] as const),
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
 * is part of the editorial gold set. Unknown titles deliberately return null so
 * live recommendations can continue using provider-neutral TMDB metadata.
 */
export function editorialClassification(
  mediaType: "movie" | "tv",
  tmdbId: number,
): EditorialClassification | null {
  const classification = byIdentity.get(`${mediaType}:${tmdbId}`);
  const primarySubgenre = classification?.primary_subgenre.value;
  if (!classification || !primarySubgenre) return null;

  const primaryFamily = editorialFamilyForSubgenre(primarySubgenre);
  if (!primaryFamily) return null;
  const secondarySubgenre = classification.secondary_subgenre.value ?? undefined;

  return {
    primarySubgenre,
    secondarySubgenre,
    primaryFamily,
    secondaryFamily: secondarySubgenre ? editorialFamilyForSubgenre(secondarySubgenre) : undefined,
    toneTags: classification.tone_tags.value ?? [],
    pacing: classification.pacing.value ?? "moderate",
    ontologyVersion: goldSet.ontology_version,
  };
}
