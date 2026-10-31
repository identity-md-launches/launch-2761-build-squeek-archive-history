# Squeek Archive design system

Source of truth: `src/styles.css` (tokens are in `:root` at the top of the file), `src/index.html` and the element builders in `src/app.js`. This document describes the implemented site.

## Overview

Squeek Archive is a reading tool for people who follow Squeekchain: holders checking a Squeek's past, and sceptics checking the wheel. It is a dashboard, not a marketing page. The first screen holds the name, one plain line, the search box and the first result. There are no slogans or kicker labels.

The visual character is quiet: a warm paper background, white panels with a hairline border, and one blue accent that means "interactive". The colour comes from two places:

- the Squeek art, rendered live from the contract,
- the audit's status colours, which always sit next to a word ("Fresh", "DRIFTING", "Fail") and a mark (✓ ! ✕ …).

Hierarchy comes from size and weight, not from colour. Data such as addresses, hashes and epochs is set in monospace. Prose and numbers are set in the system sans with tabular figures.

## Colors

Defined as primitives, then semantic tokens, in `:root` of `src/styles.css`. The dark theme swaps only the primitives inside `@media (prefers-color-scheme: dark)`. Components use only the semantic tokens.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#f7f5f0` | `#141311` | Page background, art placeholder, ribbon at rest, hover on secondary buttons |
| `--color-surface` | `#ffffff` | `#1c1b18` | Panels, inputs, secondary buttons |
| `--color-text` | `#1d1b17` | `#ece8e0` | Body text, headings |
| `--color-text-secondary` | `#57524a` | `#aaa498` | Labels, meta lines, hints, audit details, input borders |
| `--color-border` | `#ddd7cb` | `#36332d` | Panel borders, event separators, ancestry guide lines |
| `--color-accent` | `#1f56a3` | `#8fb6f5` | Links and link buttons |
| `--color-accent-solid` / `-hover` | `#1f56a3` / `#17437f` | `#8fb6f5` / `#b3cdf8` | The one filled button ("Look up") |
| `--color-on-accent` | `#ffffff` | `#10161f` | Text on the filled button |
| `--color-focus` | `#1f56a3` | `#8fb6f5` | 2px `:focus-visible` outline |
| `--color-pass` / `-bg` | `#1c6a3a` / `#e7f3ea` | `#74d39a` / `#15281c` | Passing audit rows, CONSISTENT ribbon |
| `--color-check` / `-bg` | `#8a5200` / `#fbf0dc` | `#f0b45a` / `#2c2111` | Rows that need a check, CHECK ribbon |
| `--color-fail` / `-bg` | `#b0261c` / `#fbe8e6` | `#ff9a8f` / `#331614` | Failing rows, IMPLAUSIBLE ribbon, error text |
| `--color-art-outline` | `rgb(0 0 0 / 0.1)` | `rgb(255 255 255 / 0.1)` | 1px outline around the rendered SVG |

Contrast:

- **Light theme, rendered:** the taste@1 probe measured every text pair at 320, 390 and 1440 wide and found none below 4.5:1 (3:1 for large text).
- **Both themes, computed from the declared tokens (WCAG formula, not rendered):**

| Pair | Light | Dark |
| --- | --- | --- |
| text on surface | 17.19 | 14.09 |
| secondary text on surface | 7.75 | 6.95 |
| secondary text on page background | 7.11 | 7.49 |
| accent on surface | 7.20 | 8.35 |
| text on the filled accent button | 7.20 | 8.80 |
| pass colour on its own tint | 5.80 | 8.52 |
| check colour on its own tint | 5.66 | 8.54 |
| fail colour on its own tint | 5.66 | 8.12 |

## Typography

- Families: `--font-sans` (system-ui stack) for everything, and `--font-mono` (ui-monospace stack) for addresses, hashes, `counterEpoch` and the search input. No web fonts are loaded.
- Weights: 400 for body text, 600 for labels, `h3` and event types, 700 for `h1`, `h2`, the brand, the ribbon word and audit verdicts.
- Scale (four steps plus display):

| Token | Size | Line height | Used by |
| --- | --- | --- | --- |
| `--text-display` | 2rem, or 2.75rem at ≥ 64rem | 1.15, −0.02em | `h1` only |
| `--text-lg` | 1.5rem | 1.15, −0.01em | `h2`, ribbon verdict word |
| `--text-base` | 1rem | 1.5 | Body, `h3`, inputs, buttons |
| `--text-sm` | 0.8125rem | 1.5 | Meta lines, hints, captions, audit details, traits, footer |

