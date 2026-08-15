import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://editorial.rottentomatoes.com/guide/best-movies-of-all-time/";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.join(repoRoot, "curation/reference/rotten-tomatoes-top-300.json");

function decodeHtml(value) {
  const named = { amp: "&", apos: "'", quot: '"', nbsp: " ", ndash: "–", mdash: "—" };
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLocaleLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const moviesByRank = new Map();
for (let attempt = 0; attempt < 3 && moviesByRank.size < 300; attempt += 1) {
  const requestUrl = new URL(SOURCE_URL);
  requestUrl.searchParams.set("wtw_refresh", `${Date.now()}-${attempt}`);
  const response = await fetch(requestUrl, { headers: { "user-agent": "What to Watch catalog maintenance/1.0" } });
  if (!response.ok) throw new Error(`Rotten Tomatoes returned ${response.status}.`);
  const html = await response.text();
  const parsed = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap((rowMatch) => {
    const row = rowMatch[1];
    const rank = row.match(/<td[^>]*>\s*(\d{1,3})\.\s*<\/td>/)?.[1];
    const title = row.match(/<a class="meta-title" href="([^"]+)">([\s\S]*?)<\/a>/);
    const year = row.match(/<span class="meta-year">\((\d{4})\)<\/span>/)?.[1];
    if (!rank || !title || !year) return [];
    return [{ rank: Number(rank), title: decodeHtml(title[2]), year: Number(year), rotten_tomatoes_url: title[1] }];
  });
  for (const movie of parsed) moviesByRank.set(movie.rank, movie);
}
// The current page leaves rank 162 as an empty promotional placeholder in its
// raw HTML even though the rendered list names the title. Keep the repair
// explicit so any other missing rank still fails closed.
if (!moviesByRank.has(162)) moviesByRank.set(162, {
  rank: 162,
  title: "Mission: Impossible - Dead Reckoning Part One",
  year: 2023,
  rotten_tomatoes_url: "https://www.rottentomatoes.com/m/mission_impossible_dead_reckoning_part_one",
});
const movies = [...moviesByRank.values()].sort((a, b) => a.rank - b.rank);

if (movies.length !== 300 || new Set(movies.map((movie) => movie.rank)).size !== 300) {
  throw new Error(`Expected 300 uniquely ranked movies; parsed ${movies.length}.`);
}

await writeFile(outputPath, `${JSON.stringify({
  schema_version: "external-canon-list-v1",
  source_name: "Rotten Tomatoes 300 Best Movies of All Time",
  source_url: SOURCE_URL,
  retrieved_at: new Date().toISOString(),
  title_count: movies.length,
  movies,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputPath, titleCount: movies.length }, null, 2));
