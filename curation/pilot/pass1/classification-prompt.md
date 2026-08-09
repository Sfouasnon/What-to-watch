# What to Watch — Pass 1 Editorial Classification Prompt (Ontology v0.1.1)

This prompt is for **manual use** in ChatGPT, Claude, and Gemini. Paste this entire document into a fresh conversation, then attach or paste the contents of `classification-input.json` in the same message (or immediately after, before asking for output). Run it independently in each of the three tools. Do not show one model's output to another model.

---

## Your task

You are helping build the editorial classification layer for **What to Watch**, a recommendation app. What to Watch's purpose is to help people find something to watch based on *what kind of viewing experience they want* — not just what's popular or highly rated. To do that, it needs a consistent, intrinsic description of each title: what subgenre it belongs to, what emotional tone it has, and how it paces itself. This classification becomes training and evaluation data for that system, so accuracy and consistency matter more than speed.

You will be given a JSON array of movies and TV shows with factual context (title, overview, genres, runtime, cast, crew, keywords, etc). For **every** title, classify it using the controlled vocabulary below. Classify **from the work itself** — its premise, tone, and structure as described by the overview, genres, cast, crew, and keywords — not by mechanically copying the TMDB genre list. TMDB genres are a broad, noisy starting signal, not the answer.

## Hard rules

1. Use **only** the controlled vocabulary IDs listed below for `primary_subgenre`, `secondary_subgenre`, and `tone_tags`. Never invent, rename, pluralize, or combine IDs. If nothing fits well, use `null` rather than force a bad fit or make up a new term.
2. `primary_subgenre` is **required** to be your single best, most specific answer to "what kind of work is this?" — use `null` only if the supplied information is genuinely too thin to support any judgment (this should be rare).
3. `secondary_subgenre` is **optional**. Only include it if it adds real information beyond `primary_subgenre`. It must be a different ID than `primary_subgenre`. Use `null` if there is no useful second answer.
4. `tone_tags` may contain **zero, one, two, or three** IDs — never more than three. **Prefer exactly three** whenever three genuinely descriptive, non-redundant controlled tone terms apply. Two is acceptable only when a third would be weak, redundant, speculative, or misleading. One or zero should be rare, and should only happen when the supplied context is genuinely too thin to support more. Never pad to three simply to hit the preferred count — every tag you include must be independently earned by the context.
5. `pacing` must be exactly one of `slow`, `moderate`, or `fast`, or `null` if you cannot judge it from the supplied context.
6. Do **not** classify or comment on: hidden-gem status, comfort-watch status, blind-spot status, rewatchability, mainstream vs. niche, film-school-worthiness, canonical importance, or Criterion status. These are out of scope for this task. If you find yourself reasoning about how well-known, acclaimed, or beloved a title is, stop — that is not part of this classification.
7. Classify **every** supplied title **exactly once**. Do not skip titles, merge titles, or add titles that were not supplied.
8. Preserve `tmdb_id` and `media_type` exactly as given, for every title.
9. Output **valid JSON only** — no prose, no markdown code fences, no commentary before or after the JSON.
10. **Animation is a medium, not a genre.** Do not force every animated or anime title into an Animation-family subgenre (`animated-family`, `adult-animation`, `anime-action`, `isekai`). Prefer an existing, more specific non-animation subgenre as `primary_subgenre` whenever it accurately describes the work's content — an animated superhero film should still classify as `superhero`; an animated romantic comedy should still classify as `romantic-comedy`; a cyberpunk anime should still classify as `cyberpunk`. Only use an Animation-family term (as primary if nothing else fits, or as secondary alongside a precise content subgenre) when the animation-specific convention itself — anime genre conventions, adult-audience targeting, or all-ages family framing — is genuinely the meaningful signal, not merely because the title happens to be animated. A visually "anime-inspired" style is not the same as being part of the anime tradition — don't apply `anime-action` or `isekai` to Western productions on visual style alone.

## Controlled subgenre vocabulary

Exactly one of these IDs must be used for `primary_subgenre`. At most one (different from the primary) may be used for `secondary_subgenre`. Families are shown for readability only — use the leaf `id`, not the family name. Terms marked **(new in v0.1.1)** include extra inclusion/exclusion guidance — read it before applying them.

