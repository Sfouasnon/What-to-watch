# What to Watch — Current Style Book

Implementation baseline: 2026-08-15, commit `7048f1f`  
Surfaces: responsive web/PWA, account page, Fire TV/Android TV web shell, native TV launcher artwork

This document describes the product as currently implemented. It is a revision baseline, not a claim that every current decision is final. Items marked **Current inconsistency** should be resolved deliberately rather than copied automatically.

## 1. Brand in one paragraph

What to Watch is a personal movie concierge with the atmosphere of a thoughtful film journal. It should feel editorial, warm, quiet, intelligent, and selective—not like a streaming storefront, social feed, or chatbot. The product narrows the evening to ten considered recommendations, explains why they fit, and respects the viewer's subscriptions, mood, and private taste profile.

Primary product line:

> Ten considered picks. One good night.

Supporting proposition:

> Tell us the mood. Get ten considered picks—not another endless feed.

## 2. Design principles

1. **Editorial before algorithmic.** Recommendations should resemble a well-considered program note, not a machine-generated scorecard.
2. **One calm decision at a time.** Screens should have a clear question, a restrained set of choices, and one obvious next action.
3. **Dark, warm, cinematic.** Near-black fields, ivory type, copper/gold accents, restrained neutral panels, and film artwork carry the experience.
4. **Hierarchy through typography and space.** Large serif questions and titles lead; compact sans-serif labels organize.
5. **Evidence without dashboard noise.** Match, availability, cast context, and rationale are visible, but secondary to the title and recommendation story.
6. **Private by design.** Avoid social-feed patterns, notification pressure, unread counts, or language suggesting surveillance.
7. **Finite, not addictive.** The product offers ranked sets of ten. Do not introduce infinite scroll or engagement loops.
8. **Platform-native interaction.** Touch targets and bottom navigation serve phones; D-pad focus, overscan safety, and large type serve televisions.

## 3. Identity and logo

### Name and casing

- Product name: `What to Watch`
- Display wordmark: `WHAT TO WATCH`
- Sentence case is preferred in prose.
- All-caps is reserved for the wordmark, kickers, compact metadata, and navigational labels.

### Primary icon

The current primary icon is a dark rounded square containing a hand-drawn copper `W` and a small ivory dot in the upper-right.

- Canvas: `512 × 512`
- Base: `#090A0B`
- Inner radial field: `#2B2118` → `#11110F` → `#080908`
- Copper stroke: `#D09454` → `#A65D2E` → `#57301F`
- Accent dot: `#F2E8D9`
- Inner keyline: `#D09454` at 32% opacity
- Shape character: rounded, gestural, slightly imperfect, premium rather than technological

Canonical source: [`public/icons/icon-source.svg`](public/icons/icon-source.svg)  
Production PNG: [`public/icons/icon-512.png`](public/icons/icon-512.png)  
TV launcher PNG: [`android-tv/app/src/main/res/drawable-nodpi/what_to_watch_logo.png`](android-tv/app/src/main/res/drawable-nodpi/what_to_watch_logo.png)

### Header mark

The current web and TV page headers use a simplified serif `W` inside a thin square keyline, followed by `WHAT TO WATCH` in tracked sans-serif capitals.

**Current inconsistency:** the native icon uses the finished gestural copper `W`, while web headers use a typeset boxed `W`. A revision may unify these, but should not invent a third mark.

### Logo rules

- Preserve generous clear space around the mark.
- Keep it on near-black or dark neutral fields.
- Do not recolor it with saturated yellow, neon orange, or cool metallic effects.
- Do not add a play triangle, film reel, television outline, or streaming-service motif.
- Do not stretch, bevel, emboss, or apply a heavy glow.

## 4. Core visual language

The visual system combines:

- near-black backgrounds;
- warm ivory foreground type;
- copper/gold as a selective action and emphasis color;
- neutral charcoal panels with low-contrast keylines;
- large classic serif display type;
- compact, highly tracked sans-serif labels;
- rounded rectangles and circles, used with restraint;
- poster/backdrop artwork with dark gradient shading;
- subtle depth rather than glass-heavy or glossy effects.

