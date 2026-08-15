import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputPath = path.join(
  repositoryRoot,
  "curation/classification-experiments/2026-08-15/stand-up-audit-1000/stand-up-candidates.json",
);
const sourceUrl = "https://what-to-watch-flax-xi.vercel.app/api/catalog/recommendation-titles";

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Catalog request failed with ${response.status}.`);
const payload = await response.json();
if (!Array.isArray(payload.titles) || payload.titleCount !== 1_000 || payload.titles.length !== 1_000) {
  throw new Error(`Expected the deployed 1,000-title deck; received ${payload.titles?.length ?? 0}.`);
}

const ontology = JSON.parse(await readFile(
  path.join(repositoryRoot, "curation/ontology/v0.1.1/ontology.json"),
  "utf8",
));
const explicitStandupPattern = /\bstand[ -]?up\b|\bcomedy special\b|\bcomic special\b|\bcomedian(?:s)? perform(?:s|ing|ed)?\b|\blive comedy\b|\bone[- ](?:man|woman|person) show\b/i;

const candidates = payload.titles.flatMap((title) => {
  const searchable = [title.name, title.synopsis, title.primarySubgenre, title.secondarySubgenre, ...title.tags].filter(Boolean).join(" ");
  const comedyGenre = title.genres.some((genre) => genre.toLocaleLowerCase() === "comedy");
  const explicitMetadataSignal = explicitStandupPattern.test(searchable);
  const alreadyStandup = title.kind === "Stand-up";
  if (!comedyGenre && !explicitMetadataSignal && !alreadyStandup) return [];

  const [, mediaType, tmdbId] = title.id.split(":");
  return [{
    title_id: title.id,
    tmdb_id: Number(tmdbId),
    media_type: mediaType,
    title: title.name,
    year: title.year,
    current_kind: title.kind,
    overview: title.synopsis,
    tmdb_genres: title.genres,
    current_primary_subgenre: title.primarySubgenre,
    current_secondary_subgenre: title.secondarySubgenre ?? null,
    current_tone_tags: title.toneTags,
    current_pacing: title.pacing,
    candidate_signals: [
      ...(alreadyStandup ? ["already-classified-standup"] : []),
      ...(comedyGenre ? ["tmdb-comedy-genre"] : []),
      ...(explicitMetadataSignal ? ["standup-language-in-metadata"] : []),
    ],
  }];
});

const output = {
  schema_version: "standup-candidate-audit-v1",
  generated_at: new Date().toISOString(),
  source: sourceUrl,
  source_title_count: payload.titles.length,
  candidate_count: candidates.length,
  selection_policy: {
    purpose: "Conservative superset for identifying recorded stand-up comedy specials in the deployed 1,000-title deck.",
    included_if: [
      "TMDB genre includes Comedy",
      "title metadata contains an explicit stand-up/performance phrase",
      "application kind is already Stand-up",
    ],
    warning: "Comedy genre membership is not evidence that a title is stand-up. Most candidates should be rejected.",
  },
  standup_definition: "A nonfiction recorded performance whose primary content is one or more comedians delivering stand-up material to an audience. Narrative films, sitcoms, sketch shows, talk shows, improv, roasts, documentaries about comedians, and stories whose characters happen to be comedians are not stand-up specials.",
  allowed_tone_tags: ontology.tone_tags.map((tag) => tag.id),
  candidates,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, sourceTitleCount: payload.titles.length, candidateCount: candidates.length }, null, 2));