**Comedy**
- `romantic-comedy` — A comedy centered on the development of a romantic relationship, typically resolving with the couple's union.
- `dark-comedy` — Comedy that plays traditionally serious or taboo subject matter (death, illness, crime) for laughs while keeping a recognizably comic tone throughout.
- `black-comedy` — Comedy built around a bleak, morbid, or misanthropic worldview, where humor and disturbing content are inseparable rather than one offsetting the other.
- `screwball-comedy` — Fast-talking, farcical comedy of mismatched romantic pairs, class conflict, or social role reversal, marked by rapid-fire dialogue and escalating misunderstandings.
- `satire` — Comedy that uses irony, exaggeration, or ridicule to critique a specific real-world target such as institutions, politics, public figures, or social norms.
- `parody-spoof` — Comedy built by directly imitating and exaggerating the conventions of a specific genre, film, or franchise for comic effect.
- `workplace-comedy` — Comedy centered on the dynamics, hierarchy, and absurdities of a specific job or workplace.
- `coming-of-age-comedy` — Comedy centered on a young protagonist's transition toward adulthood, told primarily through humor.
- `buddy-comedy` — Comedy driven by the mismatched-pair dynamic between two (or more) friends or partners thrown together by circumstance.
- `breakup-comedy` — Comedy centered on the end of a romantic relationship and its comic fallout.
- `sex-comedy` — Comedy in which sexual pursuit, desire, or awkwardness is the primary comic engine.
- `stoner-comedy` — Comedy centered on drug use, typically cannabis, as a defining lifestyle and source of episodic, low-stakes misadventure.
- `absurdist-comedy` — Comedy built on illogical premises or a fundamentally irrational world, where the humor comes from that irrationality itself.
- `mockumentary` — Comedy that adopts documentary form (interviews, handheld footage, narration) as a fictional device.

**Drama**
- `family-drama` — Drama centered on the relationships, conflicts, and obligations within a family unit.
- `relationship-drama` — Drama centered on an intimate relationship between a small number of characters, without primarily being a romance in the genre sense.
- `psychological-drama` — Drama centered on a character's internal mental or emotional state as the primary source of conflict.
- `legal-drama` — Drama centered on the practice of law, including litigation, legal ethics, or the justice system, told from a legal-professional point of view.
- `political-drama` — Drama centered on the pursuit, exercise, or consequences of political power.
- `historical-drama` — Drama set in a clearly defined past era where the historical setting materially shapes the story (period drama).
- `social-drama` — Drama centered on a social issue or systemic condition, such as poverty, addiction, or discrimination, and its effect on characters' lives.
- `workplace-drama` — Drama centered on the stakes, hierarchy, and pressures of a specific job or workplace, without comic framing.
- `coming-of-age-drama` — Drama centered on a young protagonist's transition toward adulthood or self-understanding.
- `sports-drama` — Drama centered on athletic competition, training, or a sports institution as the primary stakes.
- `showbiz-drama` — Drama centered on the entertainment industry and the toll or mechanics of fame and creative work.

**Crime**
- `crime-drama` — Drama centered on the commission, investigation, or consequences of crime, without being primarily a thriller, procedural, or heist.
- `gangster` — Story centered on the rise and/or fall of an individual criminal figure within a criminal underworld or hierarchy.
- `heist` — Story structured around the planning and execution of a theft or robbery.
- `detective` — Story centered on an investigator, professional or amateur, solving a case, with the investigative process as the narrative engine.
- `police-procedural` — Story centered on law enforcement's routine methods and casework, emphasizing process over the personal drama of any one case.
- `neo-noir` — Contemporary story that consciously adopts classic film-noir conventions, such as moral ambiguity and a shadowy visual and narrative tone, in a modern or non-period setting.
- `courtroom-crime` — Crime story structured primarily around trial proceedings rather than investigation.
- `organized-crime` — Story centered on the operations, politics, or culture of a criminal organization as an institution, distinct from a single gangster's rise-and-fall arc.

