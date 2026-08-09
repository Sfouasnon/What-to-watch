# What to Watch — Editorial Ontology v0.1

## Purpose

This ontology classifies the **intrinsic editorial properties** of a movie or TV show: what kind of work it is (subgenre), its emotional register (tone), and its narrative rhythm (pacing). It is deliberately scoped to properties that are true of the work itself, independent of who is watching it or how popular it is.

It does **not** classify hidden-gem status, comfort-watch status, blind-spot status, rewatchability, mainstream/niche positioning, film-school-worthiness, canonical importance, or Criterion status. Those are derived signals (computed from user behavior, critical consensus, or catalog metadata) or externally sourced signals (e.g. a title's presence in the Criterion Collection). They are out of scope for this ontology and must not be classified alongside it.

## Fields

| Field | Cardinality | Description |
|---|---|---|
| `primary_subgenre` | exactly one | The single most useful, specific answer to "what kind of work is this?" One controlled subgenre id, or `null` if there truly isn't enough evidence. |
| `secondary_subgenre` | zero or one | An additional controlled subgenre id that further specifies the work. Must differ from `primary_subgenre`. Optional — omit (null) rather than force a weak second answer. |
| `tone_tags` | zero to three | Controlled tone ids describing the work's emotional register. |
| `pacing` | exactly one (or null) | `slow`, `moderate`, or `fast`. |

## Subgenre Vocabulary (110 terms across 15 families)

Subgenres are organized into families for readability only. The family grouping is not itself a classifiable field — only the leaf term id is used in classification output. All ids are stable and lowercase-hyphenated; do not invent new ids.

### Comedy (`comedy`)

| ID | Label | Definition |
|---|---|---|
| `romantic-comedy` | Romantic Comedy | A comedy centered on the development of a romantic relationship, typically resolving with the couple's union. |
| `dark-comedy` | Dark Comedy | Comedy that plays traditionally serious or taboo subject matter (death, illness, crime) for laughs while keeping a recognizably comic tone throughout. |
| `black-comedy` | Black Comedy | Comedy built around a bleak, morbid, or misanthropic worldview, where humor and disturbing content are inseparable rather than one offsetting the other. |
| `screwball-comedy` | Screwball Comedy | Fast-talking, farcical comedy of mismatched romantic pairs, class conflict, or social role reversal, marked by rapid-fire dialogue and escalating misunderstandings. |
| `satire` | Satire | Comedy that uses irony, exaggeration, or ridicule to critique a specific real-world target such as institutions, politics, public figures, or social norms. |
| `parody-spoof` | Parody / Spoof | Comedy built by directly imitating and exaggerating the conventions of a specific genre, film, or franchise for comic effect. |
| `workplace-comedy` | Workplace Comedy | Comedy centered on the dynamics, hierarchy, and absurdities of a specific job or workplace. |
| `coming-of-age-comedy` | Coming-of-Age Comedy | Comedy centered on a young protagonist's transition toward adulthood, told primarily through humor. |
| `buddy-comedy` | Buddy Comedy | Comedy driven by the mismatched-pair dynamic between two (or more) friends or partners thrown together by circumstance. |
| `breakup-comedy` | Breakup Comedy | Comedy centered on the end of a romantic relationship and its comic fallout. |
| `sex-comedy` | Sex Comedy | Comedy in which sexual pursuit, desire, or awkwardness is the primary comic engine. |
| `stoner-comedy` | Stoner Comedy | Comedy centered on drug use, typically cannabis, as a defining lifestyle and source of episodic, low-stakes misadventure. |
| `absurdist-comedy` | Absurdist Comedy | Comedy built on illogical premises or a fundamentally irrational world, where the humor comes from that irrationality itself. |
| `mockumentary` | Mockumentary | Comedy that adopts documentary form (interviews, handheld footage, narration) as a fictional device. |

### Drama (`drama`)

| ID | Label | Definition |
|---|---|---|
| `family-drama` | Family Drama | Drama centered on the relationships, conflicts, and obligations within a family unit. |
| `relationship-drama` | Relationship Drama | Drama centered on an intimate relationship between a small number of characters, without primarily being a romance in the genre sense. |
| `psychological-drama` | Psychological Drama | Drama centered on a character's internal mental or emotional state as the primary source of conflict. |
| `legal-drama` | Legal Drama | Drama centered on the practice of law, including litigation, legal ethics, or the justice system, told from a legal-professional point of view. |
| `political-drama` | Political Drama | Drama centered on the pursuit, exercise, or consequences of political power. |
| `historical-drama` | Historical Drama | Drama set in a clearly defined past era where the historical setting materially shapes the story (period drama). |
| `social-drama` | Social Drama | Drama centered on a social issue or systemic condition, such as poverty, addiction, or discrimination, and its effect on characters' lives. |
| `workplace-drama` | Workplace Drama | Drama centered on the stakes, hierarchy, and pressures of a specific job or workplace, without comic framing. |
| `coming-of-age-drama` | Coming-of-Age Drama | Drama centered on a young protagonist's transition toward adulthood or self-understanding. |
| `sports-drama` | Sports Drama | Drama centered on athletic competition, training, or a sports institution as the primary stakes. |
| `showbiz-drama` | Showbiz Drama | Drama centered on the entertainment industry and the toll or mechanics of fame and creative work. |

### Crime (`crime`)

| ID | Label | Definition |
|---|---|---|
| `crime-drama` | Crime Drama | Drama centered on the commission, investigation, or consequences of crime, without being primarily a thriller, procedural, or heist. |
| `gangster` | Gangster | Story centered on the rise and/or fall of an individual criminal figure within a criminal underworld or hierarchy. |
| `heist` | Heist | Story structured around the planning and execution of a theft or robbery. |
| `detective` | Detective | Story centered on an investigator, professional or amateur, solving a case, with the investigative process as the narrative engine. |
| `police-procedural` | Police Procedural | Story centered on law enforcement's routine methods and casework, emphasizing process over the personal drama of any one case. |
| `neo-noir` | Neo-Noir | Contemporary story that consciously adopts classic film-noir conventions, such as moral ambiguity and a shadowy visual and narrative tone, in a modern or non-period setting. |
| `courtroom-crime` | Courtroom Crime | Crime story structured primarily around trial proceedings rather than investigation. |
| `organized-crime` | Organized Crime | Story centered on the operations, politics, or culture of a criminal organization as an institution, distinct from a single gangster's rise-and-fall arc. |

### Thriller (`thriller`)

| ID | Label | Definition |
|---|---|---|
| `psychological-thriller` | Psychological Thriller | Thriller driven by uncertainty about a character's mental state, perception, or trustworthiness rather than by physical danger alone. |
| `crime-thriller` | Crime Thriller | Thriller organized around a criminal act or criminal antagonist, prioritizing suspense and pursuit over procedural or investigative detail. |
| `political-thriller` | Political Thriller | Thriller in which political power, conspiracy, or state institutions create the central danger. |
| `conspiracy-thriller` | Conspiracy Thriller | Thriller centered on a protagonist uncovering a hidden, coordinated plot, typically involving institutions working against them. |
| `espionage-thriller` | Espionage Thriller | Thriller centered on intelligence work, spies, or covert operations. |
| `erotic-thriller` | Erotic Thriller | Thriller in which sexual desire or a sexual relationship is the mechanism that generates danger or suspense. |
| `tech-thriller` | Tech Thriller | Thriller in which technology, such as surveillance, AI, hacking, or engineered systems, is the central source of threat or the primary tool of danger. |
| `survival-thriller` | Survival Thriller | Thriller centered on a character's struggle to physically survive a hostile environment or antagonist, with escape or endurance as the core stakes. |
| `revenge-thriller` | Revenge Thriller | Thriller structured around a protagonist's pursuit of retribution against those who wronged them. |

### Action (`action`)

| ID | Label | Definition |
|---|---|---|
| `action-thriller` | Action-Thriller | Action-forward story that also sustains thriller-level suspense and stakes, blending set-piece spectacle with mounting tension. |
| `martial-arts` | Martial Arts | Action centered on hand-to-hand combat systems or disciplines as a primary visual and narrative focus. |
| `adventure-action` | Adventure Action | Action built around a journey, quest, or exploration, prioritizing spectacle and momentum over emotional interiority. |
| `military-action` | Military Action | Action centered on organized armed forces, combat units, or military operations. |
| `superhero` | Superhero | Action centered on a character or team with extraordinary powers or abilities operating within a superhero mythology or universe. |
| `revenge-action` | Revenge Action | Action structured around a protagonist's violent retribution against those who wronged them, with action set pieces as the primary means of pursuing it. |
| `disaster` | Disaster | Action centered on characters surviving a large-scale catastrophic event, natural or man-made. |

### Horror (`horror`)

| ID | Label | Definition |
|---|---|---|
| `psychological-horror` | Psychological Horror | Horror that generates fear through mental deterioration, unreliable perception, or dread rather than explicit monsters or violence. |
| `supernatural-horror` | Supernatural Horror | Horror in which the threat originates from a paranormal or otherworldly force, such as ghosts, demons, or possession. |
| `folk-horror` | Folk Horror | Horror rooted in isolated communities, rural landscapes, or pre-modern belief systems and rituals. |
| `body-horror` | Body Horror | Horror centered on the graphic transformation, mutilation, or violation of the human body. |
| `slasher` | Slasher | Horror structured around a killer stalking and murdering a sequence of victims, typically with a signature method or weapon. |
| `creature-feature` | Creature Feature | Horror centered on a monster or creature as the primary physical antagonist. |
| `gothic-horror` | Gothic Horror | Horror built on atmosphere, decayed grandeur, and classic gothic settings such as mansions, castles, and family curses, over graphic violence. |
| `cosmic-horror` | Cosmic Horror | Horror centered on incomprehensible, vast, or indifferent forces beyond human understanding or control. |
| `horror-comedy` | Horror-Comedy | Horror that plays its scares for comic effect, alternating or blending fear and humor as co-equal tones. |
| `survival-horror` | Survival Horror | Horror centered on a character's physical struggle to survive a hostile threat or environment, emphasizing endurance over investigation. |
| `sci-fi-horror` | Sci-Fi Horror | Horror in which the source of threat is grounded in science-fiction premises, such as aliens, experiments, or technology gone wrong. |

### Science Fiction (`science-fiction`)

| ID | Label | Definition |
|---|---|---|
| `hard-sci-fi` | Hard Sci-Fi | Science fiction that emphasizes scientific plausibility and technical accuracy as central to the story's logic and stakes. |
| `dystopian-sci-fi` | Dystopian Sci-Fi | Science fiction set in an oppressive or degraded future society, centered on that society's control over its people. |
| `cyberpunk` | Cyberpunk | Science fiction combining advanced technology, often digital or cybernetic, with social decay, corporate power, and a stylized urban underworld. |
| `space-opera` | Space Opera | Science fiction centered on large-scale adventure across space, typically with sweeping stakes, multiple factions, or galactic scope. |
| `alien-first-contact` | Alien First Contact | Science fiction centered on humanity's encounter or communication with a non-human extraterrestrial intelligence. |
| `time-travel` | Time Travel | Science fiction structured around movement between different points in time as the central narrative mechanic. |
| `tech-sci-fi` | Tech Sci-Fi | Science fiction centered on the near-term social or personal consequences of a specific emerging technology. |
| `post-apocalyptic` | Post-Apocalyptic | Science fiction set after a civilization-ending event, centered on survival in its aftermath. |

### Fantasy (`fantasy`)

| ID | Label | Definition |
|---|---|---|
| `epic-fantasy` | Epic Fantasy | Fantasy set in an original secondary world with large-scale stakes, sprawling scope, and mythic structure. |
| `dark-fantasy` | Dark Fantasy | Fantasy that foregrounds horror elements, moral bleakness, or menace within its fantastical world. |
| `urban-fantasy` | Urban Fantasy | Fantasy in which magical or mythical elements exist within a recognizably contemporary, real-world setting. |
| `magical-realism` | Magical Realism | Story grounded in a realistic, everyday setting where a small number of magical elements are treated as unremarkable by the characters. |
| `fairy-tale-fable` | Fairy Tale / Fable | Story structured as or directly adapted from a traditional fairy tale, fable, or folk tale, retaining that form's moral or symbolic logic. |
| `sword-and-sorcery` | Sword and Sorcery | Fantasy centered on a physically capable individual hero or small band navigating personal-scale battles against magical or monstrous threats, prioritizing action over world-spanning stakes. |

### Romance (`romance`)

| ID | Label | Definition |
|---|---|---|
| `romantic-drama` | Romantic Drama | Drama centered on a romantic relationship where the relationship's course, not its comic potential, drives the story. |
| `period-romance` | Period Romance | Romance set in a clearly defined historical era where the setting's social conventions materially shape the relationship. |
| `tragic-romance` | Tragic Romance | Romance in which the central relationship is defined by its failure, loss, or the death or separation of one or both partners. |
| `erotic-romance` | Erotic Romance | Romance in which sexual desire and intimacy are a central, foregrounded element of the relationship's portrayal. |

### Mystery (`mystery`)

| ID | Label | Definition |
|---|---|---|
| `murder-mystery` | Murder Mystery | Mystery organized around solving a specific killing, with the culprit's identity as the central question. |
| `whodunit` | Whodunit | Mystery structured as a formal puzzle with a defined set of suspects, clues, and a fair-play reveal of the culprit. |
| `mystery-thriller` | Mystery-Thriller | Mystery that sustains thriller-level tension and danger alongside its central puzzle, rather than proceeding at a purely investigative pace. |
| `puzzle-mystery` | Puzzle Mystery | Mystery centered on solving a complex structural or intellectual puzzle, not necessarily a crime, as the core engine. |

### War (`war`)

| ID | Label | Definition |
|---|---|---|
| `combat-film` | Combat Film | War story centered on frontline combat and its physical experience. |
| `anti-war-film` | Anti-War Film | War story whose primary purpose is to critique the morality, cost, or futility of war itself. |
| `pow-escape` | POW / Escape | War story centered on captivity and a prisoner-of-war's attempt to escape or endure imprisonment. |
| `home-front-war-drama` | Home-Front War Drama | War story centered on civilians or communities affected by a war occurring elsewhere. |

### Western (`western`)

| ID | Label | Definition |
|---|---|---|
| `traditional-western` | Traditional Western | Western that upholds classic genre conventions, such as clear moral lines, frontier justice, and iconic Old West setting, without substantially subverting them. |
| `revisionist-western` | Revisionist Western | Western that consciously subverts or critiques classic genre conventions, complicating its moral framework or mythology. |
| `neo-western` | Neo-Western | Western sensibility and themes relocated to a modern-day setting. |

### Musical (`musical`)

| ID | Label | Definition |
|---|---|---|
| `traditional-musical` | Traditional Musical | Story in which characters break into song-and-dance numbers as a core, integrated storytelling device. |
| `music-drama` | Music Drama | Drama centered on musicians, music-making, or the music industry, without characters performing full musical numbers as a narrative device. |
| `music-comedy` | Music Comedy | Comedy centered on musicians, music-making, or the music industry, without characters performing full musical numbers as a narrative device. |

### Documentary (`documentary`)

| ID | Label | Definition |
|---|---|---|
| `investigative-documentary` | Investigative Documentary | Documentary structured around uncovering previously hidden or disputed facts about its subject. |
| `biography-profile-documentary` | Biography / Profile Documentary | Documentary centered on the life story of a single person or a small, defined group of people. |
| `political-social-documentary` | Political / Social Documentary | Documentary centered on a political issue, policy, or broad social phenomenon. |
| `nature-documentary` | Nature Documentary | Documentary centered on the natural world, wildlife, or the environment. |
| `music-documentary` | Music Documentary | Documentary centered on a musician, band, or music scene. |
| `sports-documentary` | Sports Documentary | Documentary centered on an athlete, team, or sporting event or era. |
| `true-crime-documentary` | True Crime Documentary | Documentary centered on a real crime, investigation, or criminal case. |

### TV-Specific (`tv-specific`)

| ID | Label | Definition |
|---|---|---|
| `sitcom` | Sitcom | Half-hour-scale scripted comedy built around a recurring ensemble and self-contained episodic situations, with a stable premise across episodes. |
| `workplace-sitcom` | Workplace Sitcom | Sitcom whose recurring setting and ensemble are organized around a specific workplace. |
| `family-sitcom` | Family Sitcom | Sitcom whose recurring setting and ensemble are organized around a family household. |
| `dramedy` | Dramedy | Series that deliberately sustains both comedic and dramatic registers as co-equal tones across episodes, rather than one dominating. |
| `procedural` | Procedural | Episodic series structured around a self-contained case, incident, or problem resolved largely within each episode. |
| `prestige-drama` | Prestige Drama | Serialized hour-long drama with heightened production values and creative ambition, built for sustained arcs across a season rather than episodic cases. |
| `soap-serial-drama` | Soap / Serial Drama | Serialized drama centered on interpersonal melodrama across an ensemble, with long-running, heavily plotted relationship arcs. |
| `anthology` | Anthology | Series in which each season or episode tells a self-contained story with a new setting and/or cast, connected by theme rather than continuing plot. |
| `sketch-comedy` | Sketch Comedy | Series built from a sequence of short, unconnected comedic sketches rather than a continuing story or ensemble situation. |
| `reality-competition` | Reality Competition | Unscripted series structured around contestants competing toward elimination or a defined prize. |
| `docuseries` | Docuseries | Multi-episode nonfiction series following a real subject, event, or investigation across a season. |

## Tone Vocabulary (25 terms)

Tone tags describe the emotional register of the work. Definitions below are written to be mutually distinguishing — pay particular attention to the *What it is NOT* line for each term, which calls out the term it is most often confused with.

### Warm (`warm`)

**Definition:** Conveys genuine affection, kindness, or emotional closeness between characters; the viewer feels comforted by the relationships on screen.

**What it is NOT:** Not the same as uplifting: warm describes the emotional temperature of relationships, not the trajectory or resolution of the story. A story can be warm and still end sadly.

**Anchor titles:** Paddington 2, Ted Lasso, The Great British Bake Off

### Bittersweet (`bittersweet`)

**Definition:** Blends genuine happiness or resolution with an equally genuine sense of loss, so that neither feeling cancels the other out.

**What it is NOT:** Not simply a sad story with a happy ending: in bittersweet work the joy and the loss are both fully present at once, rather than joy following after sadness has passed.

**Anchor titles:** Past Lives, Her, Lost in Translation

### Melancholic (`melancholic`)

**Definition:** A persistent, low-intensity sadness or wistfulness that colors the work without dominating it or removing hope entirely.

**What it is NOT:** Distinct from bleak: melancholic sadness is reflective and survivable, and can coexist with warmth or gentle humor; bleak withholds hope almost entirely.

**Anchor titles:** Paterson, Columbus, Aftersun

### Bleak (`bleak`)

**Definition:** Portrays a world or outcome with little to no meaningful hope, comfort, or redemption; despair is the dominant, unresolved note.

**What it is NOT:** Distinct from melancholic: bleak work offers little or no relief from despair, where melancholic allows sadness to coexist with warmth, humor, or reflection.

**Anchor titles:** Requiem for a Dream, The Road, Chernobyl

### Uplifting (`uplifting`)

**Definition:** Leaves the viewer with a sense of hope, affirmation, or emotional lift, typically through the story's trajectory or resolution.

**What it is NOT:** Not the same as warm: uplifting describes the emotional arc or destination of the story, not the texture of relationships throughout it. A hard-won triumph can be uplifting without being warm.

**Anchor titles:** Rocky, Rudy, Ted Lasso

### Sentimental (`sentimental`)

**Definition:** Deliberately and openly appeals to tender emotion, often through music, dialogue, or framing designed to elicit feeling.

**What it is NOT:** Not neutral about its emotional intent: sentimental work wears its heartstring-pulling openly, unlike warm or bittersweet work that earns emotion more obliquely.

**Anchor titles:** The Notebook, Marley & Me

### Playful (`playful`)

**Definition:** Light, mischievous, and energetic in spirit; takes evident delight in its own game, characters, or premise.

**What it is NOT:** Not the same as absurdist: playful describes an inviting, high-spirited energy, while absurdist specifically involves illogic or a fundamentally irrational premise.

**Anchor titles:** Paddington 2, Game Night

### Raunchy (`raunchy`)

**Definition:** Explicit, crude, or graphic in its sexual or bodily humor, foregrounded as a deliberate comic engine rather than incidental content.

**What it is NOT:** Not simply 'contains adult content': raunchy specifically means crude sexual or bodily material is a deliberate comic device, not background material in a serious drama.

**Anchor titles:** Superbad, Bridesmaids

### Deadpan (`deadpan`)

**Definition:** Delivered with flat, affectless line readings or reactions, where the humor comes from the gap between that flat delivery and outrageous or absurd content.

**What it is NOT:** Distinct from wry: deadpan is a performance or delivery style (flat affect), while wry is a narrative attitude of dry, knowing understatement that doesn't require flat performance.

**Anchor titles:** Fargo, What We Do in the Shadows, Napoleon Dynamite

### Absurdist (`absurdist`)

**Definition:** Built on illogical premises or a fundamentally irrational world where normal cause-and-effect or social logic doesn't apply.

**What it is NOT:** Not the same as playful: absurdist is about the internal logic, or lack of it, governing the story's world, not simply a lighthearted mood.

**Anchor titles:** Rick and Morty, Everything Everywhere All at Once

### Satirical (`satirical`)

**Definition:** Critiques a specific real-world target, such as institutions, public figures, ideologies, or social norms, through irony or exaggeration.

**What it is NOT:** Distinct from cynical: satirical implies an active, pointed critique aimed at a specific target, while cynical is a general distrustful stance with no particular object of ridicule.

**Anchor titles:** The Daily Show, Don't Look Up, Veep

### Wry (`wry`)

**Definition:** A dry, understated, knowing sense of humor communicated through attitude and tone rather than performance style or premise.

**What it is NOT:** Distinct from deadpan: wry is an authorial or narrative attitude of dry amusement, while deadpan refers specifically to flat delivery or performance.

**Anchor titles:** Fleabag, Election

### Tense (`tense`)

**Definition:** Sustains anticipatory anxiety about what might happen next; the viewer feels suspense about an uncertain outcome.

**What it is NOT:** Distinct from menacing: tense is about uncertainty and anticipation, asking whether something bad will happen, while menacing is about the felt presence of a specific threatening force, even without uncertainty about the outcome.

**Anchor titles:** Uncut Gems, No Country for Old Men

### Menacing (`menacing`)

**Definition:** Conveys the felt presence of a specific threatening force, person, or entity, regardless of whether the outcome is in doubt.

**What it is NOT:** Distinct from tense: menacing describes a quality radiating from a person, place, or force, not the viewer's uncertainty about the plot's outcome.

**Anchor titles:** No Country for Old Men, The Shining

### Unsettling (`unsettling`)

**Definition:** Produces a diffuse sense of wrongness or discomfort that resists clear explanation, unmoored from a specific identifiable threat.

**What it is NOT:** Distinct from menacing: unsettling doesn't require a locatable source of danger; the discomfort itself, not a specific threat, is the point.

**Anchor titles:** The Lighthouse, Under the Skin

### Visceral (`visceral`)

**Definition:** Produces an immediate, bodily reaction in the viewer through violence, physical intensity, or sensory extremity.

**What it is NOT:** Not simply 'intense' in an abstract sense: visceral specifically implies a physical, gut-level reaction rather than an intellectual or purely emotional one.

**Anchor titles:** Mad Max: Fury Road, Uncut Gems

### Cerebral (`cerebral`)

**Definition:** Prioritizes ideas, logic, or intellectual engagement, asking the viewer to actively think through concepts or implications.

**What it is NOT:** Distinct from enigmatic: cerebral work can be fully explicable and resolved, just demanding, while enigmatic work specifically withholds clear meaning or resolution.

**Anchor titles:** Arrival, Primer

### Enigmatic (`enigmatic`)

**Definition:** Deliberately withholds clear meaning, explanation, or resolution, leaving significant ambiguity intact by design.

**What it is NOT:** Distinct from cerebral: enigmatic is defined by unresolved ambiguity itself, not by the amount of thinking required. A work can be cerebral and still fully resolve its ideas.

**Anchor titles:** Mulholland Drive, Under the Skin

### Meditative (`meditative`)

**Definition:** Unhurried and contemplative, favoring stillness, reflection, or atmosphere over incident, inviting the viewer to sit with a mood or idea.

**What it is NOT:** Not the same as slow pacing alone: meditative describes an emotional and tonal register of quiet reflection, though it frequently co-occurs with slow pacing.

**Anchor titles:** Paterson, Columbus

### Dreamlike (`dreamlike`)

**Definition:** Evokes the logic, imagery, or atmosphere of a dream: fluid, associative, and not bound by strict realism or causality.

**What it is NOT:** Distinct from enigmatic: dreamlike is about atmosphere and the loosening of realistic logic, not necessarily about withholding meaning or resolution.

**Anchor titles:** Mulholland Drive, The Tree of Life

### Gritty (`gritty`)

**Definition:** Depicts its world with unvarnished, tactile realism: grime, hardship, and consequence rendered without glamorization.

**What it is NOT:** Not the same as bleak: gritty is about the texture and realism of the depiction, not the presence or absence of hope in the story's outcome.

**Anchor titles:** The Wire, Uncut Gems

### Stylized (`stylized`)

**Definition:** Foregrounds a distinctive, heightened visual or formal aesthetic that departs from naturalism as a deliberate authorial choice.

**What it is NOT:** Not the same as dreamlike: stylized refers to a consciously crafted aesthetic choice, which can be sharp and precise rather than fluid or associative.

**Anchor titles:** The Grand Budapest Hotel, Kill Bill

### Earnest (`earnest`)

**Definition:** Sincere and direct in its emotional or moral intent, without irony, cynicism, or a protective wink to the audience.

**What it is NOT:** Distinct from sentimental: earnest describes sincerity of intent, not the deployment of tear-jerking technique. A work can be earnest without being emotionally manipulative.

**Anchor titles:** Paddington 2, Ted Lasso

### Cynical (`cynical`)

**Definition:** Assumes and portrays self-interested or corrupt motives as the default, distrustful of institutions, sincerity, or good intentions.

**What it is NOT:** Distinct from satirical: cynical is a general worldview or stance, while satirical requires an active, pointed critique of a specific target.

**Anchor titles:** Nightcrawler, Succession

### Romantic (`romantic`)

**Definition:** Foregrounds longing, attraction, or love as an idealized emotional force driving the work's central feeling.

**What it is NOT:** Not the same as sentimental: romantic describes the specific object of feeling, love or desire, while sentimental describes an emotionally manipulative technique that can apply to any subject.

**Anchor titles:** Before Sunrise, Call Me by Your Name, Past Lives

## Pacing

| ID | Definition |
|---|---|
| `slow` | Deliberately allows substantial time between major narrative developments; patience is a defining part of the viewing experience. |
| `moderate` | Neither deliberate patience nor sustained momentum is a defining characteristic. |
| `fast` | Frequent narrative developments, action, jokes, revelations, scene changes, or escalating events create sustained forward momentum. |

## Versioning

This is v0.1. Gaps exposed by the 100-title pilot sample are documented separately in `gaps-v0.1.md` in this directory as proposed additions for a future version. No uncontrolled terms are added silently — any addition requires a version bump and explicit documentation.
