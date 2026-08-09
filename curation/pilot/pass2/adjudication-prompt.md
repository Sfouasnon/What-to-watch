# What to Watch — Pass 2 Blind Adjudication Prompt (Ontology v0.1.1)

This prompt is for **manual use** in ChatGPT, Claude, and Gemini. Paste this entire document into a fresh conversation, then attach or paste the contents of `adjudication-input.json` in the same message. Run it independently in each of the three tools. **Do not show one model's Pass 2 output to another model**, and do not carry over anything from a prior Pass 1 conversation — this must be a fresh, independent read.

---

## Background

What to Watch is building an editorial classification layer: for every movie or TV show, a controlled `primary_subgenre`, optional `secondary_subgenre`, zero-to-three `tone_tags`, and a `pacing` value. In an earlier pass ("Pass 1"), three different AI systems independently classified the same 100 titles using the same ontology and the same factual inputs you're about to see. Their answers were compared, and for a subset of titles, one or more fields did not reach full agreement.

**This is Pass 2: blind adjudication of only the disputed fields.** You are not reclassifying all 100 titles — you are being shown, for each disputed title, the three competing Pass 1 answers for the specific field(s) that were disputed, and asked to judge which one (if any) is correct against the ontology.

## Anonymity — read this carefully

For every disputed field, you will see three proposals labeled **Proposal A**, **Proposal B**, and **Proposal C**. These are anonymized, independent answers from three different AI systems (possibly including a system architecturally similar to you). The A/B/C ordering is **shuffled independently for every title** — Proposal A for one title and Proposal A for another title are not necessarily from the same source, and there is no consistent identity behind any letter across the file.

- Do **not** try to guess or reason about which system produced which proposal.
- Do **not** favor a proposal because its reasoning style, phrasing, or approach "feels like" a particular AI system.
- Judge every proposal purely on its merits against the controlled vocabulary and the factual context provided. Treat all three as equally credible until the evidence says otherwise.

## Your task

For each disputed field in `adjudication-input.json`, decide:

1. Which of Proposal A, B, or C is the best-supported answer according to the Editorial Ontology v0.1.1 definitions below — **or**
2. That none of the three fits well, in which case you may supply your own controlled-vocabulary value (or `null`, where the field allows it) instead of picking one of A/B/C — **or**
3. That the ontology genuinely supports more than one reasonable reading, or the supplied context is too thin to decide confidently, in which case you flag the field for human review (see below).

**Judge against the ontology, not by majority vote.** Do not simply pick "whichever two proposals happen to be similar" — read the actual definitions, inclusion guidance, and exclusion guidance, and decide what the work described by the context actually is. A proposal can be correct even if it stands alone against the other two; two similar-looking proposals can both be wrong.

You are working only from the factual context provided (title, overview, genres, runtime, language, cast, crew, keywords) — the same kind of factual packet used in Pass 1. You do not have access to the actual film or show.

## Required output per disputed field

For every disputed field, return:

- **`preferred_value`** — your adjudicated answer. For `primary_subgenre` and `secondary_subgenre`, a single controlled subgenre id, or `null` (only where the field allows null — see below). For `tone_tags`, an array of **up to 3** controlled tone ids (may be fewer than 3; do not force a third tag that doesn't fit — and the array does not have to match any single proposal exactly, it can mix tags from different proposals or include a tag none of them used, as long as it's in the controlled vocabulary and justified by the context).
- **`human_review`** — `true` or `false`. Set `true` when the ontology genuinely permits multiple reasonable readings of this title (a real judgment call, not just "the proposals disagree") or when the supplied context is insufficient to decide with confidence. Set `false` whenever you can confidently justify a single answer, even if you're overruling all three proposals.
- **`severity`** — how significant the resolved change is, one of:
  - `minor` — the proposals differ in a way that barely changes how a viewer would understand the work (e.g. two adjacent, closely-related terms; a secondary tag that adds little either way).
  - `meaningful` — the difference materially changes what kind of viewing experience a person would expect (e.g. `psychological-thriller` vs. `crime-thriller`; a tone set that shifts from `warm` to `bleak`).
  - `fundamental` — the proposals reflect fundamentally incompatible readings of the work, or at least one proposal is a clear misclassification against the ontology.
- **`reason`** — concise reasoning (1–3 sentences). State what in the context supports your answer and, if relevant, why you rejected the other proposals or all three.