**Thriller**
- `psychological-thriller` — Thriller driven by uncertainty about a character's mental state, perception, or trustworthiness rather than by physical danger alone.
- `crime-thriller` — Thriller organized around a criminal act or criminal antagonist, prioritizing suspense and pursuit over procedural or investigative detail.
- `political-thriller` — Thriller in which political power, conspiracy, or state institutions create the central danger.
- `conspiracy-thriller` — Thriller centered on a protagonist uncovering a hidden, coordinated plot, typically involving institutions working against them.
- `espionage-thriller` — Thriller centered on intelligence work, spies, or covert operations.
- `erotic-thriller` — Thriller in which sexual desire or a sexual relationship is the mechanism that generates danger or suspense.
- `tech-thriller` — Thriller in which technology, such as surveillance, AI, hacking, or engineered systems, is the central source of threat or the primary tool of danger.
- `survival-thriller` — Thriller centered on a character's struggle to physically survive a hostile environment or antagonist, with escape or endurance as the core stakes.
- `revenge-thriller` — Thriller structured around a protagonist's pursuit of retribution against those who wronged them.

**Action**
- `action-thriller` — Action-forward story that also sustains thriller-level suspense and stakes, blending set-piece spectacle with mounting tension.
- `martial-arts` — Action centered on hand-to-hand combat systems or disciplines as a primary visual and narrative focus.
- `adventure-action` — Action built around a journey, quest, or exploration, prioritizing spectacle and momentum over emotional interiority.
- `military-action` — Action centered on organized armed forces, combat units, or military operations.
- `superhero` — Action centered on a character or team with extraordinary powers or abilities operating within a superhero mythology or universe.
- `revenge-action` — Action structured around a protagonist's violent retribution against those who wronged them, with action set pieces as the primary means of pursuing it.
- `disaster` — Action centered on characters surviving a large-scale catastrophic event, natural or man-made.

**Horror**
- `psychological-horror` — Horror that generates fear through mental deterioration, unreliable perception, or dread rather than explicit monsters or violence.
- `supernatural-horror` — Horror in which the threat originates from a paranormal or otherworldly force, such as ghosts, demons, or possession.
- `folk-horror` — Horror rooted in isolated communities, rural landscapes, or pre-modern belief systems and rituals.
- `body-horror` — Horror centered on the graphic transformation, mutilation, or violation of the human body.
- `slasher` — Horror structured around a killer stalking and murdering a sequence of victims, typically with a signature method or weapon.
- `creature-feature` — Horror centered on a monster or creature as the primary physical antagonist.
- `gothic-horror` — Horror built on atmosphere, decayed grandeur, and classic gothic settings such as mansions, castles, and family curses, over graphic violence.
- `cosmic-horror` — Horror centered on incomprehensible, vast, or indifferent forces beyond human understanding or control.
- `horror-comedy` — Horror that plays its scares for comic effect, alternating or blending fear and humor as co-equal tones.
- `survival-horror` — Horror centered on a character's physical struggle to survive a hostile threat or environment, emphasizing endurance over investigation.
- `sci-fi-horror` — Horror in which the source of threat is grounded in science-fiction premises, such as aliens, experiments, or technology gone wrong.

**Science Fiction**
- `hard-sci-fi` — Science fiction that emphasizes scientific plausibility and technical accuracy as central to the story's logic and stakes.
- `dystopian-sci-fi` — Science fiction set in an oppressive or degraded future society, centered on that society's control over its people.
- `cyberpunk` — Science fiction combining advanced technology, often digital or cybernetic, with social decay, corporate power, and a stylized urban underworld.
- `space-opera` — Science fiction centered on large-scale adventure across space, typically with sweeping stakes, multiple factions, or galactic scope.
- `alien-first-contact` — Science fiction centered on humanity's encounter or communication with a non-human extraterrestrial intelligence.
- `time-travel` — Science fiction structured around movement between different points in time as the central narrative mechanic.
- `tech-sci-fi` — Science fiction centered on the near-term social or personal consequences of a specific emerging technology.
- `post-apocalyptic` — Science fiction set after a civilization-ending event, centered on survival in its aftermath.

**Fantasy**
- `epic-fantasy` — Fantasy set in an original secondary world with large-scale stakes, sprawling scope, and mythic structure.
- `dark-fantasy` — Fantasy that foregrounds horror elements, moral bleakness, or menace within its fantastical world.
- `urban-fantasy` — Fantasy in which magical or mythical elements exist within a recognizably contemporary, real-world setting.
- `magical-realism` — Story grounded in a realistic, everyday setting where a small number of magical elements are treated as unremarkable by the characters.
- `fairy-tale-fable` — Story structured as or directly adapted from a traditional fairy tale, fable, or folk tale, retaining that form's moral or symbolic logic.
- `sword-and-sorcery` — Fantasy centered on a physically capable individual hero or small band navigating personal-scale battles against magical or monstrous threats, prioritizing action over world-spanning stakes.