Avoid blue-black sci-fi styling, saturated brand colors, dense carousels, gratuitous gradients, and excessive pill-shaped UI.

## 5. Color system

### Responsive web/PWA tokens

| Role | Token | Value | Use |
|---|---|---:|---|
| Background | `--ink` | `#090A0B` | App and page background |
| Soft background | `--ink-soft` | `#111315` | Full-height sheets and details |
| Panel | `--panel` | `#151719` | Cards, search, list rows |
| Raised panel | `--panel-raised` | `#1B1E20` | Elevated surfaces |
| Hairline | `--line` | `rgba(244,239,228,.12)` | Dividers and quiet borders |
| Strong hairline | `--line-strong` | `rgba(244,239,228,.22)` | Inputs and active structure |
| Primary foreground | `--paper` | `#F0ECE3` | Headings and important copy |
| Muted foreground | `--muted` | `#9C9C96` | Secondary copy |
| Bright muted | `--muted-bright` | `#B9B8B0` | Supporting editorial copy |
| Accent | `--accent` | `#D6AA63` | Primary actions and selected details |
| Deep accent | `--accent-deep` | `#A87A39` | Darker copper emphasis |
| Text on accent | `--accent-ink` | `#16110B` | Text/icons on gold buttons |
| Success | `--green` | `#8BA88F` | Completed or trusted states |
| Danger | `--danger` | `#D78A83` | Destructive actions only |

The app shell adds only a very subtle warm radial glow: `rgba(214,170,99,.055)`. Selected surfaces typically use the accent at 8–10% opacity rather than a solid fill.

### Television tokens

| Role | Value | Use |
|---|---:|---|
| TV background | `linear-gradient(90deg, #030303 0%, #111111 48%, #3B3B3B 100%)` | Default left-to-right screen field |
| TV panel | `#1D1D1D` | Choice and provider cards |
| TV raised panel | `#303030` | Brighter panel state |
| TV paper | `#FFF8E9` | Large display type and controls |
| TV muted | `#CEC6B8` | Supporting copy |
| TV accent fallback | `#C99745` | Solid fallback for older WebViews |
| TV gold | `linear-gradient(90deg, #86531E 0%, #D6A955 44%, #F0D084 57%, #A96727 100%)` | Primary actions, profile medallions, supported gold type |
| TV focus edge | `#D2A34F` | Six-pixel D-pad focus outline |

### Gold rendering rule

Televisions must not rely on a single bright yellow. Use explicit sRGB stops—not `color-mix()`, OKLCH, filters, or blend modes—for critical gold rendering. Gold text must retain `#C99745` as its fallback and apply gradient clipping only inside a supported feature query. Large gold surfaces should visibly move from bronze through a restrained highlight back to copper.

## 6. Typography

### Families

| Role | Stack |
|---|---|
| Interface/body | Manrope, `Avenir Next`, Helvetica, Arial, sans-serif |
| Web display/editorial | `Iowan Old Style`, `Palatino Linotype`, `Book Antiqua`, Georgia, serif |
| TV display fallback | Georgia, serif |

Manrope is loaded through Next's font system. The display face currently uses system fonts; therefore line breaks can vary by platform.

### Typographic character

- Display type is classic, literary, and lightly weighted (`400`).
- Major headings use tight tracking around `-0.045em` and line-height around `.94–.98`.
- Editorial explanation copy may use the serif at a relaxed `1.5–1.6` line-height.
- Interface copy uses Manrope with clear weight contrast.
- Kickers are small, bold, uppercase, and widely tracked (`.18–.20em`).
- Metadata is compact, uppercase, and separated with centered dots.
- Avoid bold serif headings, condensed fonts, geometric display sans-serifs, and novelty cinema typefaces.

### Typical web scale

- Home hero: `clamp(3.1rem, 14vw, 6.8rem)`; wide-screen override `clamp(3.8rem, 4.5vw, 5.2rem)`
- Page hero: `clamp(3rem, 13vw, 5.6rem)`
- Result heading: `clamp(2rem, 8vw, 3.5rem)`
- Title in recommendation card: `2.3rem` hero / `1.45rem` compact
- Section heading: `1.34rem`
- Body/interface text: roughly `.62rem–.9rem` in the current mobile-first system