### Field-specific rules

- **`primary_subgenre`**: required in the sense that you must give your best answer; use `null` only if the context is genuinely too thin to support any judgment (this should be rare — the same standard Pass 1 used).
- **`secondary_subgenre`**: `null` is a fully valid `preferred_value` and should be **preferred over a weak, forced secondary**. Only give a non-null secondary if it adds real information beyond the primary.
- **`tone_tags`**: `preferred_value` may be an array of 0 to 3 controlled tone ids. **Prefer exactly 3** whenever three genuinely descriptive, non-redundant controlled tone ids apply — including tags not proposed by any of A/B/C, if justified by the context. Drop to 2 only when a third would be weak, redundant, speculative, or misleading against the work as described; drop to 1 or 0 only when the context is genuinely too thin to support more. Never pad to 3 simply to satisfy the preferred count — every tag in `preferred_value` must be independently earned. You are not required to reproduce any single proposal's set exactly.

You may reject all three proposals for any field if none of them is well-supported by the ontology — in that case, supply your own controlled-vocabulary answer (or `null`, where allowed) as `preferred_value`, and explain why in `reason`.

## Editorial Ontology v0.1.1 — controlled vocabulary

Use **only** these controlled ids. Never invent, rename, pluralize, or combine ids. Families are shown for readability only — the leaf id is what gets used.

**Animation is a medium, not a genre.** Do not prefer an Animation-family term just because a title is animated — an animated superhero film is still `superhero`; an animated romantic comedy is still `romantic-comedy`; a cyberpunk anime is still `cyberpunk`. Only use `animated-family`, `adult-animation`, `anime-action`, or `isekai` when the animation-specific convention itself (all-ages family framing, adult-audience targeting, anime genre conventions, or the isekai displacement premise) is the meaningful signal — not merely because the work is animated. A Western, "anime-inspired" visual style is not the same as being part of the anime tradition; do not apply `anime-action` or `isekai` on visual style alone.

### Subgenre vocabulary (116 terms)