**Romance**
- `romantic-drama` — Drama centered on a romantic relationship where the relationship's course, not its comic potential, drives the story.
- `period-romance` — Romance set in a clearly defined historical era where the setting's social conventions materially shape the relationship.
- `tragic-romance` — Romance in which the central relationship is defined by its failure, loss, or the death or separation of one or both partners.
- `erotic-romance` — Romance in which sexual desire and intimacy are a central, foregrounded element of the relationship's portrayal.

**Mystery**
- `murder-mystery` — Mystery organized around solving a specific killing, with the culprit's identity as the central question.
- `whodunit` — Mystery structured as a formal puzzle with a defined set of suspects, clues, and a fair-play reveal of the culprit.
- `mystery-thriller` — Mystery that sustains thriller-level tension and danger alongside its central puzzle, rather than proceeding at a purely investigative pace.
- `puzzle-mystery` — Mystery centered on solving a complex structural or intellectual puzzle, not necessarily a crime, as the core engine.

**War**
- `combat-film` — War story centered on frontline combat and its physical experience.
- `anti-war-film` — War story whose primary purpose is to critique the morality, cost, or futility of war itself.
- `pow-escape` — War story centered on captivity and a prisoner-of-war's attempt to escape or endure imprisonment.
- `home-front-war-drama` — War story centered on civilians or communities affected by a war occurring elsewhere.

**Western**
- `traditional-western` — Western that upholds classic genre conventions, such as clear moral lines, frontier justice, and iconic Old West setting, without substantially subverting them.
- `revisionist-western` — Western that consciously subverts or critiques classic genre conventions, complicating its moral framework or mythology.
- `neo-western` — Western sensibility and themes relocated to a modern-day setting.

**Musical**
- `traditional-musical` — Story in which characters break into song-and-dance numbers as a core, integrated storytelling device.
- `music-drama` — Drama centered on musicians, music-making, or the music industry, without characters performing full musical numbers as a narrative device.
- `music-comedy` — Comedy centered on musicians, music-making, or the music industry, without characters performing full musical numbers as a narrative device.

**Documentary**
- `investigative-documentary` — Documentary structured around uncovering previously hidden or disputed facts about its subject.
- `biography-profile-documentary` — Documentary centered on the life story of a single person or a small, defined group of people.
- `political-social-documentary` — Documentary centered on a political issue, policy, or broad social phenomenon.
- `nature-documentary` — Documentary centered on the natural world, wildlife, or the environment.
- `music-documentary` — Documentary centered on a musician, band, or music scene.
- `sports-documentary` — Documentary centered on an athlete, team, or sporting event or era.
- `true-crime-documentary` — Documentary centered on a real crime, investigation, or criminal case.

**TV-Specific**
- `sitcom` — Half-hour-scale scripted comedy built around a recurring ensemble and self-contained episodic situations, with a stable premise across episodes.
- `workplace-sitcom` — Sitcom whose recurring setting and ensemble are organized around a specific workplace.
- `family-sitcom` — Sitcom whose recurring setting and ensemble are organized around a family household.
- `dramedy` — Series that deliberately sustains both comedic and dramatic registers as co-equal tones across episodes, rather than one dominating.
- `procedural` — Episodic series structured around a self-contained case, incident, or problem resolved largely within each episode.
- `prestige-drama` — Serialized hour-long drama with heightened production values and creative ambition, built for sustained arcs across a season rather than episodic cases.
- `soap-serial-drama` — Serialized drama centered on interpersonal melodrama across an ensemble, with long-running, heavily plotted relationship arcs.
- `anthology` — Series in which each season or episode tells a self-contained story with a new setting and/or cast, connected by theme rather than continuing plot.
- `sketch-comedy` — Series built from a sequence of short, unconnected comedic sketches rather than a continuing story or ensemble situation.
- `reality-competition` — Unscripted series structured around contestants competing toward elimination or a defined prize.
- `docuseries` — Multi-episode nonfiction series following a real subject, event, or investigation across a season.
- `late-night-talk-show` **(new in v0.1.1)** — Recurring host-driven program built around a nightly or daily format of monologues, celebrity interviews, and comedic segments.
  - Use when: Use for programs structured around a recurring host, guest interviews, and monologue or comedy-segment format, regardless of exact airtime.
  - Do not use when: Distinct from sketch-comedy: sketch-comedy is built from a sequence of unconnected scripted sketches with no recurring host-interview structure. Distinct from news-satire: news-satire's comedic structure is built specifically around parodying news-broadcast conventions and current events rather than general celebrity interviews, even though both formats may share a nightly airtime.