### Typical television scale

- Primary questions: `clamp(52px, 5.2vw, 88px)`
- Result title: `clamp(54px, 4.8vw, 84px)`
- Supporting lede: `25px`
- Kicker: `18px`
- Primary control: `22px`, weight `900`
- Mood label: `29px`
- Result synopsis: `24px`, serif

## 7. Shape, borders, and depth

### Web

- Radius small: `10px`
- Radius medium: `16px`
- Radius large: `26px`
- Recommendation cards: `22px`
- Pills are reserved for tags, filters, rental labels, and compact identity/status elements.
- Default border is a one-pixel ivory hairline at 12% opacity.
- Primary shadow: `0 26px 70px rgba(0,0,0,.38)`
- Cards more commonly use quiet depth: `0 18px 44px rgba(0,0,0,.22)`.

### Television

- Major cards: `14–18px` radius with `3px` borders.
- Buttons: `12px` radius.
- D-pad focus: `6px` gold outline, `5px` offset, secondary halo, and `1.035` scale.
- Focus must be unmistakable at viewing distance; do not reduce it to a color-only change.

## 8. Layout and spacing

### Responsive web/PWA

- Mobile-first content width: maximum `1180px`, centered.
- Standard page padding: `36px 20px 56px` plus bottom-navigation clearance.
- Bottom navigation is fixed, four equal columns, and respects iOS safe-area insets.
- Header is sticky, centered brand, with blurred near-black backing.
- At `980px+`, the home page becomes a two-column composition with a sticky editorial intro and the choice controls beside it.
- At `640px+`, profile and option grids expand; recommendation cards gain wider arrangements.
- Horizontal overflow is clipped globally; intentional rails use controlled horizontal scrolling and scroll snapping.

### Television

- Design target: 16:9, verified at a `1920 × 1080` Fire TV capture.
- Fixed header: `92px` high normally, `70px` when the reported viewport is short/narrow.
- Standard choice-screen padding: `126px 7vw 52px`.
- Compact guard activates at `max-width: 1100px` or `max-height: 700px`.
- Profile creation uses a dedicated compact layout with `44px` of reserved bottom space so action buttons remain inside the visible/overscan-safe area.
- Key action rows may wrap, but primary and secondary actions should remain visually grouped.
- Result screens use a strong left copy/right artwork split rather than a grid of posters.
- D-pad targets should be at least `64–76px` tall; large choice cards are substantially taller.

## 9. Component language

### Primary action

- Web: solid muted gold, dark text, minimum height `54px`.
- TV: metallic bronze/gold gradient, dark text, minimum height `76px` or `64px` in compact-height setup.
- One primary action per decision region.
- Hover/focus may brighten; it must not become lemon yellow.

### Secondary action

- Transparent or charcoal fill with a visible neutral border.
- Ivory text, never competing with the primary action.
- Back/Cancel actions normally include a left arrow.

### Text and ghost actions

- Muted by default, ivory on hover/focus.
- Use for clearing, editing, or low-risk navigation—not for the main decision.

### Selection cards and chips

- Resting state: charcoal or nearly transparent panel, quiet neutral border.
- Selected state: copper border, warm 8–10% fill, ivory text, and an accent icon/check.
- Television selection must also survive grayscale and viewing distance through border weight and focus geometry.

### Profile cards

- Centered identity, circular avatar/medallion, concise name and service count.
- New-profile state uses a dashed or visibly distinct boundary.
- Profile colors are muted ochre, plum, slate, and olive—not saturated avatar colors.

### Recommendation cards

- Poster/artwork leads.
- A small uppercase lane label and short editorial rationale establish why the title is present.
- Title uses the display serif.
- Match badge is circular, dark translucent, and secondary to artwork.
- Availability is separated by hairlines and names the provider and offer type.
- Compact cards reduce detail rather than shrinking every element proportionally.

### Detail view

- Backdrop fills the upper field with a strong bottom shade into `--ink-soft`.
- Title anchors the bottom of the artwork.
- Synopsis is serif and editorial.
- Credits use quiet definition-list rows.
- One full-width primary action follows the evidence.

