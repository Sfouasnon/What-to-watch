import type {
  AvailabilityKind,
  AvailabilityOption,
  Profile,
  QuestionnaireQuestion,
  SocialRecommendationInput,
  StreamingService,
  Title,
} from "./types";

export const streamingServices: StreamingService[] = [
  { id: "netflix", name: "Netflix", shortName: "N", kind: "subscription", color: "#e50914" },
  { id: "hulu", name: "Hulu", shortName: "HU", kind: "subscription", color: "#1ce783" },
  { id: "disney", name: "Disney+", shortName: "D+", kind: "subscription", color: "#113ccf" },
  { id: "apple-tv", name: "Apple TV+", shortName: "A+", kind: "subscription", color: "#111111" },
  { id: "prime", name: "Amazon Prime Video", shortName: "PV", kind: "subscription", color: "#00a8e1" },
  { id: "max", name: "Max", shortName: "M", kind: "subscription", color: "#192de9" },
  { id: "peacock", name: "Peacock", shortName: "P", kind: "subscription", color: "#111111" },
  { id: "paramount", name: "Paramount+", shortName: "P+", kind: "subscription", color: "#0064ff" },
  { id: "criterion-channel", name: "Criterion Channel", shortName: "CC", kind: "subscription", color: "#101010" },
  { id: "tubi", name: "Tubi", shortName: "TU", kind: "free", color: "#fa551e" },
  { id: "amazon-store", name: "Amazon", shortName: "AZ", kind: "marketplace", color: "#ff9900" },
  { id: "apple-store", name: "Apple TV Store", shortName: "AT", kind: "marketplace", color: "#555555" },
];

const checkedAt = "2026-08-08T12:00:00.000Z";

function on(
  serviceId: string,
  kind: AvailabilityKind = "subscription",
  region = "US",
  price?: number,
): AvailabilityOption {
  return { serviceId, kind, region, checkedAt, source: "demo", price, currency: price === undefined ? undefined : "USD" };
}

type DemoTitle = Pick<Title, "id" | "name" | "year" | "contentType" | "genres" | "directors" | "availability"> &
  Partial<Omit<Title, "id" | "name" | "year" | "contentType" | "genres" | "directors" | "availability">>;

function makeTitle(input: DemoTitle): Title {
  return {
    synopsis: `${input.name} is included as normalized demonstration metadata for the explainable recommendation model.`,
    runtimeMinutes: input.contentType === "series" ? undefined : 118,
    episodeRuntimeMinutes: input.contentType === "series" ? 48 : undefined,
    seasons: input.contentType === "series" ? 2 : undefined,
    completed: input.contentType === "series" ? false : undefined,
    serialized: input.contentType === "series" ? true : undefined,
    subgenres: [],
    toneTags: [],
    themes: [],
    pacing: "moderate",
    countries: ["US"],
    languages: ["en"],
    writers: [],
    cinematographers: [],
    actors: [],
    canonicalScore: 30,
    canonicalMemberships: [],
    criterionCollection: false,
    popularity: 60,
    trendingScore: 25,
    ...input,
  };
}