- `news-satire` **(new in v0.1.1)** — Program structured around satirizing current news and events specifically, using a news-broadcast format (anchor desk, correspondents, headlines) as the comedic vehicle.
  - Use when: Use when the show's comedic structure is specifically built around parodying news-broadcast conventions and current events, not general celebrity interviews.
  - Do not use when: Distinct from satire (Comedy family): satire is a general-purpose critique of any real-world target through irony or exaggeration, in any format (film, sitcom, etc.), while news-satire specifically names the news-broadcast-format vehicle. Distinct from late-night-talk-show: a news-satire program is organized around news headlines and correspondents rather than a monologue-plus-celebrity-interview structure.

**Animation**
- `animated-family` **(new in v0.1.1)** — Animated work made primarily for a general or family audience, where the all-ages, gentle sensibility itself is a meaningful editorial signal beyond genre or plot content.
  - Use when: Use as primary when no existing non-animation subgenre captures the work's content precisely (e.g. a gentle, low-plot family adventure). Use as secondary when an existing subgenre (adventure-action, epic-fantasy, superhero, etc.) already captures the content precisely but the all-ages animated packaging is still a materially useful signal for a viewer choosing what to watch.
  - Do not use when: Do not apply merely because a title is animated — animation is a medium, not automatically a subgenre. Skip this tag when the all-ages framing adds no information beyond what the existing primary subgenre already conveys. Do not use for adult-oriented animation (see adult-animation).
- `adult-animation` **(new in v0.1.1)** — Animated work created for and marketed to an adult audience, typically featuring mature humor, themes, or content not intended for a general family audience.
  - Use when: Use when the adult-oriented intent of the animation is itself a meaningful signal — for satirical adult sitcoms, adult sci-fi comedy, and similar — as primary if no other subgenre fits, or as secondary alongside a precise content subgenre (e.g. family-sitcom, absurdist-comedy).
  - Do not use when: Do not apply to all-ages or family-targeted animation (see animated-family). Do not apply merely because a title contains some crude humor if it remains fundamentally family-marketed. This term flags audience intent, not a specific comedic genre — pair it with the actual content subgenre (satire, family-sitcom, absurdist-comedy, etc.) rather than using it alone whenever a more specific fit exists.
- `anime-action` **(new in v0.1.1)** — Japanese-animation (anime) work whose primary appeal is fast-paced physical or supernatural combat, told through anime-specific genre conventions such as shonen tournament arcs, power escalation, or creature-battling structures.
  - Use when: Use as primary when the anime genre conventions themselves — not just the fact of being Japanese-animated — are the meaningful classification signal, e.g. a shonen battle series or creature-battling tournament adventure.
  - Do not use when: Do not use simply because a title is Japanese-animated, and do not use for a Western production merely styled after anime (an "anime-inspired" visual aesthetic is not the same as being part of the anime industry/tradition). If an existing non-animation subgenre (cyberpunk, martial-arts, superhero, adventure-action) already captures the content precisely, prefer that as primary and use anime-action only as a secondary flag if the anime-specific conventions add real information. Distinct from martial-arts (existing; discipline-focused combat, not anime-specific).
- `isekai` **(new in v0.1.1)** — Anime or anime-adjacent work in which a protagonist is transported, reincarnated, or otherwise displaced into a different, typically fantasy or game-like, world, and that displacement premise structures the story.
  - Use when: Use when the isekai displacement premise (death-and-reincarnation, portal transport, or being pulled into a game world) is itself a defining structural element of the plot.
  - Do not use when: Do not use as a generic synonym for "characters travel to another world" — a Western portal-fantasy story should use urban-fantasy or epic-fantasy instead. Isekai names a specific anime genre convention, not a plot device available to any medium. If the work is anime but not built around a displacement premise, prefer anime-action or an existing fantasy subgenre instead.

## Controlled tone vocabulary

Use zero to three of these IDs for `tone_tags`. **Prefer exactly three** whenever three genuinely descriptive, non-redundant tags apply; drop to two only when a third would be weak, redundant, speculative, or misleading; one or zero should be rare, reserved for genuinely insufficient evidence. Never pad to three just to satisfy the preferred count — each tag must be independently justified. Definitions below distinguish each term from the term it is most often confused with — read the "not" line before applying a tag.

