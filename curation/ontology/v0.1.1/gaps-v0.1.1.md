# Ontology v0.1.1 — Structural Gap Review (100-Title Pilot Sample)

This is a **structural** review only — no titles were classified. It checks whether a reasonable
`primary_subgenre` appears to exist for every title in `curation/pilot/sample-100.json`, given the
v0.1.1 vocabulary, and reports any categories that remain a poor fit.

## Method

Every one of the 100 titles' TMDB genre combinations was reviewed against the v0.1.1 subgenre
families (see the table below for the full set of genre-combination buckets present in the sample).
The two gaps that motivated this patch — animation/anime (14 titles) and late-night talk/news-satire
(5 titles) — are now covered; see `ontology.md` for the mapping principle and the specific new terms.

## Remaining gap

**Puppet-based educational children's programming.** `Sesame Street` (tv, genres `Kids`, `Comedy`)
is the one title in the sample with no accurate structural fit. It is not scripted narrative comedy
in the sense any Comedy-family term assumes (no plot, no ensemble storyline), it is not `sitcom` or
`family-sitcom` (no continuing story), and it is not `docuseries` or any Documentary-family term
(it's fiction/puppetry, not nonfiction). The closest approximations (`family-sitcom`,
`sketch-comedy`) would misrepresent the format.

**Disposition:** do not add a new term for this. One title in a 100-title pilot does not justify
expanding the controlled vocabulary — that threshold is what caused the animation and talk-show
gaps to be worth fixing (14 and 5 titles respectively) and is not met here. When this title (or
similar children's edutainment programming) is classified in Pass 1, `primary_subgenre: null` is
the correct, honest answer, or `family-sitcom` may be used as a loose best-effort approximation with
low confidence — the classification prompt permits `null` for exactly this situation. If a future
pilot sample surfaces more titles like this, a `childrens-edutainment` or similar TV-specific term
should be considered for v0.1.2+.

## No other structural gaps found

Every other TMDB genre-combination bucket present in the 100-title sample (e.g. `Action, Adventure,
Science Fiction`; `Crime, Drama`; `Crime, Drama, Mystery`; `Comedy, Drama, Romance`; `Action, History,
War`; `Drama, War & Politics`) maps onto at least one existing v0.1 or v0.1.1 subgenre family with a
plausible primary. This does not guarantee every individual title will get a strong, specific
classification during Pass 1 — some titles will legitimately land on a generic primary (e.g.
`crime-drama`) rather than a highly specific one, and some may still warrant `null` if the overview
and metadata are too thin. That is expected and acceptable; the ontology's job is to make a
reasonable classification *possible*, not to guarantee a specific one for every title.
