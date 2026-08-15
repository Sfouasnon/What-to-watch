import type {
  CastContextPerson,
  Mood,
  Profile,
  RecommendationLane,
  RecommendationNarrative,
  Title,
  Vibe,
} from "./types";

const normalize = (value: string) => value.toLocaleLowerCase().replaceAll("-", " ").trim();
const hasAny = (terms: readonly string[], matches: readonly string[]) => matches.some((match) => terms.includes(match));

const TONE_PRIORITY = ["playful", "dry", "wry", "warm", "tense", "cerebral", "dark", "visceral", "absurdist", "raunchy"];
const TRAIT_EXCLUSIONS = new Set(["fast", "slow", "moderate", "bingeable", "international"]);

function articleFor(phrase: string) {
  return /^[aeiou]/i.test(phrase) ? "an" : "a";
}

function titleCharacter(title: Title) {
  const subgenres = title.subgenres.map(normalize).filter((value) => !TRAIT_EXCLUSIONS.has(value));
  const tones = title.toneTags.map(normalize);
  const base = subgenres[0] ?? normalize(title.genres[0] ?? title.contentType);
  const tone = TONE_PRIORITY.find((value) => tones.includes(value) && !base.includes(value));
  const pace = title.pacing === "moderate" ? undefined : title.pacing;
  const adjectives = [pace, tone].filter((value): value is string => Boolean(value));
  const phrase = [...adjectives, base].join(", ").replace(", " + base, ` ${base}`);
  const edge = tones.includes("raunchy") && tone !== "raunchy"
    ? " with a raunchier edge"
    : tones.includes("dark") && tone !== "dark"
      ? " with a darker edge"
      : tones.includes("visceral") && tone !== "visceral"
        ? " with a visceral edge"
        : "";
  return `${articleFor(phrase)} ${phrase}${edge}`;
}

function personalPreference(title: Title, profile: Profile): string | undefined {
  const scores = profile.questionnaire?.dimensionScores ?? {};
  const terms = [...title.genres, ...title.subgenres, ...title.toneTags].map(normalize);
  const strong = (key: keyof typeof scores) => (scores[key] ?? 0) >= 65;
  const low = (key: keyof typeof scores) => (scores[key] ?? 100) <= 35;
  const scripted = title.contentType !== "stand-up";
  const candidates: Array<[boolean, string]> = [
    [strong("broadComedy") && scripted && hasAny(terms, ["broad comedy", "slapstick", "buddy comedy", "visual comedy", "raunchy"]), "your preference for big, high-energy humor"],
    [strong("dryComedy") && scripted && hasAny(terms, ["dry comedy", "deadpan", "wry"]), "your taste for dry, straight-faced humor"],
    [strong("darkComedy") && scripted && hasAny(terms, ["dark comedy", "black comedy", "absurdist comedy", "cynical"]), "your taste for comedy with a darker edge"],
    [strong("psychologicalHorror") && hasAny(terms, ["psychological horror", "dread", "unsettling"]), "your preference for horror that builds psychological dread"],
    [low("goreTolerance") && title.genres.map(normalize).includes("horror") && !hasAny(terms, ["gore", "body horror", "visceral", "slasher"]), "your preference for horror that keeps the gore restrained"],
    [strong("cerebral") && hasAny(terms, ["cerebral", "mystery", "nonlinear", "investigative"]), "your appetite for stories that give you something to unravel"],
    [strong("emotionalIntensity") && hasAny(terms, ["emotional", "heartfelt", "bittersweet", "tragic"]), "your openness to stories with emotional weight"],
    [strong("slowPacing") && title.pacing === "slow", "your patience for stories that take their time"],
    [strong("characterOrientation") && hasAny(terms, ["character study", "character driven", "ensemble"]), "your preference for character-first storytelling"],
  ];
  const matchedDimension = candidates.find(([matches]) => matches)?.[1];
  if (matchedDimension) return matchedDimension;

  const genreScores = profile.questionnaire?.genreScores ?? {};
  const matchedGenre = title.genres.find((genre) => (genreScores[genre] ?? 4) >= 5.5);
  return matchedGenre ? `your strong interest in ${normalize(matchedGenre)}` : undefined;
}

function moodLabel(mood: Mood) {
  return mood === "stand-up" ? "stand-up" : mood;
}