### Inputs

- Dark panel, ivory value, muted label, visible neutral border.
- Web minimum height: `52–54px`.
- TV name input: `82px` normally / `64px` in compact-height mode.
- Focus ring must not be clipped by its container.

### Navigation

- Web/PWA: sticky top bar plus fixed four-item bottom navigation.
- TV: persistent top brand bar; D-pad, Select, and Back are the only assumed controls.
- TV focus order follows visual geometry and scrolls the next target into view.

## 10. Artwork and imagery

- Use real poster or backdrop art when available.
- Poster ratio is approximately `4 / 5.15` for the web hero recommendation; compact cards crop more tightly.
- TV results use landscape backdrops on the right, shaded into the black copy field.
- TV questionnaire artwork may use a layered, slightly rotated poster deck.
- Apply dark gradients to protect type; do not wash artwork with a uniform brand color.
- Avoid decorative stock photography, generated popcorn imagery, red curtains, ticket stubs, and literal theater clichés.
- Missing artwork falls back to a restrained charcoal field with serif title treatment.

## 11. Motion

- Page entry: `360ms ease`, opacity plus `8px` upward settle.
- Sheets/details: `260–320ms`, restrained vertical movement.
- Standard controls: `160–180ms` transitions.
- Poster hover: slow, subtle scale (`1.025`) over `700ms`.
- TV focus: immediate enough for D-pad confidence; modest scale only.
- Respect `prefers-reduced-motion` by removing nonessential animation and smooth scrolling.
- Do not add looping ambient motion, autoplay video, parallax, or attention-seeking pulses.

## 12. Accessibility and platform rules

- Foreground/background contrast must remain readable on dim and aggressively processed televisions.
- Do not encode selection or errors through color alone.
- Keep visible focus rings for keyboard and remote users.
- Minimum touch targets are approximately `42–54px`; TV targets are `64px+`.
- Respect `env(safe-area-inset-*)` on iPhone/PWA surfaces.
- Reserve a TV overscan-safe bottom area; no action may touch the physical screen edge.
- Use semantic buttons, labels, headings, radio roles, and `aria-checked` where implemented.
- Decorative artwork should have empty alt text; content-bearing posters need title-aware alternatives.
- Remote Back should move to the preceding product screen, not unexpectedly launch or exit another app.

## 13. Voice and copy

### Voice

- Informed but not academic
- Warm but not chatty
- Decisive but not absolute
- Concise, calm, and human
- Specific about evidence and uncertainty

### Preferred language

- “What are you in the mood for?”
- “What kind of night?”
- “Here’s your top ten.”
- “Why it fits”
- “Streaming availability”
- “Ten considered picks from an explainable model.”

### Avoid

- “AI-powered magic,” “perfect for you,” or unsupported certainty
- Chatbot greetings and conversational filler
- Engagement language such as “keep scrolling,” “trending now” without evidence, or “you won’t believe”
- False urgency, countdowns, streaks, or notifications
- Claims that an unverified provider link will play a title
- Long technical explanations in the primary flow

## 14. Screen inventory

### Web/PWA

- Profile picker and profile editor
- Questionnaire/onboarding and calibration
- Home: mood + kind-of-night selection
- Actor discovery
- Ranked recommendation results
- Title details
- Ratings
- Taste dashboard
- Settings: services, friends, algorithm, privacy, attributions
- Account/sign-in

### Fire TV

- Profiles
- Create profile
- Services
- Taste questionnaire
- Mood
- Kind of night/vibe
- Results deck
- Watch/provider chooser

## 15. Current inconsistencies and revision opportunities

These are observations, not automatic instructions to change them.

1. **Logo implementation:** native launcher uses the gestural copper `W`; web headers use a typeset boxed `W`.
2. **Accent families:** core web uses `#D6AA63`; account/sign-in uses the more orange `#C98143`; TV uses `#C99745` plus a metallic gradient.
3. **Display font:** web prefers Iowan/Palatino while TV declares Georgia directly, so typography varies by device.
4. **TV neutral cleanup:** the new page background and shared panels are neutral gray, while a few older borders and result overlays still retain slightly plum values such as `#504950` and `#242126`.
5. **Token architecture:** web has global design tokens; account and TV styles maintain separate local values rather than a fully shared token layer.
6. **Type scale:** current mobile interface labels are sometimes very small (`.56–.68rem`), which deserves a deliberate accessibility review.
7. **Gold text:** gradient-clipped TV kickers are device-compatible in the tested Fire TV WebView, but every future target device still needs a solid-color fallback.

