export const GENRES = [
  "Drama", "Crime", "Thriller", "Mystery", "Action", "Adventure", "Science Fiction",
  "Fantasy", "Horror", "Romance", "Comedy", "Dark Comedy", "Satire", "Animation",
  "Documentary", "Historical", "War", "Western", "Musical", "Family", "Stand-up",
] as const;

export type OnboardingGenre = (typeof GENRES)[number];

export const GENRE_LABELS: Record<OnboardingGenre, string> = {
  Drama: "Drama",
  Crime: "Crime",
  Thriller: "Thriller",
  Mystery: "Mystery",
  Action: "Action",
  Adventure: "Adventure",
  "Science Fiction": "Science Fiction",
  Fantasy: "Fantasy",
  Horror: "Horror",
  Romance: "Romance",
  Comedy: "Comedy movies & shows",
  "Dark Comedy": "Dark Comedy",
  Satire: "Satire",
  Animation: "Animation",
  Documentary: "Documentary",
  Historical: "Historical",
  War: "War",
  Western: "Western",
  Musical: "Musical",
  Family: "Family",
  "Stand-up": "Stand-up specials",
};

export const GENRE_RATING_LABELS = [
  "Never for me",
  "Usually not",
  "Maybe",
  "It depends",
  "Usually yes",
  "I love it",
  "Always interested",
] as const;

export const ANSWER_LABELS = ["Not at all", "Not really", "It depends", "Usually", "Definitely"] as const;

export type TasteQuestion = {
  id: string;
  prompt: string;
  example: string;
};

export const CORE_QUESTIONS: readonly TasteQuestion[] = [
  {
    id: "cerebral",
    prompt: "Do you like figuring things out as you watch?",
    example: "Inception, Severance, The Game, and Chinatown all give you something to piece together.",
  },
  {
    id: "emotional",
    prompt: "Do you like stories that hit you emotionally?",
    example: "Manchester by the Sea, Aftersun, This Is Us, and The Last of Us don’t hold back emotionally.",
  },
  {
    id: "darkness",
    prompt: "Do you like darker stories where it’s hard to tell who’s right?",
    example: "The characters in Breaking Bad, The Sopranos, Sicario, and Nightcrawler rarely fit neatly into ‘good’ or ‘bad.’",
  },
  {
    id: "slowPace",
    prompt: "Do you enjoy stories that take their time?",
    example: "Better Call Saul, Perfect Days, The Power of the Dog, and There Will Be Blood are happy to take the scenic route.",
  },
  {
    id: "character",
    prompt: "Can great characters carry a simple story for you?",
    example: "Mad Men, The Bear, Lady Bird, and Lost in Translation put their characters front and center.",
  },
  {
    id: "ambiguity",
    prompt: "Are you okay when a story doesn’t explain everything?",
    example: "Think The Leftovers, Mulholland Drive, Enemy, or The Sopranos finale.",
  },
  {
    id: "discovery",
    prompt: "Do you like finding great movies or shows that fly under the radar?",
    example: "Do Coherence, The Vast of Night, Patriot, or Rectify sound like your sweet spot?",
  },
  {
    id: "classics",
    prompt: "Are you open to older movies and shows?",
    example: "Would 12 Angry Men, Casablanca, The Twilight Zone, or Columbo be welcome choices?",
  },
  {
    id: "international",
    prompt: "Are you happy watching something with subtitles?",
    example: "Parasite, Dark, Squid Game, and Pan’s Labyrinth are all part of the conversation here.",
  },
  {
    id: "tvCommitment",
    prompt: "Would you start a show knowing it has several seasons?",
    example: "Would you settle in for The Wire, The Sopranos, Game of Thrones, or Better Call Saul?",
  },
  {
    id: "binge",
    prompt: "Do you like watching several episodes in one sitting?",
    example: "Shows such as The Bear, Beef, Slow Horses, and Only Murders in the Building can make ‘one more episode’ an easy choice.",
  },
] as const;

const COMEDY_QUESTIONS: readonly TasteQuestion[] = [
  {
    id: "dryComedy",
    prompt: "Is dry, straight-faced humor your kind of funny?",
    example: "The Brits do it well with The Office (UK) and Peep Show, while Veep is a strong American contender.",
  },
  {
    id: "darkComedy",
    prompt: "Do you like comedy that finds humor in dark or uncomfortable situations?",
    example: "Colin Farrell in In Bruges is a good reference point, along with Barry, Fargo, and The Menu.",
  },
  {
    id: "broadComedy",
    prompt: "Do big, obvious jokes and high-energy comedy work for you?",
    example: "Would Happy Gilmore, The Hangover, Modern Family, or Bridesmaids sound like a good night?",
  },
] as const;