function headerFor(lane: RecommendationLane, moods: readonly Mood[]) {
  const mood = moods[0] ? moodLabel(moods[0]) : undefined;
  if (lane === "Best Bet") return mood
    ? `Your strongest match for the ${mood} you asked for tonight.`
    : "The strongest blend of your profile, ratings, and tonight’s choices.";
  const headers: Record<RecommendationLane, string> = {
    "Best Bet": "The strongest match for your taste tonight.",
    "Close Second": mood ? `Another strong ${mood} fit, with a different texture.` : "Nearly the same fit, with a different texture.",
    "Right Mood": mood ? `A direct expression of the ${mood} mood you chose.` : "A direct expression of tonight’s mood.",
    "Creator Match": "A creator connection surfaced by your ratings and favorites.",
    "Something Different": "A measured step beyond your usual pattern.",
    "Hidden Gem": "Strong personal fit without the obvious popularity.",
    "Go Deeper": "A way to follow one of your strongest taste threads.",
    "Film School Pick": "A canonical choice filtered through your own preferences.",
    "Left Field": "A deliberate stretch with a real connection to your taste.",
    "Wild Card": "The most adventurous match that still clears your filters.",
  };
  return headers[lane];
}

function personalHistoryEvidence(evidence: readonly string[]) {
  return evidence.find((fact) => fact.includes("titles you rated average"))
    ?? evidence.find((fact) => fact.includes("saved favorite"))
    ?? evidence.find((fact) => fact.includes("shares concrete genre"));
}

function bestReference(person: CastContextPerson, ratings: ReadonlyMap<string, number>) {
  const eligible = person.references.filter((reference) => (ratings.get(reference.externalId) ?? 10) > 4);
  const rated = eligible.filter((reference) => ratings.has(reference.externalId)).sort((a, b) => {
    const ratingDifference = (ratings.get(b.externalId) ?? 0) - (ratings.get(a.externalId) ?? 0);
    return ratingDifference || b.voteCount - a.voteCount || b.popularity - a.popularity;
  });
  return rated[0] ?? eligible[0];
}

export function castReferenceSentence(title: Title, profile: Profile): string | undefined {
  const ratings = new Map(profile.ratings.map((rating) => [rating.titleId, rating.score]));
  const people = [...(title.castContext ?? [])]
    .sort((a, b) => a.billingOrder - b.billingOrder)
    .map((person) => ({ person, reference: bestReference(person, ratings) }))
    .filter((entry) => entry.reference);
  const ratedConnection = people
    .map((entry) => ({ ...entry, rating: ratings.get(entry.reference!.externalId) }))
    .filter((entry): entry is typeof entry & { rating: number } => entry.rating !== undefined && entry.rating >= 7)
    .sort((a, b) => b.rating - a.rating)[0];
  if (ratedConnection) {
    return `You rated ${ratedConnection.reference!.name} ${ratedConnection.rating}/10, and ${ratedConnection.person.name} appears here too.`;
  }
  const [lead, supporting] = people;
  if (!lead?.reference) return undefined;
  const leadClause = `${lead.person.name}${lead.person.billingOrder === 0 ? " leads the cast" : " is in the principal cast"} and also appears in ${lead.reference.name}`;
  return supporting?.reference
    ? `${leadClause}; ${supporting.person.name} also appears in ${supporting.reference.name}.`
    : `${leadClause}.`;
}

export function buildRecommendationNarrative({
  title,
  profile,
  moods,
  lane,
  evidence = [],
}: {
  title: Title;
  profile: Profile;
  moods: readonly Mood[];
  vibes: readonly Vibe[];
  lane: RecommendationLane;
  evidence?: readonly string[];
}): RecommendationNarrative {
  const character = titleCharacter(title);
  const preference = personalPreference(title, profile);
  const mood = moods[0] ? moodLabel(moods[0]) : undefined;
  const opening = mood
    ? `You asked for ${mood}, and ${title.name} ${lane === "Best Bet" ? "rises to the top" : "earns this spot"} as ${character}.`
    : `${title.name} earns this spot as ${character}.`;
  const preferenceSentence = preference ? `That combination lines up with ${preference}.` : undefined;
  const historySentence = personalHistoryEvidence(evidence);
  const fit = [opening, preferenceSentence, historySentence].filter(Boolean).join(" ");
  return {
    header: headerFor(lane, moods),
    heading: `Why this is your ${lane}`,
    fit,
    cast: castReferenceSentence(title, profile),
    setup: title.synopsis,
  };
}