- `.addr` sets monospace at 0.92em of its context, so mono addresses match the sans x-height.
- `.num` and `.audit-detail` use `font-variant-numeric: tabular-nums`, so polling values do not shift.
- Headings use `text-wrap: balance`. Hints, captions and event text use `pretty`. Addresses and hashes use `overflow-wrap: anywhere`, so they wrap in full and are never truncated.
- The lede is capped at 60ch and the footer at 75ch.

## Layout

- Spacing tokens: `--space-1` to `--space-8` (0.25, 0.5, 0.75, 1, 1.5 and 2 rem). Siblings inside a panel are 1rem apart (`.panel > * + *`). Sections within a panel are 2rem apart, at least twice the within-group gap.
- Page frame: `main`, the header and the footer share `max-width: 90rem` with inline padding `--gutter: clamp(1rem, 4vw, 2.5rem)`. Grids use `minmax(0, 1fr)` tracks, so long content cannot widen the page.
- Breakpoints:
  - `≥ 40rem`: panel padding grows from 1rem to 1.5rem.
  - `≥ 64rem`: the display size grows, and the history feed becomes a two-column, row-major grid.
  - `≥ 68rem`: `.columns` splits into the result (3fr) and the audit (2fr).
- Container queries on `.result`:
  - `≥ 36rem`: art beside the facts.
  - `≥ 44rem`: event rows put the time and type in an 11rem left column.
- Checked widths: 320, 390, 1440 and 1920 (dark), with no horizontal scroll.

## Elevation & Depth

The interface is flat. There are no shadows. Panels are separated from the page by `--color-surface` on `--color-bg` and a 1px `--color-border`. The audit is two stacked surfaces, not nested ones: the `.ribbon` header is tinted by its verdict and squared at the bottom, and `.audit-body` is squared at the top.

## Shapes

- `--radius: 12px` for panels and the ribbon/body pair.
- `--radius-inner: 8px` for inputs, buttons and the art frame.
- Audit marks are 1.5rem circles.
- The art frame is square (`aspect-ratio: 1`) and clips the SVG to its rounded corners.

## Components

| Component | Source | Notes |
| --- | --- | --- |
| Search form | `src/index.html` `#search`, `onSubmit` in `src/app.js` | Visible label, a format hint beside the field, an inline error tied by `aria-describedby`, and `aria-invalid` on bad input. On submit, focus moves to the result heading. |
| Button | `.button`, `.button.primary`, `.link-button` | 44px minimum height, `scale: 0.96` on press, hover only under `(hover: hover)`, and transitions limited to `background-color` and `scale`. Only one primary per view. |
| Panel | `.panel` | Surface, border and radius. Used for the result, the audit body and the feed. Never nested. |
| Facts list | `.facts`, `.traits` (`<dl>`) | Two-column grid. The term is in secondary text; the value wraps. |
| Event row | `eventItem()` in `src/app.js`, `.event` | Time (UTC) and type label, one sentence from `describe()` with Squeek and wallet links, and an Etherscan link. Measurement events have no transaction link. |
| Ancestry tree | `treeNode()`, `.tree` | Nested `<ul>`. Each generation indents 1.5rem behind a 2px border line. |
| Audit row | `renderAudit()`, `.audit-row[data-verdict]` | Mark, title (`h3`), verdict word, then the numbers judged. Verdicts: `pass`, `check`, `fail`, `waiting`, `note`. |
| Ribbon | `#ribbon[data-verdict]` | `h2` "Is the work real?", the summary word, and the sample count with its age. |
| Progress | `#feed-status` (`role="status"`), `<progress>` | Page and event counts while walking. A resume button appears on failure. |
| Ages | `age()` in `src/app.js` | A `[data-since]` span that ticks every second. |

## Do's and Don'ts

- Do put status in words and numbers first and colour second. Every new status uses the `--color-pass|check|fail` pairs plus a text label.
- Do keep feed and chain data as text nodes. Build DOM with `h()`, never `innerHTML`. Only the sanitised renderer SVG is inlined.
- Do show full addresses in `.addr`. Do not ellipsize them.
- Don't add a second filled button to a view, a shadow, a web font, or a seventh type size.
- Don't add uppercase kicker labels. Uppercase is reserved for the brief's verdict words (CONSISTENT, CHECK, IMPLAUSIBLE, DRIFTING).
- To add a page section: add a `<section class="panel" aria-labelledby>` with an `h2` inside `main`, use `.facts` for key–value data and `.events` with `eventItem()` for event lists, and keep a stale value visible with an `age()` when a request fails.