**Comedy**: `romantic-comedy` (comedy centered on a romantic relationship's development, typically resolving in the couple's union) · `dark-comedy` (plays serious/taboo subject matter for laughs while staying comic) · `black-comedy` (bleak, morbid, or misanthropic worldview inseparable from the humor) · `screwball-comedy` (fast-talking farce of mismatched pairs, rapid dialogue, escalating misunderstandings) · `satire` (irony/exaggeration critiquing a specific real-world target) · `parody-spoof` (directly imitates and exaggerates a specific genre/film/franchise) · `workplace-comedy` (comedy centered on a specific job/workplace's dynamics) · `coming-of-age-comedy` (young protagonist's transition to adulthood, told through humor) · `buddy-comedy` (mismatched-pair dynamic between friends/partners) · `breakup-comedy` (a relationship's end and comic fallout) · `sex-comedy` (sexual pursuit/desire/awkwardness as the comic engine) · `stoner-comedy` (drug use as defining lifestyle, episodic low-stakes misadventure) · `absurdist-comedy` (illogical premise or irrational world is the source of humor) · `mockumentary` (documentary form used as a fictional comic device).

**Drama**: `family-drama` (relationships/conflicts/obligations within a family unit) · `relationship-drama` (an intimate relationship between few characters, not primarily a genre romance) · `psychological-drama` (a character's internal mental/emotional state as primary conflict) · `legal-drama` (practice of law/litigation/justice system from a legal-professional POV) · `political-drama` (pursuit, exercise, or consequences of political power) · `historical-drama` (a clearly defined past era that materially shapes the story) · `social-drama` (a social issue or systemic condition and its effect on characters) · `workplace-drama` (stakes/hierarchy/pressures of a job, without comic framing) · `coming-of-age-drama` (a young protagonist's transition toward adulthood/self-understanding) · `sports-drama` (athletic competition/training/institution as primary stakes) · `showbiz-drama` (the entertainment industry and the toll/mechanics of fame).

**Crime**: `crime-drama` (commission/investigation/consequences of crime, not primarily thriller/procedural/heist) · `gangster` (rise and/or fall of a criminal figure within an underworld hierarchy) · `heist` (planning and execution of a theft/robbery) · `detective` (an investigator solving a case; investigative process is the engine) · `police-procedural` (law enforcement's routine methods/casework, process over personal drama) · `neo-noir` (classic film-noir conventions consciously adopted in a modern/non-period setting) · `courtroom-crime` (crime story structured around trial proceedings, not investigation) · `organized-crime` (operations/politics/culture of a criminal organization as an institution).

**Thriller**: `psychological-thriller` (uncertainty about a character's mental state/perception/trustworthiness) · `crime-thriller` (organized around a criminal act/antagonist, suspense and pursuit over procedure) · `political-thriller` (political power/conspiracy/state institutions create the danger) · `conspiracy-thriller` (protagonist uncovers a hidden coordinated plot) · `espionage-thriller` (intelligence work, spies, covert operations) · `erotic-thriller` (sexual desire/relationship is the mechanism generating danger/suspense) · `tech-thriller` (technology — surveillance, AI, hacking, engineered systems — is the central threat/tool) · `survival-thriller` (physical survival of a hostile environment/antagonist) · `revenge-thriller` (pursuit of retribution against those who wronged the protagonist).

**Action**: `action-thriller` (action-forward plus sustained thriller-level suspense) · `martial-arts` (hand-to-hand combat systems/disciplines as primary focus) · `adventure-action` (a journey/quest/exploration prioritizing spectacle and momentum) · `military-action` (organized armed forces/combat units/military operations) · `superhero` (a character/team with extraordinary powers within a superhero mythology) · `revenge-action` (violent retribution pursued primarily through action set pieces) · `disaster` (surviving a large-scale catastrophic event, natural or man-made).

**Horror**: `psychological-horror` (fear via mental deterioration/unreliable perception/dread) · `supernatural-horror` (threat originates from a paranormal/otherworldly force) · `folk-horror` (isolated communities, rural landscapes, pre-modern beliefs/rituals) · `body-horror` (graphic transformation/mutilation/violation of the human body) · `slasher` (a killer stalking/murdering a sequence of victims, often a signature method) · `creature-feature` (a monster/creature as the primary physical antagonist) · `gothic-horror` (atmosphere and decayed-grandeur gothic settings over graphic violence) · `cosmic-horror` (incomprehensible, vast, or indifferent forces beyond human understanding) · `horror-comedy` (scares played for comic effect, fear and humor as co-equal tones) · `survival-horror` (physical struggle to survive a hostile threat/environment, endurance over investigation) · `sci-fi-horror` (threat grounded in sci-fi premises — aliens, experiments, technology gone wrong).

**Science Fiction**: `hard-sci-fi` (scientific plausibility/technical accuracy central to the logic) · `dystopian-sci-fi` (an oppressive/degraded future society's control over its people) · `cyberpunk` (advanced tech + social decay + corporate power + stylized urban underworld) · `space-opera` (large-scale adventure across space, sweeping stakes/multiple factions) · `alien-first-contact` (humanity's encounter/communication with non-human intelligence) · `time-travel` (movement between time points as the central narrative mechanic) · `tech-sci-fi` (near-term social/personal consequences of a specific emerging technology) · `post-apocalyptic` (survival after a civilization-ending event).

**Fantasy**: `epic-fantasy` (an original secondary world, large-scale stakes, mythic structure) · `dark-fantasy` (foregrounds horror elements, moral bleakness, or menace) · `urban-fantasy` (magical/mythical elements within a recognizably contemporary real-world setting) · `magical-realism` (a realistic everyday setting where a few magical elements are treated as unremarkable) · `fairy-tale-fable` (structured as/adapted from a traditional fairy tale, fable, or folk tale) · `sword-and-sorcery` (a capable individual hero/small band in personal-scale battles vs. magical/monstrous threats, action over world-spanning stakes).

**Romance**: `romantic-drama` (a relationship's course, not comic potential, drives the story) · `period-romance` (a historical era whose social conventions materially shape the relationship) · `tragic-romance` (defined by the relationship's failure, loss, death, or separation) · `erotic-romance` (sexual desire/intimacy as a central, foregrounded element).

**Mystery**: `murder-mystery` (solving a specific killing; culprit's identity is central) · `whodunit` (a formal puzzle — defined suspects, clues, fair-play reveal) · `mystery-thriller` (thriller-level tension/danger alongside the central puzzle) · `puzzle-mystery` (solving a complex structural/intellectual puzzle, not necessarily a crime).

**War**: `combat-film` (frontline combat and its physical experience) · `anti-war-film` (primary purpose is to critique the morality/cost/futility of war) · `pow-escape` (captivity and a prisoner-of-war's attempt to escape/endure) · `home-front-war-drama` (civilians/communities affected by a war occurring elsewhere).

**Western**: `traditional-western` (upholds classic genre conventions without substantially subverting them) · `revisionist-western` (consciously subverts/critiques classic genre conventions) · `neo-western` (Western sensibility/themes relocated to a modern-day setting).

**Musical**: `traditional-musical` (song-and-dance numbers as a core, integrated storytelling device) · `music-drama` (musicians/music-making/industry, drama register, no full musical numbers) · `music-comedy` (musicians/music-making/industry, comic register, no full musical numbers).

**Documentary**: `investigative-documentary` (uncovering previously hidden/disputed facts) · `biography-profile-documentary` (the life story of one person or a small defined group) · `political-social-documentary` (a political issue, policy, or broad social phenomenon) · `nature-documentary` (the natural world, wildlife, or environment) · `music-documentary` (a musician, band, or music scene) · `sports-documentary` (an athlete, team, sporting event or era) · `true-crime-documentary` (a real crime, investigation, or criminal case).

**TV-Specific**: `sitcom` (half-hour-scale scripted comedy, recurring ensemble, self-contained episodic situations) · `workplace-sitcom` (sitcom organized around a specific workplace) · `family-sitcom` (sitcom organized around a family household) · `dramedy` (sustains comedic and dramatic registers as co-equal tones across episodes) · `procedural` (a self-contained case/incident/problem resolved largely within each episode) · `prestige-drama` (serialized hour-long drama, heightened production values, sustained season-long arcs) · `soap-serial-drama` (serialized interpersonal melodrama across an ensemble, long-running plotted arcs) · `anthology` (each season/episode is self-contained, connected by theme not continuing plot) · `sketch-comedy` (a sequence of short, unconnected comedic sketches, no recurring host-interview structure) · `reality-competition` (contestants competing toward elimination or a defined prize) · `docuseries` (a multi-episode nonfiction series following a real subject/event/investigation) · `late-night-talk-show` (recurring host, nightly/daily monologue + celebrity interview + comedy-segment format — distinct from sketch-comedy's unconnected sketches and from news-satire's news-broadcast parody structure) · `news-satire` (satirizes current news/events specifically, using a news-broadcast format — anchor desk, correspondents, headlines — distinct from general-purpose `satire` and from `late-night-talk-show`'s interview structure).

**Animation** *(medium, not genre — see the design principle above before using any of these)*: `animated-family` (all-ages/gentle sensibility is itself a meaningful signal beyond genre/plot content; use as primary only when no existing subgenre captures the content precisely, or as secondary when the family-friendly packaging adds real information) · `adult-animation` (created/marketed for an adult audience — mature humor/themes — flags audience intent; pair with the actual content subgenre rather than using alone) · `anime-action` (Japanese-animation work whose primary appeal is fast-paced physical/supernatural combat via anime-specific conventions — shonen tournament arcs, power escalation, creature-battling; not for Western productions merely styled after anime) · `isekai` (protagonist transported/reincarnated/displaced into a different, typically fantasy or game-like world, and that displacement premise structures the story; not a generic label for any portal-fantasy — it names a specific anime convention).

### Tone vocabulary (25 terms — use 0 to 3, prefer 3)

**Prefer exactly 3** tone tags whenever three genuinely descriptive, non-redundant terms apply. Use 2 only when a third would be weak, redundant, speculative, or misleading; use 1 or 0 only when the context is genuinely too thin to support more. Never pad to 3 just to hit the preferred count. Pay attention to each "not" clause — these terms are written to be mutually distinguishing.

- `warm` — genuine affection/kindness/closeness between characters. *Not* uplifting (that's about story trajectory, not relationship temperature).
- `bittersweet` — genuine happiness/resolution and genuine loss both fully present at once. *Not* just a sad story with a happy ending.
- `melancholic` — persistent, low-intensity sadness/wistfulness, coexists with hope. *Not* bleak (which withholds hope almost entirely).
- `bleak` — little to no meaningful hope/comfort/redemption; despair dominant and unresolved. *Not* melancholic (which allows warmth/humor alongside sadness).
- `uplifting` — hope, affirmation, or emotional lift via the story's trajectory/resolution. *Not* warm (relationship texture vs. story arc).
- `sentimental` — openly, deliberately appeals to tender emotion (music, dialogue, framing). *Not* warm/bittersweet, which earn emotion more obliquely.
- `playful` — light, mischievous, energetic; delights in its own premise. *Not* absurdist (illogic vs. simple high spirits).
- `raunchy` — explicit/crude sexual or bodily humor as a deliberate comic engine. *Not* just "contains adult content" in a serious drama.
- `deadpan` — flat, affectless delivery; humor from the gap with outrageous content. *Not* wry (a narrative attitude, not a performance style).
- `absurdist` — illogical premise or fundamentally irrational world-logic. *Not* playful (which is just lighthearted mood).
- `satirical` — critiques a specific real-world target via irony/exaggeration. *Not* cynical (a general stance with no specific target).
- `wry` — dry, understated, knowing humor as narrative attitude. *Not* deadpan (a performance/delivery style).
- `tense` — anticipatory anxiety about an uncertain outcome. *Not* menacing (a felt threatening presence, not uncertainty).
- `menacing` — the felt presence of a specific threatening force/person/entity. *Not* tense (uncertainty about outcome).
- `unsettling` — diffuse wrongness/discomfort without a clear identifiable threat. *Not* menacing (which has a locatable source).
- `visceral` — immediate, bodily reaction via violence/physical intensity/sensory extremity. *Not* abstractly "intense."
- `cerebral` — prioritizes ideas/logic/intellectual engagement. *Not* enigmatic (cerebral work can still fully resolve).
- `enigmatic` — deliberately withholds clear meaning/resolution by design. *Not* cerebral (amount of thinking required vs. unresolved ambiguity).
- `meditative` — unhurried, contemplative, favors stillness/atmosphere over incident. *Not* just slow pacing — this is a tonal register, though it often co-occurs with slow pacing.
- `dreamlike` — dream logic/imagery/atmosphere, fluid and associative. *Not* enigmatic (atmosphere vs. withheld meaning).
- `gritty` — unvarnished, tactile realism; grime/hardship/consequence without glamorization. *Not* bleak (texture/realism vs. presence/absence of hope).
- `stylized` — a distinctive, heightened visual/formal aesthetic departing from naturalism. *Not* dreamlike (a crafted aesthetic choice, can be sharp/precise).
- `earnest` — sincere, direct emotional/moral intent, no irony or protective wink. *Not* sentimental (sincerity of intent vs. tear-jerking technique).
- `cynical` — assumes self-interested/corrupt motives as default; distrustful of institutions/sincerity. *Not* satirical (general stance vs. pointed critique of a specific target).
- `romantic` — longing/attraction/love as an idealized emotional force. *Not* sentimental (the object of feeling vs. a manipulative technique applicable to any subject).

## Output format

Return **only** valid JSON — no prose, no markdown code fences, no commentary before or after the JSON, matching this exact shape:

```json
{
  "ontology_version": "0.1.1",
  "pass": 2,
  "adjudications": [
    {
      "tmdb_id": 123,
      "media_type": "movie",
      "fields": [
        {
          "field": "primary_subgenre",
          "preferred_value": "crime-drama",
          "human_review": false,
          "severity": "meaningful",
          "reason": "..."
        }
      ]
    }
  ]
}
```

Every dispute listed in `adjudication-input.json` for a title must appear exactly once in that title's `fields` array — do not skip, merge, or duplicate any disputed field. Do not adjudicate fields that were not listed as disputes for that title. Preserve `tmdb_id` and `media_type` exactly as given. Do not add extra top-level fields.

---

## Tone tag preference note (2026-08-09)

The `tone_tags` guidance above reflects a 2026-08-09 policy update that **reverses** earlier guidance to "prefer fewer, precise tags." The controlled tone vocabulary is unchanged (still ontology v0.1.1, 25 terms, zero-to-three cardinality) — only the preferred count within that range changed, toward exactly three wherever three genuinely apply. When adjudicating a disputed `tone_tags` field, this means you should actively consider whether a well-supported third tag exists beyond what any of Proposals A/B/C offered, not just choose among their tag counts.

Now adjudicate every dispute in the attached `adjudication-input.json`.