const HORROR_QUESTIONS: readonly TasteQuestion[] = [
  {
    id: "psychologicalHorror",
    prompt: "Do you like horror that gets inside your head?",
    example: "Hereditary, The Babadook, The Shining, and Midnight Mass build fear through dread and psychology.",
  },
  {
    id: "goreTolerance",
    prompt: "How okay are you with bloody or graphic scenes?",
    example: "Saw, The Substance, Evil Dead Rise, and The Boys don’t shy away from showing the damage.",
  },
] as const;

export function conditionalQuestions(
  soughtGenres: readonly string[],
  genreRatings: Readonly<Record<string, number>>,
): TasteQuestion[] {
  const activelyLikes = (genre: string) => soughtGenres.includes(genre) || (genreRatings[genre] ?? 4) >= 5;
  return [
    ...(activelyLikes("Comedy") || activelyLikes("Dark Comedy") || activelyLikes("Satire") ? COMEDY_QUESTIONS : []),
    ...(activelyLikes("Horror") ? HORROR_QUESTIONS : []),
  ];
}

export type CalibrationTitle = {
  id: string;
  name: string;
  genres: string[];
  tags: string[];
  popularity: number;
  baseline: number;
};

const normalize = (value: string) => value.toLowerCase().replaceAll("-", " ").trim();
const calibrationTerms = (title: CalibrationTitle) => {
  const terms = [...title.genres, ...title.tags].map(normalize);
  if (terms.includes("history")) terms.push("historical");
  return terms;
};

const CALIBRATION_AXES: Record<string, string[]> = {
  dryComedy: ["dry comedy", "deadpan", "wry", "understated"],
  darkComedy: ["dark comedy", "black comedy", "awkward comedy", "absurdist comedy", "cynical"],
  broadComedy: ["broad comedy", "slapstick", "buddy comedy", "visual comedy", "parody spoof", "raunchy"],
  psychologicalHorror: ["psychological horror", "dread", "unsettling", "slow burn"],
  goreTolerance: ["gore", "graphic", "body horror", "visceral", "slasher"],
  cerebral: ["cerebral", "mystery", "nonlinear", "investigative"],
  emotional: ["emotional", "heartfelt", "bittersweet", "tragic"],
  character: ["character study", "character driven", "ensemble"],
  ambiguity: ["ambiguous", "surreal", "nonlinear"],
  slowPace: ["slow", "slow burn", "meditative"],
};

export function calibrationAxes(title: CalibrationTitle): string[] {
  const terms = calibrationTerms(title);
  return Object.entries(CALIBRATION_AXES)
    .filter(([, matches]) => matches.some((match) => terms.includes(match)))
    .map(([axis]) => axis);
}

