# Ontology v0.1 — Gaps Exposed by the 100-Title Pilot Sample

This document records vocabulary gaps observed while building `classification-input.json` from
`curation/pilot/sample-100.json`. These are **proposed additions for a future ontology version**
(e.g. v0.2). Nothing here is added to `ontology.json` — v0.1's controlled vocabulary is unchanged.
When classifying the pilot sample against v0.1, titles affected by these gaps should be classified
with the closest reasonable existing term, or `null` if nothing fits, per the classification prompt's
rules.

## 1. Animation is not represented as a family or a cross-cutting label

14 of the 100 sampled titles (`Avatar Aang: The Last Airbender`, `Spider-Man: Across the Spider-Verse`,
`The Super Mario Galaxy Movie`, `Snoopy Presents: There's No Place Like Home, Snoopy`,
`Miraculous: Tales of Ladybug & Cat Noir`, `The Simpsons`, `Rick and Morty`,
`Ghost in the Shell: Stand Alone Complex`, `Family Guy`, `X-Men '97`, `Mushoku Tensei: Jobless
Reincarnation`, `Pokémon`, `Teen Titans Go!`, `Bleach`) carry the TMDB `Animation` genre — 14% of the
sample. v0.1 treats subgenre as content-based (what the story is), not medium-based (how it's made),
so most of these titles still map reasonably onto existing terms (e.g. `X-Men '97` → `superhero`,
`Rick and Morty` → `absurdist-comedy`). But two sub-cases are not well served:

- **Anime / isekai-adventure serials** (`Mushoku Tensei: Jobless Reincarnation`, `Bleach`, `Pokémon`)
  have a distinct set of genre conventions (isekai reincarnation, shonen tournament arcs, episodic
  monster-collecting) that don't map cleanly onto `space-opera`, `adventure-action`, or
  `sword-and-sorcery` without losing meaningful specificity.
- **All-ages animated family adventure** (`The Super Mario Galaxy Movie`, `Snoopy Presents...`)
  sits awkwardly between `fairy-tale-fable`, `adventure-action`, and `family-sitcom`/`family-drama`
  (the latter two are TV-oriented and tonally wrong for a family-friendly theatrical adventure).

**Proposed addition:** an `anime` or `animated-family-adventure` term (family TBD), or alternatively a
non-classified `medium` facet (e.g. `is_animated: boolean`) kept separate from subgenre, so classifiers
aren't forced to choose between medium and content-based specificity.

## 2. Talk shows / late-night and news-satire formats have no home

5 titles are TMDB-genred `Talk` and/or `News`: `Watch What Happens Live with Andy Cohen`,
`The Tonight Show Starring Jimmy Fallon`, `The Late Show with Stephen Colbert`,
`Late Night with Seth Meyers`, and `The Daily Show`. None of the current TV-specific terms
(`sitcom`, `dramedy`, `procedural`, `prestige-drama`, `soap-serial-drama`, `anthology`,
`sketch-comedy`, `reality-competition`, `docuseries`) accurately describes a recurring
host-driven talk/interview or news-satire format. `satire` (Comedy family) is a reasonable
approximation for `The Daily Show` specifically, but the four late-night interview/variety shows
have no reasonable existing match.

**Proposed addition:** a `talk-show` and/or `variety-show` term under TV-specific.

## 3. No general non-documentary biopic term

`historical-drama` and `showbiz-drama` partially cover biographical films/series, but there is no
general `biopic` term for a drama centered on a real person's life outside a historical-era or
showbiz-industry framing (e.g. a contemporary-set biographical drama). Not clearly exposed by a
specific title in this sample, but adjacent to the biography-profile-documentary gap below and
worth flagging for v0.2 review.

## 4. Biography-adjacent overlap between documentary and scripted drama

No direct conflict was observed in this sample, but `biography-profile-documentary` (Documentary
family) and a potential future scripted `biopic` term (see #3) will need explicit disambiguation
guidance once both exist, since classifiers will need to know which applies to a scripted
dramatization of a real life vs. a nonfiction documentary about the same subject.

## Summary

| Gap | Titles affected in sample | Suggested v0.2 action |
|---|---|---|
| Anime / isekai-adventure specificity | 3 | Add `anime` or similar term, or a separate medium facet |
| Animated family adventure specificity | 2 | Add term, or fold into a medium facet |
| Talk show / variety format | 4 | Add `talk-show` and/or `variety-show` under TV-specific |
| News-satire format | 1 | Confirm `satire` is sufficient, or add `news-satire` |
| General (non-historical, non-showbiz) biopic | 0 observed, flagged proactively | Review in v0.2 |