export const demoCatalog: Title[] = [
  makeTitle({ id: "zodiac", name: "Zodiac", year: 2007, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Mystery"], toneTags: ["dark", "cerebral", "slow-burn"], themes: ["obsession", "investigation"], pacing: "slow", directors: ["David Fincher"], writers: ["James Vanderbilt"], cinematographers: ["Harris Savides"], actors: ["Jake Gyllenhaal", "Mark Ruffalo"], canonicalScore: 72, popularity: 78, availability: [on("netflix"), on("apple-store", "rental", "US", 3.99)] }),
  makeTitle({ id: "gone-girl", name: "Gone Girl", year: 2014, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Mystery"], toneTags: ["dark", "satirical"], themes: ["marriage", "deception"], directors: ["David Fincher"], writers: ["Gillian Flynn"], cinematographers: ["Jeff Cronenweth"], actors: ["Rosamund Pike", "Ben Affleck"], canonicalScore: 58, popularity: 86, availability: [on("max")] }),
  makeTitle({ id: "the-game", name: "The Game", year: 1997, contentType: "movie", genres: ["Thriller"], subgenres: ["Mystery"], toneTags: ["cerebral", "twisty"], themes: ["identity"], pacing: "fast", directors: ["David Fincher"], writers: ["John Brancato", "Michael Ferris"], cinematographers: ["Harris Savides"], actors: ["Michael Douglas"], canonicalScore: 44, popularity: 62, availability: [on("criterion-channel"), on("amazon-store", "rental", "US", 3.99)] }),
  makeTitle({ id: "panic-room", name: "Panic Room", year: 2002, contentType: "movie", genres: ["Thriller"], subgenres: ["Home Invasion"], toneTags: ["tense"], themes: ["survival"], pacing: "fast", directors: ["David Fincher"], writers: ["David Koepp"], cinematographers: ["Conrad W. Hall"], actors: ["Jodie Foster"], canonicalScore: 34, popularity: 58, availability: [on("netflix")] }),
  makeTitle({ id: "prisoners", name: "Prisoners", year: 2013, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Mystery"], toneTags: ["dark", "slow-burn"], themes: ["morality", "investigation"], pacing: "slow", directors: ["Denis Villeneuve"], writers: ["Aaron Guzikowski"], cinematographers: ["Roger Deakins"], actors: ["Jake Gyllenhaal", "Hugh Jackman"], canonicalScore: 61, popularity: 84, availability: [on("netflix")] }),
  makeTitle({ id: "arrival", name: "Arrival", year: 2016, contentType: "movie", genres: ["Drama", "Science Fiction"], subgenres: ["First Contact"], toneTags: ["cerebral", "emotional", "nonlinear"], themes: ["language", "grief"], pacing: "slow", directors: ["Denis Villeneuve"], writers: ["Eric Heisserer"], cinematographers: ["Bradford Young"], actors: ["Amy Adams"], canonicalScore: 76, popularity: 88, availability: [on("paramount")] }),
  makeTitle({ id: "blade-runner-2049", name: "Blade Runner 2049", year: 2017, contentType: "movie", genres: ["Drama", "Science Fiction"], subgenres: ["Neo-noir"], toneTags: ["cerebral", "melancholy"], themes: ["identity", "memory"], pacing: "slow", directors: ["Denis Villeneuve"], writers: ["Hampton Fancher", "Michael Green"], cinematographers: ["Roger Deakins"], actors: ["Ryan Gosling"], canonicalScore: 79, popularity: 87, availability: [on("max")] }),
  makeTitle({ id: "sicario", name: "Sicario", year: 2015, contentType: "movie", genres: ["Thriller", "Action"], subgenres: ["Crime"], toneTags: ["dark", "tense"], themes: ["morality"], pacing: "moderate", directors: ["Denis Villeneuve"], writers: ["Taylor Sheridan"], cinematographers: ["Roger Deakins"], actors: ["Emily Blunt"], canonicalScore: 63, popularity: 76, availability: [on("prime")] }),
  makeTitle({ id: "the-conversation", name: "The Conversation", year: 1974, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Paranoia"], toneTags: ["cerebral", "slow-burn"], themes: ["surveillance", "guilt"], pacing: "slow", directors: ["Francis Ford Coppola"], writers: ["Francis Ford Coppola"], cinematographers: ["Bill Butler"], actors: ["Gene Hackman"], canonicalScore: 91, canonicalMemberships: [{ list: "Sight & Sound aggregation", source: "Demo editorial data", version: "2022", position: 72 }], criterionCollection: true, criterionEdition: "Spine #115", popularity: 48, availability: [on("criterion-channel"), on("apple-store", "rental", "US", 3.99)] }),
  makeTitle({ id: "thief", name: "Thief", year: 1981, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Neo-noir"], toneTags: ["atmospheric", "precise"], themes: ["professionalism", "freedom"], directors: ["Michael Mann"], writers: ["Michael Mann"], cinematographers: ["Donald E. Thorin"], actors: ["James Caan"], canonicalScore: 78, criterionCollection: true, popularity: 43, availability: [on("criterion-channel")] }),
  makeTitle({ id: "heat", name: "Heat", year: 1995, contentType: "movie", genres: ["Thriller", "Action", "Drama"], subgenres: ["Crime"], toneTags: ["intense", "procedural"], themes: ["professionalism", "obsession"], pacing: "moderate", directors: ["Michael Mann"], writers: ["Michael Mann"], cinematographers: ["Dante Spinotti"], actors: ["Al Pacino", "Robert De Niro"], canonicalScore: 88, popularity: 90, availability: [on("hulu")] }),
  makeTitle({ id: "collateral", name: "Collateral", year: 2004, contentType: "movie", genres: ["Thriller", "Action"], subgenres: ["Crime", "Neo-noir"], toneTags: ["tense", "nocturnal"], themes: ["chance", "professionalism"], pacing: "fast", directors: ["Michael Mann"], writers: ["Stuart Beattie"], cinematographers: ["Dion Beebe"], actors: ["Tom Cruise", "Jamie Foxx"], canonicalScore: 67, popularity: 74, availability: [on("netflix")] }),
  makeTitle({ id: "memories-of-murder", name: "Memories of Murder", year: 2003, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Mystery"], toneTags: ["dark", "satirical", "slow-burn"], themes: ["investigation", "institutional failure"], directors: ["Bong Joon Ho"], writers: ["Bong Joon Ho", "Shim Sung-bo"], cinematographers: ["Kim Hyung-ku"], actors: ["Song Kang-ho"], countries: ["KR"], languages: ["ko"], canonicalScore: 89, criterionCollection: true, popularity: 72, availability: [on("criterion-channel")] }),
  makeTitle({ id: "decision-to-leave", name: "Decision to Leave", year: 2022, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Mystery", "Romance"], toneTags: ["cerebral", "melancholy"], themes: ["obsession", "identity"], pacing: "slow", directors: ["Park Chan-wook"], writers: ["Park Chan-wook", "Jeong Seo-kyeong"], cinematographers: ["Kim Ji-yong"], actors: ["Tang Wei", "Park Hae-il"], countries: ["KR"], languages: ["ko"], canonicalScore: 75, popularity: 64, availability: [on("criterion-channel")] }),
  makeTitle({ id: "high-and-low", name: "High and Low", year: 1963, contentType: "movie", genres: ["Thriller", "Drama"], subgenres: ["Crime", "Procedural"], toneTags: ["cerebral", "tense"], themes: ["class", "morality"], pacing: "moderate", directors: ["Akira Kurosawa"], writers: ["Akira Kurosawa", "Eijiro Hisaita"], cinematographers: ["Asakazu Nakai"], actors: ["Toshiro Mifune"], countries: ["JP"], languages: ["ja"], canonicalScore: 92, criterionCollection: true, popularity: 55, availability: [on("criterion-channel")] }),
  makeTitle({ id: "seven-samurai", name: "Seven Samurai", year: 1954, contentType: "movie", genres: ["Action", "Drama"], subgenres: ["Samurai"], toneTags: ["epic", "humanist"], themes: ["duty", "community"], pacing: "moderate", runtimeMinutes: 207, directors: ["Akira Kurosawa"], writers: ["Akira Kurosawa"], cinematographers: ["Asakazu Nakai"], actors: ["Toshiro Mifune"], countries: ["JP"], languages: ["ja"], canonicalScore: 99, criterionCollection: true, popularity: 70, availability: [on("criterion-channel")] }),
  makeTitle({ id: "in-the-mood-for-love", name: "In the Mood for Love", year: 2000, contentType: "movie", genres: ["Drama", "Romance"], subgenres: ["Melodrama"], toneTags: ["melancholy", "sensual"], themes: ["longing", "memory"], pacing: "slow", directors: ["Wong Kar-wai"], writers: ["Wong Kar-wai"], cinematographers: ["Christopher Doyle", "Mark Lee Ping-bin"], actors: ["Tony Leung", "Maggie Cheung"], countries: ["HK"], languages: ["zh"], canonicalScore: 98, criterionCollection: true, popularity: 68, availability: [on("criterion-channel")] }),
  makeTitle({ id: "cleo", name: "Cléo from 5 to 7", year: 1962, contentType: "movie", genres: ["Drama"], subgenres: ["French New Wave"], toneTags: ["reflective", "observational"], themes: ["mortality", "identity"], pacing: "slow", directors: ["Agnès Varda"], writers: ["Agnès Varda"], cinematographers: ["Jean Rabier"], actors: ["Corinne Marchand"], countries: ["FR"], languages: ["fr"], canonicalScore: 90, criterionCollection: true, popularity: 42, availability: [on("criterion-channel")] }),
  makeTitle({ id: "the-apartment", name: "The Apartment", year: 1960, contentType: "movie", genres: ["Comedy", "Drama", "Romance"], subgenres: ["Romantic Comedy"], toneTags: ["bittersweet", "witty"], themes: ["loneliness", "work"], directors: ["Billy Wilder"], writers: ["Billy Wilder", "I. A. L. Diamond"], cinematographers: ["Joseph LaShelle"], actors: ["Jack Lemmon", "Shirley MacLaine"], canonicalScore: 93, popularity: 64, availability: [on("prime")] }),
  makeTitle({ id: "palm-springs", name: "Palm Springs", year: 2020, contentType: "movie", genres: ["Comedy", "Romance"], subgenres: ["Time Loop", "Romantic Comedy"], toneTags: ["witty", "absurdist"], themes: ["commitment"], pacing: "fast", directors: ["Max Barbakow"], writers: ["Andy Siara"], cinematographers: ["Quyen Tran"], actors: ["Andy Samberg", "Cristin Milioti"], canonicalScore: 42, popularity: 74, availability: [on("hulu")] }),
  makeTitle({ id: "dr-strangelove", name: "Dr. Strangelove", year: 1964, contentType: "movie", genres: ["Comedy"], subgenres: ["Satire", "Dark Comedy"], toneTags: ["dark", "absurdist", "political"], themes: ["war", "bureaucracy"], pacing: "fast", directors: ["Stanley Kubrick"], writers: ["Stanley Kubrick", "Terry Southern"], cinematographers: ["Gilbert Taylor"], actors: ["Peter Sellers"], canonicalScore: 96, popularity: 69, availability: [on("max")] }),
  makeTitle({ id: "inside", name: "Bo Burnham: Inside", year: 2021, contentType: "stand-up", genres: ["Stand-Up"], subgenres: ["Musical", "Experimental"], toneTags: ["dark", "absurdist", "introspective"], themes: ["isolation", "performance"], directors: ["Bo Burnham"], writers: ["Bo Burnham"], cinematographers: ["Bo Burnham"], actors: ["Bo Burnham"], runtimeMinutes: 87, canonicalScore: 54, popularity: 75, availability: [on("netflix")] }),
  makeTitle({ id: "kid-gorgeous", name: "John Mulaney: Kid Gorgeous", year: 2018, contentType: "stand-up", genres: ["Stand-Up"], subgenres: ["Observational", "Storytelling"], toneTags: ["witty", "polished"], themes: ["adulthood"], pacing: "fast", directors: ["Alex Timbers"], writers: ["John Mulaney"], actors: ["John Mulaney"], runtimeMinutes: 65, canonicalScore: 38, popularity: 68, availability: [on("netflix")] }),
  makeTitle({ id: "nanette", name: "Hannah Gadsby: Nanette", year: 2018, contentType: "stand-up", genres: ["Stand-Up"], subgenres: ["Storytelling", "Social"], toneTags: ["emotional", "provocative"], themes: ["identity", "trauma"], directors: ["Jon Olb"], writers: ["Hannah Gadsby"], actors: ["Hannah Gadsby"], runtimeMinutes: 69, canonicalScore: 57, popularity: 53, availability: [on("netflix")] }),
  makeTitle({ id: "severance", name: "Severance", year: 2022, contentType: "series", genres: ["Drama", "Thriller"], subgenres: ["Science Fiction", "Mystery"], toneTags: ["cerebral", "dark", "absurdist"], themes: ["work", "identity"], pacing: "slow", episodeRuntimeMinutes: 52, seasons: 2, directors: ["Ben Stiller"], writers: ["Dan Erickson"], cinematographers: ["Jessica Lee Gagné"], actors: ["Adam Scott"], canonicalScore: 65, popularity: 91, trendingScore: 88, availability: [on("apple-tv")] }),
  makeTitle({ id: "slow-horses", name: "Slow Horses", year: 2022, contentType: "series", genres: ["Thriller", "Drama"], subgenres: ["Spy", "Dark Comedy"], toneTags: ["witty", "gritty"], themes: ["failure", "loyalty"], pacing: "fast", episodeRuntimeMinutes: 48, seasons: 5, directors: ["James Hawes"], writers: ["Will Smith"], cinematographers: ["Danny Cohen"], actors: ["Gary Oldman"], canonicalScore: 50, popularity: 82, trendingScore: 78, availability: [on("apple-tv")] }),
  makeTitle({ id: "abbott", name: "Abbott Elementary", year: 2021, contentType: "series", genres: ["Comedy"], subgenres: ["Workplace", "Mockumentary"], toneTags: ["warm", "witty"], themes: ["community", "work"], pacing: "fast", episodeRuntimeMinutes: 22, seasons: 5, serialized: false, directors: ["Randall Einhorn"], writers: ["Quinta Brunson"], actors: ["Quinta Brunson"], canonicalScore: 41, popularity: 79, trendingScore: 66, availability: [on("hulu")] }),
  makeTitle({ id: "dark", name: "Dark", year: 2017, contentType: "series", genres: ["Thriller", "Drama"], subgenres: ["Science Fiction", "Mystery"], toneTags: ["cerebral", "dark", "nonlinear"], themes: ["family", "time"], pacing: "slow", episodeRuntimeMinutes: 55, seasons: 3, completed: true, directors: ["Baran bo Odar"], writers: ["Jantje Friese"], cinematographers: ["Nikolaus Summerer"], actors: ["Louis Hofmann"], countries: ["DE"], languages: ["de"], canonicalScore: 61, popularity: 85, trendingScore: 45, availability: [on("netflix")] }),
  makeTitle({ id: "the-thing", name: "The Thing", year: 1982, contentType: "movie", genres: ["Horror", "Science Fiction"], subgenres: ["Body Horror"], toneTags: ["dark", "paranoid"], themes: ["identity", "survival"], pacing: "moderate", directors: ["John Carpenter"], writers: ["Bill Lancaster"], cinematographers: ["Dean Cundey"], actors: ["Kurt Russell"], canonicalScore: 90, criterionCollection: true, popularity: 80, availability: [on("peacock")] }),
  makeTitle({ id: "alien", name: "Alien", year: 1979, contentType: "movie", genres: ["Horror", "Science Fiction"], subgenres: ["Creature Feature"], toneTags: ["dark", "claustrophobic"], themes: ["survival", "corporations"], pacing: "slow", directors: ["Ridley Scott"], writers: ["Dan O'Bannon"], cinematographers: ["Derek Vanlint"], actors: ["Sigourney Weaver"], canonicalScore: 96, popularity: 92, availability: [on("hulu")] }),
  makeTitle({ id: "get-out", name: "Get Out", year: 2017, contentType: "movie", genres: ["Horror", "Thriller"], subgenres: ["Social Horror", "Satire"], toneTags: ["dark", "witty", "tense"], themes: ["race", "identity"], pacing: "fast", directors: ["Jordan Peele"], writers: ["Jordan Peele"], cinematographers: ["Toby Oliver"], actors: ["Daniel Kaluuya"], canonicalScore: 88, popularity: 91, availability: [on("peacock")] }),
  makeTitle({ id: "mad-max", name: "Mad Max: Fury Road", year: 2015, contentType: "movie", genres: ["Action"], subgenres: ["Post-apocalyptic"], toneTags: ["intense", "spectacle"], themes: ["freedom", "survival"], pacing: "fast", directors: ["George Miller"], writers: ["George Miller"], cinematographers: ["John Seale"], actors: ["Charlize Theron"], canonicalScore: 91, popularity: 93, availability: [on("max")] }),
  makeTitle({ id: "michael-clayton", name: "Michael Clayton", year: 2007, contentType: "movie", genres: ["Drama", "Thriller"], subgenres: ["Legal", "Corporate"], toneTags: ["cerebral", "tense"], themes: ["morality", "work"], pacing: "moderate", directors: ["Tony Gilroy"], writers: ["Tony Gilroy"], cinematographers: ["Robert Elswit"], actors: ["George Clooney"], canonicalScore: 73, popularity: 61, availability: [on("tubi", "free"), on("amazon-store", "rental", "US", 3.99)] }),
  makeTitle({ id: "burning", name: "Burning", year: 2018, contentType: "movie", genres: ["Drama", "Thriller"], subgenres: ["Mystery"], toneTags: ["cerebral", "ambiguous", "slow-burn"], themes: ["class", "obsession"], pacing: "slow", directors: ["Lee Chang-dong"], writers: ["Oh Jung-mi", "Lee Chang-dong"], cinematographers: ["Hong Kyung-pyo"], actors: ["Yoo Ah-in", "Steven Yeun"], countries: ["KR"], languages: ["ko"], canonicalScore: 86, popularity: 52, availability: [on("amazon-store", "rental", "US", 3.99), on("apple-store", "rental", "US", 3.99)] }),
];

const date = "2026-08-01T12:00:00.000Z";

export const demoProfiles: Profile[] = [
  {
    id: "profile-john", accountId: "demo-account", displayName: "John", avatar: "J", createdAt: date,
    onboardingCompleted: true, guest: false, region: "US", modelVersion: "1.0.0",
    subscriptions: ["netflix", "max", "criterion-channel", "prime"], rentalMode: "exceptional", allowAdSupported: true,
    ratings: [
      { titleId: "zodiac", score: 9, watched: true, ratedAt: date },
      { titleId: "gone-girl", score: 9, watched: true, ratedAt: date },
      { titleId: "prisoners", score: 9, watched: true, ratedAt: date },
      { titleId: "arrival", score: 8, watched: true, ratedAt: date },
      { titleId: "heat", score: 10, watched: true, ratedAt: date, rewatchCount: 2 },
      { titleId: "palm-springs", score: 4, watched: true, ratedAt: date },
    ],
    questionnaire: { completedAt: date, dimensionScores: { cerebral: 84, darknessTolerance: 76, ambiguityTolerance: 82, internationalOpenness: 79, novelty: 66, standUp: 44 }, genreScores: { Thriller: 7, Drama: 6, Comedy: 3, Horror: 5, "Stand-Up": 3 } },
    favoritePeople: { actors: [], directors: ["David Fincher", "Michael Mann"], writers: [], cinematographers: ["Roger Deakins"] },
  },
  {
    id: "profile-sarah", accountId: "demo-account", displayName: "Sarah", avatar: "S", createdAt: date,
    onboardingCompleted: true, guest: false, region: "US", modelVersion: "1.0.0",
    subscriptions: ["netflix", "hulu", "apple-tv", "disney"], rentalMode: "never", allowAdSupported: false,
    ratings: [
      { titleId: "palm-springs", score: 9, watched: true, ratedAt: date, rewatchCount: 1 },
      { titleId: "abbott", score: 10, watched: true, ratedAt: date },
      { titleId: "zodiac", score: 3, watched: true, ratedAt: date },
      { titleId: "inside", score: 8, watched: true, ratedAt: date },
    ],
    questionnaire: { completedAt: date, dimensionScores: { comedy: 88, rewatchOrientation: 76, darknessTolerance: 22, bingePreference: 81, standUp: 75 }, genreScores: { Comedy: 7, Thriller: 2, Drama: 5, "Stand-Up": 6 } },
    favoritePeople: { actors: ["Cristin Milioti"], directors: [], writers: ["Quinta Brunson"], cinematographers: [] },
  },
  {
    id: "profile-mike", accountId: "demo-account", displayName: "Mike", avatar: "M", createdAt: date,
    onboardingCompleted: false, guest: false, region: "US", modelVersion: "1.0.0",
    subscriptions: ["netflix", "peacock", "paramount"], rentalMode: "exceptional", allowAdSupported: true,
    ratings: [], favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
  },
  {
    id: "profile-guest", accountId: "demo-account", displayName: "Guest", avatar: "G", createdAt: date,
    onboardingCompleted: false, guest: true, region: "US", modelVersion: "1.0.0",
    subscriptions: ["netflix"], rentalMode: "never", allowAdSupported: false,
    ratings: [], favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
  },
];

export const demoSocial: SocialRecommendationInput = {
  now: "2026-08-09T12:00:00.000Z",
  friendProfiles: [{
    profileId: "profile-jane",
    displayName: "Jane",
    shareWithFriends: "ratings_and_reviews",
    ratings: [
      { titleId: "zodiac", score: 10, watched: true, ratedAt: "2026-07-10T12:00:00.000Z" },
      { titleId: "gone-girl", score: 8, watched: true, ratedAt: "2026-07-12T12:00:00.000Z" },
      { titleId: "prisoners", score: 9, watched: true, ratedAt: "2026-07-15T12:00:00.000Z" },
      { titleId: "arrival", score: 9, watched: true, ratedAt: "2026-07-20T12:00:00.000Z" },
      { titleId: "decision-to-leave", score: 10, watched: true, ratedAt: "2026-08-07T20:00:00.000Z" },
    ],
  }],
  friendships: [{ requesterProfileId: "profile-john", addresseeProfileId: "profile-jane", status: "accepted" }],
  reviews: [{ authorProfileId: "profile-jane", titleId: "decision-to-leave", note: "Every precise detail becomes part of the mystery. Go in cold.", createdAt: "2026-08-07T20:05:00.000Z" }],
  recommendations: [{ senderProfileId: "profile-jane", recipientProfileId: "profile-john", titleId: "decision-to-leave", note: "This has exactly the patient obsession you like.", createdAt: "2026-08-07T20:08:00.000Z" }],
};

const agreement = (id: string, prompt: string, dimension: NonNullable<QuestionnaireQuestion["dimension"]>, reverse = false): QuestionnaireQuestion =>
  ({ id, kind: "agreement", prompt, dimension, reverse });

export const questionnaireQuestions: QuestionnaireQuestion[] = [
  agreement("q01", "I enjoy stories that keep giving me new ideas after the credits.", "cerebral"),
  agreement("q02", "A mystery is more rewarding when I have to pay close attention.", "cerebral"),
  agreement("q03", "Complex character motives are a feature, not a chore.", "cerebral"),
  agreement("q04", "I will choose an emotionally heavy story when the payoff feels earned.", "emotionalIntensity"),
  agreement("q05", "Bittersweet endings often stay with me in a good way.", "emotionalIntensity"),
  agreement("q06", "I am comfortable spending a movie night in a bleak fictional world.", "darknessTolerance"),
  agreement("q07", "Moral ambiguity makes crime stories more interesting to me.", "darknessTolerance"),
  agreement("q08", "Sustained suspense is one of the main things I seek from entertainment.", "thrill"),
  agreement("q09", "I enjoy fast pacing, danger, and high stakes.", "thrill"),
  agreement("q10", "Unusual worlds and speculative ideas quickly get my attention.", "imagination"),
  agreement("q11", "Surreal or dreamlike storytelling appeals to me.", "imagination"),
  agreement("q12", "Dry or deadpan comedy is usually my kind of funny.", "comedy"),
  agreement("q13", "I enjoy comedy that becomes awkward or absurd.", "comedy"),
  agreement("q14", "I actively choose stand-up specials, separately from comedy movies.", "standUp"),
  agreement("q15", "A fascinating character can carry a very simple plot.", "characterOrientation"),
  agreement("q16", "Grounded, realistic stories usually appeal to me more than escape.", "realism"),
  agreement("q17", "I am comfortable when an ending leaves room for interpretation.", "ambiguityTolerance"),
  agreement("q18", "Slow revelation can be more satisfying than immediate answers.", "ambiguityTolerance"),
  agreement("q19", "A patient slow burn can hold my attention.", "slowPacing"),
  agreement("q20", "I would rather try an unfamiliar title than repeat a safe formula.", "novelty"),
  agreement("q21", "I enjoy experimental storytelling even when it takes adjustment.", "novelty"),
  agreement("q22", "I like finding excellent movies that are outside the mainstream.", "discovery"),
  agreement("q23", "Independent films are a regular part of what I seek out.", "discovery"),
  agreement("q24", "Movies from before 1960 are fully in play for movie night.", "classicOpenness"),
  agreement("q25", "Black-and-white photography does not reduce my interest.", "classicOpenness"),
  agreement("q26", "Subtitles do not make me less likely to choose a film.", "internationalOpenness"),
  agreement("q27", "I enjoy entering stories from cultures unfamiliar to me.", "internationalOpenness"),
  agreement("q28", "Psychological horror is something I deliberately seek out.", "horrorTolerance"),
  agreement("q29", "Graphic gore is acceptable when it serves the story.", "horrorTolerance"),
  agreement("q30", "Revisiting a favorite can be better than watching something unseen.", "rewatchOrientation"),
  agreement("q31", "I am happy to commit to a multi-season story.", "televisionCommitment"),
  agreement("q32", "Watching several episodes in one sitting sounds appealing.", "bingePreference"),
  {
    id: "q33", kind: "forced-choice", prompt: "Which sounds better tonight?",
    choices: [
      { id: "slow", label: "A beautifully made slow-burn mystery", signals: { slowPacing: 1, cerebral: 0.5 } },
      { id: "propulsive", label: "A propulsive thriller that grabs me immediately", signals: { thrill: 1, slowPacing: -0.5 } },
    ],
  },
  {
    id: "q34", kind: "forced-choice", prompt: "Which discovery would you rather make?",
    choices: [
      { id: "classic", label: "A critically acclaimed movie I somehow missed", signals: { classicOpenness: 1 } },
      { id: "new", label: "A new release everyone is talking about", signals: { classicOpenness: -0.5 } },
    ],
  },
  {
    id: "q35", kind: "forced-choice", prompt: "Pick the more tempting option.",
    choices: [
      { id: "favorite", label: "A familiar favorite", signals: { rewatchOrientation: 1, novelty: -0.5 } },
      { id: "unknown", label: "Something I have never heard of", signals: { novelty: 1, discovery: 0.5 } },
    ],
  },
  {
    id: "q36", kind: "genre-matrix", prompt: "How much do you generally enjoy these?",
    genres: ["Drama", "Crime", "Thriller", "Mystery", "Action", "Adventure", "Science Fiction", "Fantasy", "Horror", "Romance", "Comedy", "Dark Comedy", "Satire", "Animation", "Documentary", "Historical", "War", "Western", "Musical", "Family", "Stand-Up"],
  },
];