export function selectCalibrationTitle(
  titles: readonly CalibrationTitle[],
  options: {
    targetGenres: readonly string[];
    excludedIds: ReadonlySet<string>;
    askedTitles?: readonly CalibrationTitle[];
  },
): CalibrationTitle | undefined {
  const targets = options.targetGenres.map(normalize);
  const asked = options.askedTitles ?? [];
  const seenAxes = new Set(asked.flatMap(calibrationAxes));
  const askedGenreCounts = new Map<string, number>();
  for (const title of asked) {
    for (const genre of calibrationTerms(title)) {
      askedGenreCounts.set(genre, (askedGenreCounts.get(genre) ?? 0) + 1);
    }
  }

  return titles
    .filter((title) => !options.excludedIds.has(title.id))
    .map((title, index) => {
      const terms = calibrationTerms(title);
      const matchedTargets = targets.filter((genre) => terms.includes(genre));
      const leastSampledTarget = matchedTargets.length
        ? Math.min(...matchedTargets.map((genre) => askedGenreCounts.get(genre) ?? 0))
        : 0;
      const newAxes = calibrationAxes(title).filter((axis) => !seenAxes.has(axis)).length;
      const targetScore = targets.length ? matchedTargets.length * 42 - leastSampledTarget * 20 : 12;
      const score = targetScore + newAxes * 22 + title.popularity * 0.2 + title.baseline * 0.14 - index * 0.0001;
      return { title, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.title;
}

type SummarySignal = {
  key: string;
  score: number;
  headline?: string;
  high: string;
  low?: string;
  tag: string;
  lowTag?: string;
};

const SUMMARY_SIGNALS: readonly Omit<SummarySignal, "score">[] = [
  { key: "cerebral", headline: "You like a good puzzle.", high: "stories that give you something to figure out", low: "stories that are easy to follow", tag: "Puzzle-friendly" },
  { key: "emotional", headline: "You want stories that make you feel.", high: "stories with real emotional weight", low: "a lighter emotional touch", tag: "Emotional stories" },
  { key: "darkness", headline: "You don’t mind going dark.", high: "morally complicated characters", low: "clearer lines between right and wrong", tag: "Morally complicated" },
  { key: "slowPace", headline: "You’re happy to take your time.", high: "patient storytelling", low: "stories that get moving quickly", tag: "Patient storytelling" },
  { key: "character", headline: "Characters come first.", high: "character-first stories", tag: "Character-first" },
  { key: "ambiguity", headline: "You don’t need every answer.", high: "stories that leave room for interpretation", low: "stories that tie up their loose ends", tag: "Comfortable with ambiguity" },
  { key: "discovery", headline: "You like finding hidden gems.", high: "under-the-radar finds", tag: "Under-the-radar finds" },
  { key: "classics", headline: "Older titles are in play.", high: "great work from earlier eras", tag: "Open to classics" },
  { key: "international", headline: "Subtitles are welcome.", high: "stories from around the world", tag: "Subtitles welcome" },
  { key: "tvCommitment", headline: "You’re ready for the long haul.", high: "series that reward a longer commitment", tag: "Long-series ready" },
  { key: "binge", headline: "One more episode sounds good.", high: "shows built for one-more-episode nights", tag: "Binge-friendly" },
  { key: "dryComedy", headline: "Dry wit wins.", high: "dry, understated comedy", tag: "Dry comedy" },
  { key: "darkComedy", headline: "You find the funny in dark places.", high: "comedy with a darker edge", tag: "Dark comedy" },
  { key: "broadComedy", headline: "Big laughs are welcome.", high: "broad, high-energy comedy", tag: "Broad comedy" },
  { key: "psychologicalHorror", headline: "You like horror that lingers.", high: "psychological horror that builds dread", tag: "Psychological horror" },
  { key: "goreTolerance", headline: "Graphic horror is fair game.", high: "horror that doesn’t look away", low: "horror that keeps the gore restrained", tag: "Gore-friendly", lowTag: "Low-gore horror" },
] as const;

export type StartingTasteSummary = { headline: string; description: string; tags: string[] };

function readableList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "a mix of stories";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function buildStartingTasteSummary(
  scores: Readonly<Record<string, number>>,
  genreRatings: Readonly<Record<string, number>>,
): StartingTasteSummary {
  const ranked: SummarySignal[] = SUMMARY_SIGNALS
    .filter((signal) => scores[signal.key] !== undefined)
    .map((signal) => ({ ...signal, score: scores[signal.key] }))
    .sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  const positives = ranked.filter((signal) => signal.score >= 70).slice(0, 3);
  const negative = ranked.find((signal) => signal.score <= 30 && signal.low);
  const genreTags = GENRES
    .filter((genre) => (genreRatings[genre] ?? 4) >= 6)
    .slice(0, 2)
    .map((genre) => genre === "Stand-up" ? "Stand-up fan" : GENRE_LABELS[genre]);
  const genrePulls = GENRES
    .filter((genre) => (genreRatings[genre] ?? 4) >= 6)
    .slice(0, 2)
    .map((genre) => GENRE_LABELS[genre]);
  const standUpPreferred = (genreRatings["Stand-up"] ?? 4) >= 6;
  const parts = positives.map((signal) => signal.high);
  if (negative?.low) parts.push(negative.low);
  const description = parts.length
    ? `Your starting profile points toward ${readableList(parts)}.${genrePulls.length ? ` Your strongest genre pulls are ${readableList(genrePulls)}.` : ""}`
    : genrePulls.length
      ? `Your strongest starting genre pulls are ${readableList(genrePulls)}. Your ratings will make this profile more specific.`
      : "Your answers leave room for a wide range of stories. Your ratings will make this profile more specific.";
  const tags = [
    ...positives.map((signal) => signal.tag),
    ...(negative?.lowTag ? [negative.lowTag] : []),
    ...genreTags,
  ].filter((tag, index, all) => all.indexOf(tag) === index).slice(0, 5);
  return {
    headline: positives[0]?.headline ?? (standUpPreferred ? "Stand-up gets its own night." : "Here’s where your taste starts."),
    description,
    tags,
  };
}