- `warm` — Conveys genuine affection, kindness, or emotional closeness between characters; the viewer feels comforted by the relationships on screen. *(Not: Not the same as uplifting: warm describes the emotional temperature of relationships, not the trajectory or resolution of the story. A story can be warm and still end sadly.)*
- `bittersweet` — Blends genuine happiness or resolution with an equally genuine sense of loss, so that neither feeling cancels the other out. *(Not: Not simply a sad story with a happy ending: in bittersweet work the joy and the loss are both fully present at once, rather than joy following after sadness has passed.)*
- `melancholic` — A persistent, low-intensity sadness or wistfulness that colors the work without dominating it or removing hope entirely. *(Not: Distinct from bleak: melancholic sadness is reflective and survivable, and can coexist with warmth or gentle humor; bleak withholds hope almost entirely.)*
- `bleak` — Portrays a world or outcome with little to no meaningful hope, comfort, or redemption; despair is the dominant, unresolved note. *(Not: Distinct from melancholic: bleak work offers little or no relief from despair, where melancholic allows sadness to coexist with warmth, humor, or reflection.)*
- `uplifting` — Leaves the viewer with a sense of hope, affirmation, or emotional lift, typically through the story's trajectory or resolution. *(Not: Not the same as warm: uplifting describes the emotional arc or destination of the story, not the texture of relationships throughout it. A hard-won triumph can be uplifting without being warm.)*
- `sentimental` — Deliberately and openly appeals to tender emotion, often through music, dialogue, or framing designed to elicit feeling. *(Not: Not neutral about its emotional intent: sentimental work wears its heartstring-pulling openly, unlike warm or bittersweet work that earns emotion more obliquely.)*
- `playful` — Light, mischievous, and energetic in spirit; takes evident delight in its own game, characters, or premise. *(Not: Not the same as absurdist: playful describes an inviting, high-spirited energy, while absurdist specifically involves illogic or a fundamentally irrational premise.)*
- `raunchy` — Explicit, crude, or graphic in its sexual or bodily humor, foregrounded as a deliberate comic engine rather than incidental content. *(Not: Not simply 'contains adult content': raunchy specifically means crude sexual or bodily material is a deliberate comic device, not background material in a serious drama.)*
- `deadpan` — Delivered with flat, affectless line readings or reactions, where the humor comes from the gap between that flat delivery and outrageous or absurd content. *(Not: Distinct from wry: deadpan is a performance or delivery style (flat affect), while wry is a narrative attitude of dry, knowing understatement that doesn't require flat performance.)*
- `absurdist` — Built on illogical premises or a fundamentally irrational world where normal cause-and-effect or social logic doesn't apply. *(Not: Not the same as playful: absurdist is about the internal logic, or lack of it, governing the story's world, not simply a lighthearted mood.)*
- `satirical` — Critiques a specific real-world target, such as institutions, public figures, ideologies, or social norms, through irony or exaggeration. *(Not: Distinct from cynical: satirical implies an active, pointed critique aimed at a specific target, while cynical is a general distrustful stance with no particular object of ridicule.)*
- `wry` — A dry, understated, knowing sense of humor communicated through attitude and tone rather than performance style or premise. *(Not: Distinct from deadpan: wry is an authorial or narrative attitude of dry amusement, while deadpan refers specifically to flat delivery or performance.)*
- `tense` — Sustains anticipatory anxiety about what might happen next; the viewer feels suspense about an uncertain outcome. *(Not: Distinct from menacing: tense is about uncertainty and anticipation, asking whether something bad will happen, while menacing is about the felt presence of a specific threatening force, even without uncertainty about the outcome.)*
- `menacing` — Conveys the felt presence of a specific threatening force, person, or entity, regardless of whether the outcome is in doubt. *(Not: Distinct from tense: menacing describes a quality radiating from a person, place, or force, not the viewer's uncertainty about the plot's outcome.)*
- `unsettling` — Produces a diffuse sense of wrongness or discomfort that resists clear explanation, unmoored from a specific identifiable threat. *(Not: Distinct from menacing: unsettling doesn't require a locatable source of danger; the discomfort itself, not a specific threat, is the point.)*
- `visceral` — Produces an immediate, bodily reaction in the viewer through violence, physical intensity, or sensory extremity. *(Not: Not simply 'intense' in an abstract sense: visceral specifically implies a physical, gut-level reaction rather than an intellectual or purely emotional one.)*
- `cerebral` — Prioritizes ideas, logic, or intellectual engagement, asking the viewer to actively think through concepts or implications. *(Not: Distinct from enigmatic: cerebral work can be fully explicable and resolved, just demanding, while enigmatic work specifically withholds clear meaning or resolution.)*
- `enigmatic` — Deliberately withholds clear meaning, explanation, or resolution, leaving significant ambiguity intact by design. *(Not: Distinct from cerebral: enigmatic is defined by unresolved ambiguity itself, not by the amount of thinking required. A work can be cerebral and still fully resolve its ideas.)*
- `meditative` — Unhurried and contemplative, favoring stillness, reflection, or atmosphere over incident, inviting the viewer to sit with a mood or idea. *(Not: Not the same as slow pacing alone: meditative describes an emotional and tonal register of quiet reflection, though it frequently co-occurs with slow pacing.)*
- `dreamlike` — Evokes the logic, imagery, or atmosphere of a dream: fluid, associative, and not bound by strict realism or causality. *(Not: Distinct from enigmatic: dreamlike is about atmosphere and the loosening of realistic logic, not necessarily about withholding meaning or resolution.)*
- `gritty` — Depicts its world with unvarnished, tactile realism: grime, hardship, and consequence rendered without glamorization. *(Not: Not the same as bleak: gritty is about the texture and realism of the depiction, not the presence or absence of hope in the story's outcome.)*
- `stylized` — Foregrounds a distinctive, heightened visual or formal aesthetic that departs from naturalism as a deliberate authorial choice. *(Not: Not the same as dreamlike: stylized refers to a consciously crafted aesthetic choice, which can be sharp and precise rather than fluid or associative.)*
- `earnest` — Sincere and direct in its emotional or moral intent, without irony, cynicism, or a protective wink to the audience. *(Not: Distinct from sentimental: earnest describes sincerity of intent, not the deployment of tear-jerking technique. A work can be earnest without being emotionally manipulative.)*
- `cynical` — Assumes and portrays self-interested or corrupt motives as the default, distrustful of institutions, sincerity, or good intentions. *(Not: Distinct from satirical: cynical is a general worldview or stance, while satirical requires an active, pointed critique of a specific target.)*
- `romantic` — Foregrounds longing, attraction, or love as an idealized emotional force driving the work's central feeling. *(Not: Not the same as sentimental: romantic describes the specific object of feeling, love or desire, while sentimental describes an emotionally manipulative technique that can apply to any subject.)*

## Pacing

- `slow` — Deliberately allows substantial time between major narrative developments; patience is a defining part of the viewing experience.
- `moderate` — Neither deliberate patience nor sustained momentum is a defining characteristic.
- `fast` — Frequent narrative developments, action, jokes, revelations, scene changes, or escalating events create sustained forward momentum.

## Output format

Return **only** valid JSON matching this exact shape, with one entry per supplied title, in any order:

```json
{
  "ontology_version": "0.1.1",
  "classifications": [
    {
      "tmdb_id": 0,
      "media_type": "movie",
      "primary_subgenre": "string-or-null",
      "secondary_subgenre": "string-or-null",
      "tone_tags": [
        "string",
        "string"
      ],
      "pacing": "slow-or-moderate-or-fast-or-null"
    }
  ]
}
```

`media_type` must be exactly `"movie"` or `"tv"`, copied from the input. `tone_tags` must be an array (use `[]` for none, never `null`). `ontology_version` must be exactly `"0.1.1"`. Do not add extra fields. Do not omit any field, even when its value is `null`.

---

## Tone tag preference note (2026-08-09)

The `tone_tags` guidance above reflects a 2026-08-09 policy update that **reverses** earlier guidance to "prefer fewer, precise tags." The controlled tone vocabulary itself did not change (still ontology v0.1.1, still 25 terms, zero-to-three cardinality) — only the preferred count within that range changed, from favoring fewer tags to favoring exactly three wherever three genuinely apply. Any future run of this prompt should follow the three-tags-preferred guidance above, not the "prefer fewer" framing that appeared in earlier copies of this document.

Now classify all titles in the attached `classification-input.json`.