## 16. Non-negotiables for a revision

- Preserve the finite ten-pick product model.
- Preserve the editorial serif/sans hierarchy unless proposing a fully reasoned replacement.
- Preserve privacy-forward, non-feed behavior.
- Preserve clear provider and rental distinctions.
- Preserve verified-vs-unverified deep-link honesty.
- Preserve D-pad focus visibility and TV safe-area handling.
- Preserve the canonical gestural copper `W` source asset.
- Keep production-critical TV colors in explicit sRGB.
- Do not introduce secrets, third-party tracking, or provider trademark misuse into visual assets.

## 17. Source-of-truth files

- Global web system: [`src/app/globals.css`](src/app/globals.css)
- Wide-screen guardrails: [`src/app/responsive.css`](src/app/responsive.css)
- Main responsive UI: [`src/components/what-to-watch-app.tsx`](src/components/what-to-watch-app.tsx)
- TV system: [`src/components/tv/what-to-watch-tv.module.css`](src/components/tv/what-to-watch-tv.module.css)
- TV UI: [`src/components/tv/what-to-watch-tv.tsx`](src/components/tv/what-to-watch-tv.tsx)
- Account-specific styling: [`src/app/account/account.module.css`](src/app/account/account.module.css)
- Font and metadata setup: [`src/app/layout.tsx`](src/app/layout.tsx)
- Canonical icon: [`public/icons/icon-source.svg`](public/icons/icon-source.svg)

## 18. Compact token payload for another LLM

```json
{
  "brand": {
    "name": "What to Watch",
    "wordmark": "WHAT TO WATCH",
    "tagline": "Ten considered picks. One good night.",
    "personality": ["editorial", "cinematic", "warm", "quiet", "intelligent", "selective"]
  },
  "web": {
    "colors": {
      "ink": "#090A0B",
      "inkSoft": "#111315",
      "panel": "#151719",
      "panelRaised": "#1B1E20",
      "paper": "#F0ECE3",
      "muted": "#9C9C96",
      "mutedBright": "#B9B8B0",
      "accent": "#D6AA63",
      "accentDeep": "#A87A39",
      "accentInk": "#16110B",
      "success": "#8BA88F",
      "danger": "#D78A83"
    },
    "radiiPx": { "small": 10, "medium": 16, "large": 26 },
    "fonts": {
      "body": "Manrope, Avenir Next, Helvetica, Arial, sans-serif",
      "display": "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif"
    }
  },
  "tv": {
    "background": "linear-gradient(90deg, #030303 0%, #111111 48%, #3B3B3B 100%)",
    "panel": "#1D1D1D",
    "paper": "#FFF8E9",
    "muted": "#CEC6B8",
    "goldFallback": "#C99745",
    "goldGradient": "linear-gradient(90deg, #86531E 0%, #D6A955 44%, #F0D084 57%, #A96727 100%)",
    "focus": "6px solid #D2A34F with 5px offset",
    "minimumTargetPx": 64,
    "verifiedCanvas": "1920x1080"
  },
  "avoid": [
    "infinite feeds",
    "chatbot visual language",
    "neon yellow",
    "streaming-service clone UI",
    "cinema clichés",
    "color-only focus or selection",
    "unverified playback claims"
  ]
}
```

## 19. Suggested revision prompt

Copy this document and append:

```text
Revise this style book for the following objective: [OBJECTIVE].

Return:
1. the proposed design direction in one paragraph;
2. a token-level before/after table;
3. component-level changes by platform;
4. accessibility and Fire TV rendering risks;
5. which current inconsistencies the proposal resolves;
6. a list of decisions that still require owner approval.

Do not write implementation code yet. Preserve every non-negotiable unless you explicitly identify and justify an exception.
```
