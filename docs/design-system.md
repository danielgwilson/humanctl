# The humanctl design system

humanctl is an attention router for a scarce human running many coding-agent sessions. Every design decision serves one job: route the human to the next bounded decision with the least noise possible. When in doubt, subtract.

This document is the law for colour, type, geometry, elevation, and motion: the token layer, the primitive vocabulary built on it, and the arithmetic that binds them.

Every rule below carries its reason. A rule without a reason gets violated in six weeks by someone who was not in the room.

Every contrast number in this document was computed, not promised. Section 1.7 publishes the full table. The compositing model is pinned in section 10 so that the checker and the renderer cannot disagree.

## Scope, and what this document does not govern

`DESIGN.md` at the repo root remains authoritative, and **is not superseded**, for:

- information architecture and the shell,
- the state and note-level vocabulary,
- **one owner per signal**,
- row anatomy (three lines, no avatars, no context bars),
- **no cards**,
- **`ScrollArea` always, no native scrollbars**,
- bespoke controls and the accessibility hardline,
- performance SLOs,
- the born-clean public-repo rules,
- process rules for UI changes.

Those are product laws. This document is downstream of them and must never be read as licence to break one. Section 8 states the reconciliation and resolves the places where the two documents genuinely conflicted.

**Where the shipped renderer disagrees with this document, the renderer is wrong.** This document describes the system, not a snapshot of the code. The gaps are tracked as issues, not as caveats in the text.

---

## 0. The physics

Nine rules. Everything else is a consequence.

**P1. Hierarchy is carried by ink alpha, never by weight, never by size.**
Reason: a control plane is scanned, not read. Weight jumps and size jumps make the eye stop; alpha steps let the eye slide down a gradient and land on the one dark thing. Body weight is 500 everywhere. Weight 600 is legal on exactly two roles: `title` and `label`. Weight 700 is illegal. Italic is illegal. **Size is assigned by content kind, never by importance.** A 13px mono session title is not "less important" than a 14px sans message; it is a different kind of thing. Shrinking text to demote it is illegal. Demotion is alpha.

**P2. Colour has exactly four jobs.**
(1) the one primary action fill per screen region, (2) selection and focus, (3) a state mark (a dot, a soft chip), (4) a chart series. Nothing is coloured to create hierarchy. Nothing is coloured decoratively. An icon never changes colour to signal state.
Reason: with five saturated marks on a screen, the human finds all five in one saccade. With fifty, colour means nothing and the router has failed. **P2 has a load-bearing precondition: the neutral hue and the accent hue must sit at least 120 degrees apart.** An accent that shares a hue family with the ground does not pop off it, and no amount of chroma fixes that. This is why section 1.1 puts the neutrals at hue 110 and iris at hue 285.

**P3. A border is a hairline ring, and a hairline ring is an inset box-shadow.**
Reason: `box-shadow: inset 0 0 0 var(--hairline-w)` composes with elevation in a single property, never affects layout, and lets a selection ring swap in for a neutral ring with zero pixel shift. That zero shift is the entire reason ring-as-selection works.
**The known failure mode, stated so nobody rediscovers it:** an inset box-shadow paints above the element's own background but below child content. Any child with its own background reaching the container wall erases the ring there. Therefore: a fillable row is inset from its container's padding; a band inside a bounded surface is transparent, never filled; and the `Progress` track carries no ring at all.

**P4. Interaction states are alpha over whatever surface is beneath.**
Hover, press, and selected are overlays, not new hex values. A solid button is a surface: hovering it applies the same `--overlay-hover`, pressing it applies the same `--overlay-press`.
Reason: a hardcoded `hover:bg-panel` is invisible on a panel and wrong inside a popover. An overlay is correct on white, on the sunken composer well, inside a menu, and on top of a saturated fill, with one token. Section 1.7 proves the primary button's label stays legible at rest, on hover, and on press.

**P5. Depth means "this floats." It never means "this is a group."**
Two shadows exist. Rows, chips, inputs, banners, list containers, and bars get a hairline ring and no shadow, ever. Only a genuinely floating surface (palette, menu, sheet, toast, tooltip) and one focused inline object get a shadow.
Reason: shadow is the most expensive signal in the system. Spend it on "this is a separate plane," which is a true statement about at most one thing on screen at a time.

**P6. Radius is a monotone, sublinear function of control height. There is no global radius.**
20px controls take 6px, 28px take 8px, 32px take 10px, panels take 12px. It is a table, not a ratio, and the table is sublinear on purpose: a large radius on a large control reads as consumer software.
**Concentricity outranks the table.** Where a control nests inside another, `inner radius = outer radius - inset`. The eye sees nested corners together, and a non-concentric pair looks broken in a way no ratio can excuse. Insets are chosen so the inner radius lands on the scale: a 12px panel with 4px padding holds 8px rows; an 8px toggle group with 2px padding holds 6px options.

**P7. Density is refused inside a unit and spent between units.**
Nav rows run at 28px with no separators. A field label sits 6px above its input. Two sections sit 24px apart with nothing between them. Negative space is a property of the work surface, never of the controls around it.
Reason: whitespace inside a control makes rows tall, which makes the fleet scroll, which is exactly the noise we exist to remove.

**P8. Rules mark a change of scope. Gaps mark a change of topic.**
A full-bleed hairline appears only at the six enumerated sites in section 3.6. A section inside a scroll region is separated by a label and 24px of air, never by a rule.
Reason: if every boundary gets a rule, no rule means anything and the screen reads as a spreadsheet of chrome.

**P9. Icons are 14px at 1px stroke, always leading, always inheriting text colour.**
Reason: this single ratio is most of the "fine, precise, not a toy" feel. A 14px glyph at 2px stroke spends 14 percent of its box on ink and reads as a cartoon. Trailing icons exist in exactly three roles: a disclosure chevron, a hover-revealed row action, and a column-header affordance.

---

## 1. Colour

### 1.1 The thesis

**The ground is graphite. The only violet object in the product is the thing you are about to act on.**

Every neutral in humanctl sits at oklch hue **110** with a trace of chroma (0.004 to 0.012). That is a cool-warm graphite, an instrument-panel grey, not a blue-slate and not a violet-slate. The accent, `iris`, sits at hue **285**. The separation is **175 degrees**, which is the number P2 depends on. It is not a taste preference; it is the mechanism by which five saturated marks are findable in one saccade against a field of neutrals.

The `idle` state hue is hue 110 as well, at chroma 0.010 to 0.012. Absence of activity is rendered as absence of colour, by construction, not by picking a grey that happens to look grey.

### 1.2 Surfaces

A deliberately tight ramp. Separation between two surfaces comes from a hairline, not from a tonal step. If you find yourself wanting a darker panel to make a boundary visible, you wanted a hairline. The whole dark ramp spans 11 lightness points; the whole light ramp spans 5.

Four surfaces carry content:

| token | job |
|---|---|
| `--surface-0` | the page ground. The sidebar and the content column are both this. |
| `--surface-1` | a raised inline surface: a bounded list container, a group header band. |
| `--surface-2` | a floating surface: palette, menu, sheet, toast. |
| `--surface-sunken` | a well: an input, a textarea, a progress track, the composer. |

Plus exactly one surface that carries no content:

| token | job |
|---|---|
| `--surface-inverted` | the tooltip, and nothing else. |

The tooltip is the one high-contrast surface in the app, and it exists so that a tooltip can never be mistaken for content. It gets its own ink token, `--ink-inverted`. It is the fifth surface: there are five surfaces, four of which carry content. In the light theme `--surface-1` and `--surface-2` are both pure white and are distinguished only by elevation. That is intentional and it is what P5 is for.

### 1.3 Ink

One solid ink per theme. Everything below it is that ink at reduced alpha, composited over whatever surface it lands on. **The alphas are authored as explicit `oklch(L C H / a)` values, never through `color-mix` with `transparent`,** so that the value the checker computes and the value the renderer paints are the same number. See section 10.

| token | dark alpha | light alpha | permitted use |
|---|---|---|---|
| `--ink` | 100% | 100% | values, names, active labels, the message to the human |
| `--ink-2` | 68% | 74% | field labels, the verb in a compound label, secondary prose |
| `--ink-3` | 54% | 61% | timestamps, counts, section labels, placeholders, column headers |
| `--ink-4` | 44% | 48% | icons at rest, disabled controls, ghost affordances |

**The light alphas are higher than the dark alphas, and they have to be.** Dark ink over a light ground loses contrast far faster with alpha than light ink over a dark ground, because the sRGB transfer curve is steep near black. A symmetric ladder cannot clear WCAG AA on both sides. Anyone who "cleans up" this asymmetry breaks the light theme: a symmetric 68/54/44 ladder puts light `--ink-3` at 3.4:1 against a 4.5:1 bar.

`--ink-4` is never body text. It is the "a place where you could put something" colour: an idle Filter control, a `+ add` ghost, a resting icon. It clears 3:1 against every surface it can render on, which is the WCAG bar for essential UI. It is forbidden on prose **by lint rule**, not by arithmetic: in the dark theme it happens to measure 4.0:1, which is close enough to the prose bar that nobody should be reasoning from the number.

Compound labels split alpha inside one line. `Sorted by` is `--ink-2`; the field name is `--ink`. The mutable value is the dark part. This is the same trick as a field row (label `--ink-2`, value `--ink`) applied to a control, and it means a control never needs a second size or a second weight to show what part of it is live.

### 1.4 Overlays

| token | dark | light |
|---|---|---|
| `--overlay-hover` | white 6% | ink 4.5% |
| `--overlay-press` | black 16% | black 6% |
| `--overlay-selected` | `--iris-contrast` 20% | `--iris-solid` 14% |

Three things are load-bearing here.

**Press darkens in both themes.** Hover lightens in dark and darkens in light, because hover means "the cursor is here" and wants to move away from the ground. Press means "you are pushing this down," which is a physical claim, and physical claims do not invert with the theme. Press composites on top of hover, always, because a pointer that can press is already hovering.

**Selected must beat hover, in both themes, on every surface.** This is the single worst bug the colour system can have: in an attention router whose entire job is "which thing are you on," a selected row that loses to the cursor has inverted the product. Two ways to get it wrong, both of which have been shipped:

1. Mixing `--iris-solid` (the dark violet) into the dark selected overlay. It composites *darker* than a white-6% hover, so the hovered row is brighter than the selected row. The dark selected overlay therefore mixes `--iris-contrast` (the light lavender).
2. Expressing hover and selected as two hardcoded surface swaps rather than as overlays. The hover variant then wins on CSS specificity and *replaces* the selection fill, so hovering a selected row destroys the signal. This is what P4 exists to prevent.

Measured: dark selected 1.461:1 against the ground versus hover 1.132:1; light selected 1.231:1 versus hover 1.093:1. Hovering a selected row stacks both and goes further still (dark 1.758:1). This is asserted in `tokens:check`, not eyeballed.

**Selection and hover are the same device at different strengths,** which is why hovering a nav row previews selection. A fillable row is inset from its container's padding so its rounded fill never touches the panel wall (P3). A fill that bleeds to a container edge does not exist in this product.

### 1.5 Hue pairs, and the two solids

Eight hues. Each hue exposes two roles:

| role | definition | used for |
|---|---|---|
| `contrast` | the theme-aware chromatic ink. Darker in light, lighter in dark. | status dots, chart bars, chip text, accent links, the focus ring |
| `soft` | a tinted background. Light tint in light, dark tint in dark. | chip backgrounds, the one tinted informational band |

`--<hue>-contrast` on `--<hue>-soft` clears **4.5:1** in both themes with no second palette and no second component. That is the whole mechanism. The bar is the number the palette actually holds: observed minimum 4.69:1.

There are exactly **two solid fills in the entire product**:

```
--iris-solid    the one primary action, the unread badge, the selected overlay's source in light
--block-solid   the destructive action
--on-solid      the ink that sits on either of them
```

Six of the eight hues never carry a fill, so they never got a `solid`. A token that exists only to be the arithmetic input of another token is a token nobody can find a use for and everybody eventually misuses.

**There is no `<hue>-solid-hover`.** Per P4, hover on a solid fill is `--overlay-hover` over that fill, and press is `--overlay-press` over that. Measured: `--on-solid` on `--iris-solid` is 6.59:1 at rest, 5.77:1 on hover (dark), 7.40:1 on press. Assigning the hover fill to `--<hue>-contrast` instead, which in dark is a light lavender, drops the primary button's own label to 1.90:1: the button erases its label on hover. One rule, applied consistently, deletes both the bug and the token.

### 1.6 The eight hues, and what owns them

| hue | oklch hue | job |
|---|---|---|
| `iris` | 285 | the identity. Primary action, selection, focus. Nothing else. |
| `work` | 152 | `running` |
| `need` | 70 | `needs input`, `needs approval`, note level `review` |
| `block` | 26 | `blocked`, `stalled`, note level `blocked`, destructive actions |
| `done` | 215 | `finished`, note level `done` |
| `idle` | 110 | `stale`, `archived`, note level `fyi`. Neutral by construction. |
| `series-1` | 245 | chart series, index 0 |
| `series-2` | 75 | chart series, index 1 |

That is the full 12-row map that `DESIGN.md`'s vocabulary demands: eight session states and four note levels, every one owned.

Four notes that are law, not commentary.

**Chart series hues are not harness hues.** They are `--series-1` and `--series-2`, assigned by series index at the data layer, in one place. A vendor noun in the token layer is forbidden (section 9), and an unfalsifiable "this colour carries no vendor meaning" disclaimer bolted to a token named after the vendor is worse than either alternative. Harness identity remains an icon, everywhere, always, exactly as `DESIGN.md` requires.

**The series pair is chosen for colour-vision deficiency, and asserted.** Blue (245) and gold (75) sit 170 degrees apart and are the canonical deuteranopia-safe pair. They are also separated in lightness by 0.18 in dark and 0.10 in light, because a CVD-safe hue pair that is isoluminant is still a bad pair.

**A state hue and a series hue never appear in one figure.** A *figure* is one chart block: a group of `CountBar`s under one `SectionLabel`. Fleet renders a by-state figure and a by-harness figure on the same screen, in different figures, and this rule is what makes that legal.

**State is never colour alone.** A state chip carries a 6px dot in `--<hue>-contrast`, a soft background, and the state word in text, sentence case, exactly as `DESIGN.md` spells it. Remove the colour and the chip still says `needs input`. `block` and `work` sit 126 degrees apart in hue and are separated in lightness by 0.125 (dark) and 0.100 (light).

### 1.7 The tokens, and the numbers they produce

```css
/* ============================================================
   humanctl tokens. This block is the entire colour system.
   Theming is a single class swap on <html>.
   Alphas are authored inline, never via color-mix, so that the
   contrast checker and the compositor agree. See section 10.
   ============================================================ */

:root {
  color-scheme: dark;

  /* -- surfaces. Hue 110: graphite, 175 degrees from iris. -- */
  --surface-0:        oklch(0.155 0.010 110);   /* #0c0d08 */
  --surface-1:        oklch(0.192 0.011 110);   /* #14150f */
  --surface-2:        oklch(0.230 0.012 110);   /* #1d1d17 */
  --surface-sunken:   oklch(0.120 0.008 110);   /* #060604 */
  --surface-inverted: oklch(0.945 0.005 110);   /* #edede9 */

  /* -- ink: one solid, then alpha. -- */
  --ink:          oklch(0.965 0.005 110);         /* #f3f4f0 */
  --ink-2:        oklch(0.965 0.005 110 / 0.68);
  --ink-3:        oklch(0.965 0.005 110 / 0.54);
  --ink-4:        oklch(0.965 0.005 110 / 0.44);
  --ink-inverted: oklch(0.170 0.010 110);

  /* -- overlays: alpha over whatever is beneath, including a solid fill. -- */
  --overlay-hover:    oklch(1 0 0 / 0.06);
  --overlay-press:    oklch(0 0 0 / 0.16);
  --overlay-selected: oklch(0.800 0.105 285 / 0.20);   /* iris-contrast */

  /* -- the hairline. Not a border. Alpha compensates for the 0.5px draw. -- */
  --hairline: oklch(1 0 0 / 0.18);

  /* -- shadow tint. Dark theme shadows are black. -- */
  --shade-1: oklch(0 0 0 / 0.30);
  --shade-2: oklch(0 0 0 / 0.45);
  --shade-3: oklch(0 0 0 / 0.60);

  /* -- the two solid fills. Theme invariant. Declared once. -- */
  --on-solid:    oklch(0.990 0 0);
  --iris-solid:  oklch(0.490 0.190 285);   /* #5b45c5 */
  --block-solid: oklch(0.485 0.185 026);   /* #b0161e */

  /* -- dark: contrast is light, soft is dark. -- */
  --iris-contrast:     oklch(0.800 0.105 285);  /* #b6b4ff */
  --work-contrast:     oklch(0.860 0.140 152);  /* #85eba3 */
  --need-contrast:     oklch(0.845 0.115 070);  /* #fcbf76 */
  --block-contrast:    oklch(0.735 0.155 026);  /* #fc7e75 */
  --done-contrast:     oklch(0.800 0.100 215);  /* #69cee6 */
  --idle-contrast:     oklch(0.720 0.012 110);  /* #a5a59d */
  --series-1-contrast: oklch(0.700 0.135 245);  /* #4ba6ec */
  --series-2-contrast: oklch(0.880 0.100 075);  /* #fece8c */

  --iris-soft:     oklch(0.255 0.050 285);
  --work-soft:     oklch(0.245 0.045 152);
  --need-soft:     oklch(0.255 0.046 070);
  --block-soft:    oklch(0.250 0.052 026);
  --done-soft:     oklch(0.245 0.042 215);
  --idle-soft:     oklch(0.240 0.010 110);
  --series-1-soft: oklch(0.250 0.048 245);
  --series-2-soft: oklch(0.255 0.046 075);

  --focus: var(--iris-contrast);
}

.light {
  color-scheme: light;

  --surface-0:        oklch(0.975 0.004 110);   /* #f7f7f4 */
  --surface-1:        oklch(1 0 0);             /* #ffffff */
  --surface-2:        oklch(1 0 0);             /* #ffffff */
  --surface-sunken:   oklch(0.950 0.005 110);   /* #eeefeb */
  --surface-inverted: oklch(0.225 0.010 110);   /* #1c1c17 */

  --ink:          oklch(0.205 0.010 110);         /* #171812 */
  --ink-2:        oklch(0.205 0.010 110 / 0.74);
  --ink-3:        oklch(0.205 0.010 110 / 0.61);
  --ink-4:        oklch(0.205 0.010 110 / 0.48);
  --ink-inverted: oklch(0.975 0.004 110);

  --overlay-hover:    oklch(0.205 0.010 110 / 0.045);
  --overlay-press:    oklch(0 0 0 / 0.06);
  --overlay-selected: oklch(0.490 0.190 285 / 0.14);   /* iris-solid */

  --hairline: oklch(0.205 0.010 110 / 0.13);

  /* Light-theme shadows are graphite-tinted, never black.
     Pure black on white is the tell of an amateur light theme. */
  --shade-1: oklch(0.30 0.030 110 / 0.06);
  --shade-2: oklch(0.30 0.030 110 / 0.10);
  --shade-3: oklch(0.30 0.030 110 / 0.16);

  --iris-contrast:     oklch(0.440 0.170 285);  /* #4e3baa */
  --work-contrast:     oklch(0.400 0.095 152);  /* #12562d */
  --need-contrast:     oklch(0.470 0.100 070);  /* #7e4f04 */
  --block-contrast:    oklch(0.500 0.165 026);  /* #ae2e2c */
  --done-contrast:     oklch(0.445 0.078 215);  /* #025e6f */
  --idle-contrast:     oklch(0.470 0.012 110);  /* #5b5b54 */
  --series-1-contrast: oklch(0.420 0.100 245);  /* #0b517f */
  --series-2-contrast: oklch(0.520 0.105 075);  /* #8c5f0e */

  --iris-soft:     oklch(0.935 0.030 285);
  --work-soft:     oklch(0.935 0.032 152);
  --need-soft:     oklch(0.940 0.034 070);
  --block-soft:    oklch(0.935 0.030 026);
  --done-soft:     oklch(0.935 0.028 215);
  --idle-soft:     oklch(0.945 0.008 110);
  --series-1-soft: oklch(0.935 0.030 245);
  --series-2-soft: oklch(0.940 0.036 075);
}
```

**Measured, not promised.** Computed by converting each oklch value to sRGB, compositing alpha source-over in sRGB, and applying WCAG 2.1 relative luminance. Every value below is the observed number.

Ink on surfaces (contrast ratio), dark theme:

| | `surface-0` | `surface-1` | `surface-2` | `surface-sunken` |
|---|---|---|---|---|
| `--ink` | 17.66 | 16.62 | 15.25 | 18.35 |
| `--ink-2` | 8.35 | 8.09 | 7.67 | 8.47 |
| `--ink-3` | 5.59 | 5.52 | 5.33 | 5.58 |
| `--ink-4` | 4.06 | 4.07 | 4.00 | 4.00 |

Ink on surfaces, light theme:

| | `surface-0` | `surface-1` | `surface-2` | `surface-sunken` |
|---|---|---|---|---|
| `--ink` | 16.66 | 17.89 | 17.89 | 15.48 |
| `--ink-2` | 7.36 | 7.64 | 7.64 | 7.07 |
| `--ink-3` | 4.72 | 4.84 | 4.84 | 4.60 |
| `--ink-4` | 3.15 | 3.20 | 3.20 | 3.10 |

Hue `contrast` tokens, worst case over the four surfaces, and on their own `soft`:

| hue | dark: min on surface / on soft | light: min on surface / on soft |
|---|---|---|
| `iris` | 8.83 / 8.34 | 7.21 / 6.85 |
| `work` | 11.59 / 11.00 | 7.62 / 7.36 |
| `need` | 10.32 / 9.71 | 6.04 / 5.83 |
| `block` | 6.72 / 6.49 | 5.65 / 5.34 |
| `done` | 9.31 / 8.86 | 6.38 / 6.15 |
| `idle` | 6.81 / 6.64 | 5.89 / 5.80 |
| `series-1` | 6.38 / 6.04 | 7.27 / 6.97 |
| `series-2` | 11.63 / 10.93 | 4.85 / 4.69 |

Solid fills, with `--on-solid` on them at rest, on hover, and on press:

| | dark rest / hover / press | light rest / hover / press |
|---|---|---|
| `--iris-solid` | 6.59 / 5.77 / 7.40 | 6.59 / 6.92 / 7.53 |
| `--block-solid` | 6.85 / 6.29 / 8.01 | 6.85 / 7.23 / 7.86 |

Overlays, against the surface beneath (a ratio near 1.0 means "barely visible," which for an overlay is the point; what matters is the ordering):

| | dark: hover / selected / selected+hover | light: hover / selected / selected+hover |
|---|---|---|
| `surface-0` | 1.132 / **1.461** / 1.758 | 1.093 / **1.231** / 1.343 |
| `surface-1` | 1.160 / **1.509** / 1.817 | 1.094 / **1.237** / 1.351 |
| `surface-2` | 1.183 / **1.539** / 1.847 | 1.094 / **1.237** / 1.351 |

Hairline against the surface beneath: dark 1.60 to 1.78; light 1.30 to 1.31. Inverted ink on the inverted surface: 16.28 dark, 15.90 light. Every colour above is inside the sRGB gamut, verified, so Chromium never gamut-maps a value the checker asserted.

### 1.8 The contract, asserted in `tokens:check`

Bars, and the observed minimum:

| assertion | bar | observed |
|---|---|---|
| `--ink` on every surface, both themes | 12:1 | 15.25 |
| `--ink-2` on every surface, both themes | 4.5:1 | 7.07 |
| `--ink-3` on every surface, both themes | 4.5:1 | 4.60 |
| `--ink-4` on every surface, both themes | 3:1 | 3.10 |
| `--<hue>-contrast` on every surface, both themes | 4.5:1 | 4.85 |
| `--<hue>-contrast` on `--<hue>-soft`, both themes | 4.5:1 | 4.69 |
| `--on-solid` on each solid, at rest, hover, and press | 4.5:1 | 5.77 |
| `--ink-inverted` on `--surface-inverted` | 12:1 | 15.90 |
| `--focus` on every surface | 3:1 | 7.21 |
| `--hairline` composited, against each surface | 1.25:1 | 1.30 |
| CR(selected) minus CR(hover), each surface, both themes | +0.08 | +0.138 |
| light `--<hue>-soft` against `--surface-0` | 1.09:1 | 1.092 |
| every authored colour | inside sRGB | yes |

The last one matters more than it looks. `oklch(0.840 0.140 070)` is outside sRGB; Chromium gamut-maps it per CSS Color 4 and paints something else. A checker that does not gamut-map identically asserts a ratio the screen never renders.

---

## 2. Type

### 2.1 The one typeface rule

**Mono is the chrome. Sans is language.**

Not "mono is the exception." Mono is the *default*. Sans appears in exactly two roles, and the second of them (`prose`) is reserved for the one thing on the screen that is a sentence addressed to a human: the message to the human, a note body, chat, the composer, an empty state, a toast.

Reason: humanctl's content is machine output. Session titles are branch-shaped. Directory basenames, PR numbers, token counts, durations, state words, relative times, paths: all of it is emitted by a machine and much of it must align in a column. The opposite polarity (sans body, mono exception) is correct for an app whose content is human writing, and it is correct there *because* of that content model, not because of a law of interfaces. Inheriting it here would inherit somebody else's content model.

The payoff lands exactly on the row anatomy `DESIGN.md` already mandates:

```
line 1   [harness glyph]  session title (mono 13)          time (mono 11)
line 2   [state chip]     the message to the human (sans 14)
line 3   dir basename (mono 11)   [PR chip]
```

Line 2 is the only sans line in the row. It is the only thing on the screen that looks like language, and it is the only thing on the screen that *is* language. The human learns that in one glance and never unlearns it. It is enforceable in review: prose in mono is a costume, and mono in prose is a costume back.

### 2.2 The faces

**Space Grotesk** (sans, weights 500 and 600) and **JetBrains Mono** (mono, weights 500 and 600). Both OFL 1.1. Both **self-hosted woff2, latin subset only, four files, zero network requests**. `OFL.txt` ships next to the binaries.

An Electron app must work offline. A webfont fetched from a CDN at runtime is not a webfont, it is an outage waiting for a plane. Declaring a family in a font stack without shipping an `@font-face` rule is the same failure with a quieter symptom: the stack silently falls through to the system face, which is forbidden.

Two consequences of the mono/sans inversion are worth stating. First, mono is the dominant face, so it earns the careful choice: JetBrains Mono is drawn for legibility at 10px to 13px, and ships tabular figures and a slashed zero by default. Second, the two faces do *not* share a skeleton, and under the inverted polarity that is a feature. The one sans line in a row must look foreign. A matched sans/mono superfamily would blur exactly the seam the system is built on.

```css
@font-face {
  font-family: 'Space Grotesk'; font-style: normal; font-weight: 500;
  font-display: optional;                       /* not swap, not block */
  src: url('../fonts/space-grotesk-500-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+2192, U+2212;
}
/* ...600, and JetBrains Mono 500/600, identically. */
```

`font-display: optional`, with a `<link rel="preload">` on each of the four files. Not `block`: `block` costs up to a 3 second invisible-text period, and `docs/perf.md`'s cold-open budget is 1500ms. Not `swap`: `swap` flashes the system face, which is the one face we are escaping. `optional` on local disk wins the race essentially always, degrades to the fallback for exactly one paint on a cold cache, and can never blank the window.

The four `@font-face` rules are hand-written. Importing a font package's index entry pulls latin-ext, cyrillic, greek, and vietnamese subsets, which adds five `@font-face` blocks per family against a CSS budget with single-digit kB of headroom.

### 2.3 Six roles. No seventh.

Five permitted font sizes: **20, 14, 13, 11, 10**. Two sans sizes, four mono sizes, one shared number. Every other size in the app is deleted. Half-pixel sizes are deleted: they do not resolve to a device pixel and blur the precision they reach for.

| role | family | size | weight | line-height | tracking | where |
|---|---|---|---|---|---|---|
| `title` | sans | 20px | 600 | 24px | -0.015em | the view name. Once per screen. |
| `prose` | sans | 14px | 500 | 20px | 0 | the message to the human, note bodies, chat, the composer, empty-state copy, toast copy |
| `stat` | mono | 20px | 500 | 24px | 0, tabular | the three headline numbers in Fleet and Metrics |
| `row` | mono | 13px | 500 | 20px | 0 | session titles, nav labels, menu items, button labels, column headers, table cells. Tabular under `[data-numeric]`. |
| `micro` | mono | 11px | 500 | 14px | 0 | relative times, paths, durations, chips, secondary row lines |
| `label` | mono | 10px | 600 | 10px | +0.06em, uppercase | section labels, and nothing else |

Weight 600 exists on `title` and `label`. Exactly two roles, which is what P1 says. Weight 700 does not exist. Italic does not exist.

Three enforcement rules:

```css
body {
  font-family: var(--font-mono-stack);   /* the chrome is mono */
  font-size: 13px; font-weight: 500; line-height: 20px; letter-spacing: 0;
  -webkit-font-smoothing: antialiased;
}

/* Mono never takes negative tracking. A monospace is already spaced;
   tightening it collides glyphs and destroys column alignment. */
[class*="font-mono"], code, kbd, pre { letter-spacing: 0; }

/* Numerals never wobble. */
[data-numeric], .tnum { font-variant-numeric: tabular-nums lining-nums slashed-zero; }
```

`label` is the only role with positive tracking, because it is the only uppercase role, and uppercase demands it. **State chips are `micro`, in sentence case.** `DESIGN.md` fixes the state words as `needs input`, `blocked`, `stalled`. Rendering `NEEDS INPUT` re-cases a canonical vocabulary for decoration, which P2 forbids, and a 10px uppercase mono microlabel on every chip is the single most-generated ornament in this genre.

`title` takes -0.015em because Space Grotesk's own display metrics want it, measured on Space Grotesk. `prose` takes zero, because Space Grotesk at 14px is already tightly spaced and negative tracking collides its round bowls. Tracking transplanted from another face is a value, not a physics.

### 2.4 The `stat` role is a deliberate demotion

`stat` renders Fleet's headline numerals at 20px, the same size as the view title, in mono, tabular. That is not a token choice, it is a product decision, and it follows directly from `DESIGN.md`: the bottom context bar **owns** the fleet digest. Fleet's headline is an explicitly-granted restatement of the same three numbers. A restatement must not out-shout the view's own content. 20px is the largest size in the system; the headline is the largest thing on the screen; it is not larger than the largest thing in the system.

---

## 3. Geometry

### 3.1 Two grids, each with a job

**Rails and overlays snap to the 24px pane gutter. Bands, rows, and controls snap to the 4px control rhythm.** Every shell dimension in section 3.3 is derived from one of those two, and the arithmetic is shown.

Tailwind's default `--spacing` of 4px stays. It generates fractional steps on demand, so 2px (`p-0.5`), 6px (`gap-1.5`), and 10px (`px-2.5`) are all named classes. Rebasing `--spacing` to 2px to "make those expressible" is a rewrite of every `w-*`, `h-*`, `size-*`, `inset-*`, and `translate-*` in the codebase to buy nothing.

Permitted spacing steps, in order of frequency: `1` (4px), `2` (8px), `0.5` (2px), `1.5` (6px), `3` (12px), `2.5` (10px), `4` (16px), `6` (24px). Nothing else. An arbitrary spacing value in a diff is a defect, and lint rejects it (section 10).

Pane gutter: **24px** at every pane edge, without exception. Header, toolbar, list rows, section labels, context bar.

### 3.2 Control heights: three, and radius is a table on them

| height | radius | control |
|---|---|---|
| 20px | 6px | chip, kbd, count badge, inline micro-button |
| 28px | 8px | default button, icon button, toolbar control, select trigger, nav row, composer submit |
| 32px | 10px | large button, input, textarea single-line |
| panel | 12px | bounded list container, floating surface, composer |
| pill | full | the two full-round objects: the progress bar, the unread badge |

There is no 24px control, no 36px control, and no 40px control. humanctl is a keyboard-driven attention router with no marketing surface and nothing prominent enough to need a "prominent action" tier. The composer's submit is a 28px circle.

Concentricity (P6) resolves every nesting on the scale: panel r12 with 4px padding holds r8 rows; toggle group r8 with 2px padding holds r6 options at 20px; a toggle group of 28px options is r10 with 2px padding holding r8 options. A `Kbd` never sits inside a solid button, so no radius below 6px is ever required. (The command palette's footer action is a `Button variant="primary"` containing a return glyph, not a `Kbd`. That also removes the need for an on-solid ink at reduced alpha and an on-solid hairline.)

### 3.3 Bands, rows, rails, with the arithmetic

| token | value | derivation |
|---|---|---|
| `--band-top` | 44px | 11 x 4. The one band height. Owns the traffic-light band when it occupies the top-left corner. |
| `--band-toolbar` | 40px | 10 x 4. At most two stack. |
| `--band-columns` | 32px | 8 x 4. A column-header row, a group-header band. |
| `--row-nav` | 28px | the `md` control height |
| `--row-item` | 32px | the `lg` control height. A settings row, a menu item. |
| `--row-list` | 76px | `8 + 20 + 20 + 20 + 8`. See below. |
| `--rail-nav` | 240px | 10 x 24 |
| `--rail-list` | 336px | 14 x 24. The inbox list column, the chief-of-staff drawer. |
| `--w-palette` | 672px | 2 x `--rail-list`. Even, so it centres on whole pixels. |
| `--band-palette-top` | 96px | 4 x 24 |
| `--measure-prose` | 560px | ~72ch at 14px Space Grotesk (mean advance ~7.7px) |
| `--traffic-light-inset` | 76px | the macOS `hiddenInset` cluster plus its left inset |

**`--row-list` is 76px, and here is why it is not 88px.** The row has three line boxes. Line 2 contains a 20px state chip; line 3 contains a 20px PR chip. A 20px chip cannot sit in a 14px line box, so **all three line boxes are fixed at 20px**, regardless of what is in them. Fixing them is not a concession, it is the requirement: line 3's PR chip only renders when the session has PRs, and a row whose height depends on whether a chip is present is a row a virtualizer cannot estimate. Three 20px boxes, stacked with no gap (the leading inside each box supplies the visual separation), plus 8px of padding above and below: `8 + 60 + 8 = 76`.

This satisfies P7 exactly: 60px of content, 16px of chrome. The virtualizer's row estimate must equal this number. An estimate that disagrees with the row costs a scroll jump on every first paint.

**P7 versus the 76px row, argued rather than asserted.** The cheaper row is two lines at 52px, with line 3 revealed on hover. It is rejected: a keyboard-driven router must present the same information whether or not a pointer is present, and "hover reveals, it does not decorate" licenses revealing an *action*, not revealing a *signal*. Hiding the working directory behind a pointer would make the fleet unreadable to the keyboard, which is the way the fleet is actually read.

**There is no centred reading column.** A session detail that centres itself at a fixed max-width moves the same session's left edge depending on whether it was opened in the split pane or the full-width view. Session detail is **left-anchored to the pane gutter in both contexts**, and only prose blocks inside it cap at `--measure-prose`. A phantom centre is a worse defect than a long line, and 840px at 14px is 109 characters, which was never a reading measure to begin with.

### 3.4 Icons

`--icon: 14px`, `--icon-stroke: 1`, universally. `--icon-sm: 12px` inside a 20px chip or badge. There is no third size.

Every lucide import passes `strokeWidth={1}`, through a single wrapper (`components/ui/icon.tsx`). A bare lucide import outside that file is a lint error.

Icons are always leading. Icons always inherit `currentColor`, usually `--ink-4` at rest and `--ink-2` when the row is hovered or the control holds a value. An icon never takes a hue to signal state. The only coloured glyphs in the app are the runtime-extracted harness marks, and those are marks, not icons.

### 3.5 The hairline

```css
:root { --hairline-w: 1px; }
@media (min-resolution: 2dppx) { :root { --hairline-w: 0.5px; } }
```

One device pixel on every display. Drawn as `box-shadow: inset 0 0 0 var(--hairline-w) var(--hairline)`, never as `border`.

**The 0.5px draw halves the hairline's effective alpha,** because the engine antialiases it across one device pixel. The hairline is the only separation device in a tonally flat surface ramp, so it cannot afford a caveat: the alphas in section 1.7 are raised to 0.18 (dark) and 0.13 (light) to compensate, and `tokens:check` asserts the composited hairline clears 1.25:1 against each surface at full strength. Section 9's ban on half-pixel values is scoped to **font sizes**. The hairline is exempt by name.

### 3.6 Where a rule is allowed

Six sites. Count them, and never add a seventh without deleting one.

1. Under the top band.
2. Under a toolbar block (only where two toolbar bands stack).
3. Under a column-header row.
4. Under a tab strip.
5. Above a sticky footer (the composer, the context bar).
6. Down the sidebar's right edge. (The only vertical.)

**Inset versus full-bleed.** A rule inside a bounded container is inset by that container's horizontal padding, so a divider always terminates at the same x as the content it divides. A rule that marks the end of chrome is full-bleed. Inset rule means "these rows belong to one object." Full-bleed rule means "chrome ends here." That distinction is the entire API of `Separator`.

Whichever element occupies the window's top-left corner owns the traffic-light band, and that band is rule-free. No rule ever crosses the lights. (This is `DESIGN.md`'s shell law, restated here because it constrains the geometry.)

---

## 4. Elevation

Two shadows, plus the ring. Each begins with the ring, so the ring and the elevation are one property and a selection ring swap costs zero layout.

The raw tokens are named `--elev-*`, and they are exposed as **custom utilities, not shadow utilities**. `shadow-flat` on a chip is a sentence that invites someone to add a real shadow next to it.

```css
:root {
  --elev-ring:
    inset 0 0 0 var(--hairline-w) var(--hairline);

  --elev-raised:
    inset 0 0 0 var(--hairline-w) var(--hairline),
    0 1px 2px -1px var(--shade-1),
    0 4px 10px -4px var(--shade-2);

  --elev-overlay:
    inset 0 0 0 var(--hairline-w) var(--hairline),
    0 8px 24px -8px var(--shade-2),
    0 20px 64px -12px var(--shade-3);
}

@utility hairline { box-shadow: var(--elev-ring); }
@utility raised   { box-shadow: var(--elev-raised); }
@utility overlay  { box-shadow: var(--elev-overlay); }
```

| utility | permitted on |
|---|---|
| `hairline` | every bounded object: inputs, chips, buttons with a ring, the composer, a bounded list container, a preview tile |
| `raised` | exactly one thing at a time: an inline object the human has expanded or focused |
| `overlay` | a floating surface: command palette, dropdown, context menu, sheet, tooltip, toast |

Rows never get a shadow. Chips never get a shadow. A list container never gets a shadow. There is no `shadow-xs`, no `shadow-2xl`, and no stock Tailwind shadow anywhere in the app. All Tailwind shadow utilities are removed from the theme.

**No scrim, and the two things a scrim was doing.** An overlay earns its separation by elevation and inset alone. The page behind stays at full opacity and full contrast. `DESIGN.md` already forbids modals and interrupts except where genuinely necessary; this is the same rule expressed in pixels.

A scrim does two non-visual jobs, and both are kept: **the Radix `Overlay` element stays mounted, fully transparent, with `pointer-events` intact**, so click-outside-to-close still works and Radix still marks the page behind `aria-hidden` for screen readers. Delete the element and click-outside silently stops working. Style it to `background: transparent`; do not remove it.

---

## 5. Motion

Two durations. Nothing slower. Three properties.

```css
:root {
  --motion-fast: 160ms;   /* opacity, colour, background */
  --motion-base: 200ms;   /* shape, shadow, transform-in */
  --motion-ease-enter: cubic-bezier(0.2, 0, 0, 1);      /* decelerate */
  --motion-ease-morph: cubic-bezier(0.42, 0, 0.58, 1);  /* symmetric */
  --motion-ease-exit:  cubic-bezier(0.4, 0, 1, 1);      /* accelerate */
  --motion-press: translateY(1px);
}
```

Entrances decelerate. A symmetric ease-in-out on an entrance feels sluggish because the eye is already at the destination and is waiting for the pixels to arrive. Shape morphs (a radius or a background changing on an element already on screen) keep the symmetric curve, because there is no arrival. Exits accelerate and get out of the way.

- Hover is a token swap: `background-color: var(--overlay-hover)` over `--motion-fast`.
- Press is `transform: var(--motion-press)` over `--motion-fast`. Physical, tiny, felt and not seen. Every interactive control has one.
- A sheet opens in `--motion-base` and closes in `--motion-fast`. A 500ms open is a third of a second of the human's attention spent watching a drawer.
- Hover reveals; it does not decorate. A hovered row grows one inline icon button at its right edge and lifts one alpha step. Nothing moves. Nothing resizes. Hover never reveals a signal, only an action (see the `--row-list` argument in 3.3).
- Everything is gated behind `prefers-reduced-motion: reduce` in one rule, never per component.

---

## 6. Primitive vocabulary

`DESIGN.md`'s component contract stands: a commodity control is the shadcn primitive restyled onto these tokens, never a bespoke reimplementation and never stock shadcn. This section fixes the variant sets and the geometry those primitives resolve to.

| primitive | vocabulary |
|---|---|
| `Button` | `variant`: `primary` (iris solid, `--on-solid`, one per screen region) / `default` (hairline ring, transparent, ink) / `quiet` (no ring, `--ink-3`, gains a ring when it holds a value) / `danger` (block solid) / `danger-quiet`. `size`: `sm` 20px/r6, `md` 28px/r8 (default), `lg` 32px/r10. Label is `row`. Hover and press are overlays over the button's own fill, including on `primary`. |
| `IconButton` | `size`: `sm` 20 / `md` 28 / `lg` 32. Glyph always 14px. No ring at rest. Ring appears only when it holds a value or is toggled on. |
| `Chip` | `variant`: `state` (soft bg, contrast ink, 6px contrast dot, `micro`, sentence case) / `meta` (no fill, `--ink-3`, `micro`). `hue` is a prop, one of the eight. Height exactly 20px, radius 6px, because `--row-list` is derived from it. |
| `CountToken` | `tone`: `info` (transparent, `--ink-3`, `row` under `[data-numeric]`, followed by a lowercase noun) / `alert` (`--iris-solid` fill, `--on-solid`, full radius, 20px). Attention is a fill; information is an alpha. Only the sidebar unread badge is `alert`. |
| `Dot` | 6px circle, `--<hue>-contrast`. No sizes, no variants beyond `hue`. It never appears without an adjacent text label. |
| `Kbd` | A 20px box, radius 6, hairline ring, `micro`, `--ink-3`. **Renders on a surface only, never inside a solid fill.** |
| `Input` / `Textarea` / `Select` | `--surface-sunken` fill, hairline ring, no shadow. Input `md` 28px/r8, `lg` 32px/r10. Textarea r12, text is `prose`, max height 200px, scrolls internally, no nested `ScrollArea`. Label always above the control, 6px gap, `micro` at `--ink-2`. No floating labels. |
| `Toggle` / `ToggleGroup` | Active option is `--overlay-selected`, never a fill, never a weight change. Concentric group radius: r8 group over 20px/r6 options; r10 group over 28px/r8 options. |
| `Separator` | `orientation` plus `inset`. `inset` terminates at the container's padding and means "these rows belong to one object". Full-bleed means "chrome ends here" and is legal only at the six sites in 3.6. The `inset` prop is the whole point. |
| `Progress` | `hue` over the eight hues plus `neutral`, and **`neutral` is `--ink-3`**, not a ninth hue. Track is `--surface-sunken`, full radius, and carries **no hairline ring** (P3: the indicator would erase it on three edges). Indicator is `--<hue>-contrast`. Height 6px. |
| `Tabs` | Underline indicator, 2px, sized to the active tab's own width, in `--iris-contrast`. No pill, no fill. Inactive `--ink-3`, active `--ink`, both `row` at weight 500. The strip's closing hairline is rule site 4. |
| `Empty` | Two grades, **both outline-free: no dashed border, no box, in either grade.** `slot`: the slot's real height, a centred `row` title at `--ink-2`, one line of `--ink-3` prose, no button. `view`: `title` role, a two-line `--ink-3` description at a hard ~40ch measure, one `Button variant="primary"`. Body copy is `prose`. |
| `Tooltip` | `--surface-inverted` / `--ink-inverted`, r6, no arrow, `micro`, `overlay` elevation. One `delayDuration`, declared in the provider. |
| `Command` palette | `--w-palette` wide, top edge at `--band-palette-top`, r12 with 4px padding, `overlay` elevation, no scrim. Highlighted row is `--overlay-selected`, r8, inset 4px (concentric). |
| `ScrollArea` | 4px rounded thumb, no visible track, inset 6px from the surface edge, so the surface keeps its single-hairline silhouette. It is the **only** owner of scrollbar styling. |
| `ListRow` | One component owning `DESIGN.md`'s row anatomy: `[14px glyph][1fr]`, gap 8, pane gutter 24, three line boxes fixed at 20px. Selected is `--overlay-selected`, with no left bar. |
| `Avatar` | **Forbidden.** `DESIGN.md`: "No avatars." Identity in a row is the harness glyph. |

**The two full-round objects in the app** are the `Progress` bar and the `CountToken` `alert` badge. `Kbd` is a 20px box at r6, not a pill. There is no third.

Fleet's headline numbers and Metrics' numbers share one `StatRow`: label at `--ink-2` left, value in the `stat` role right-aligned and tabular, followed by a lowercase noun at `--ink-3`. No box, no divider, no shadow. A row of bordered, divided stat tiles is a card row, and cards do not exist.

---

## 7. What is forbidden

Not "discouraged." Forbidden. A PR containing any of these is wrong by definition.

- A drop shadow on a row, a chip, an input, a button, a bar, or a list container.
- A gradient on any surface. Glassmorphism. A backdrop blur.
- A modal scrim, or dimming the page behind any overlay. (Deleting the transparent Radix `Overlay` element is separately forbidden; see section 4.)
- `font-bold` anywhere. `font-semibold` outside `title` and `label`.
- Italic.
- A font size that is not one of 20 / 14 / 13 / 11 / 10.
- A half-pixel **font** size. (The 0.5px hairline is exempt by name.)
- Negative tracking on mono. Positive tracking on anything that is not uppercase.
- Uppercase on anything but `label`. State words render exactly as `DESIGN.md` spells them.
- Prose in mono. Chrome in sans.
- An arbitrary Tailwind length literal (`text-[13.5px]`, `px-[7px]`, `h-[30px]`, `rounded-[5px]`) in a component. If the value is right, it belongs in the scale. `[var(--token)]` is permitted and is the only permitted arbitrary value.
- A `border` property used to draw a box. Boxes get the `hairline` utility.
- A hardcoded surface swap for hover (`hover:bg-panel`). Hover is `--overlay-hover`, on every surface, including a solid fill.
- More than one filled accent button per screen region.
- A coloured active-nav fill, a left accent bar on an active row, or a bold active label. Active nav is `--overlay-selected`, inset 8px from both sidebar edges, at 8px radius.
- A coloured icon used to signal state.
- A status rendered as a filled coloured chip with white text. A state chip is `soft` background, `contrast` text, `contrast` dot.
- A vendor name in the token layer.
- An inline `className` restyle of a shared primitive. Extend the primitive.
- A native scrollbar, a native select, a native tooltip, a native context menu.
- A webfont fetched over the network at runtime.
- `outline-none` in a cva base string. It lands in `@layer utilities` and beats the global `:focus-visible` rule in `@layer base`, deleting every visible keyboard focus indicator in the app. This is a WCAG 2.4.7 failure and it is invisible to every automated gate the repo has.
- A `dark:` variant. The app themes with a `.light` class on `<html>`; `dark:` can never fire.

---

## 8. Reconciliation with `DESIGN.md`

`DESIGN.md` stays authoritative for everything listed at the top of this document. Four places genuinely conflicted. Each is resolved here, and `DESIGN.md` has been corrected in the same change that landed this file, so no stale law stands.

| conflict | `DESIGN.md` said | resolved |
|---|---|---|
| **Type polarity** | "Space Grotesk display, JetBrains Mono labels/metadata," which reads as sans body with mono accents. | **This document wins.** Mono is the chrome, sans is language. Sans appears in `title` and `prose` only. `DESIGN.md` now points here. |
| **`finished` colour** | "finished/neutral gray." | **`DESIGN.md` was stale**, and its own shipped token was already a blue. `finished` is `done`, hue 215, a blue. Neutral belongs to `stale`/`archived`. Corrected in `DESIGN.md`. |
| **`Empty`'s outline** | correctly rejects shadcn's stock dashed-border card. | **No conflict, and now explicit:** both grades are outline-free. A dashed box cannot be drawn with an inset box-shadow, so it would require the one `border` property section 7 forbids, in order to reintroduce the exact card `DESIGN.md` already rejected. |
| **Focus indicator** | "every focusable element shows a visible focus ring (one shared rule)." | **`DESIGN.md`'s intent wins, and this document makes it enforceable.** There is **one** focus indicator, the global `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`. Per-primitive `focus-visible:ring-[3px]` is a second owner and is deleted. `outline-none` must die in the same change as the ring, or the app ships with no focus indicator at all. The global rule does not need `border-radius: inherit`: that declaration sets the element's radius, not the outline's, and every modern engine already curves an outline to follow the element. |

Everything else composes.

**One owner per signal** is unchanged and is now extended one level down: **one owner per token.** A visual property has exactly one home. Two homes for the scrollbar (a `::-webkit-scrollbar` rule and a `ScrollArea`) is the same defect as two homes for a count. Likewise, "the active row's fill" has exactly one home, `--overlay-selected`, not one dialect per component.

**No cards.** A card is a surface that carries a resting shadow and groups content that could have sat on the page. Those do not exist. What does exist, and is not a card:

- a **bounded list container**: a hairline ring at 12px radius, zero shadow, zero background delta, wrapping a list of homogeneous rows whose separators are inset hairlines. Containment is reserved for data and refused for prose. A free text block never gets a container.
- a **composer**: ring, 12px radius, `--surface-sunken` well.
- a **preview tile** in Settings: ring, no shadow, no fill; selection swaps the neutral ring for an accent ring and nothing else.

**ScrollArea always, no native scrollbars.** Unchanged, and true only once the `::-webkit-scrollbar` rules are gone.

**Every count renders with a noun.** Unchanged, and now typographically enforced: a count is `row` under `[data-numeric]`, right-aligned, tabular, followed by a lowercase noun at `--ink-3`.

**Row anatomy** is unchanged. No avatars. There is no `Avatar` primitive and there will not be one.

---

## 9. The Tailwind bridge

Raw tokens and bridge keys never share a name. `--font-mono: var(--font-mono)` is self-referential; it survives only because Tailwind emits its copy inside `@layer theme` and an unlayered `:root` beats it regardless of order. It is a latent trap that fires the day anyone wraps `globals.css` in a layer. Raw tokens are therefore named `--elev-*`, `--motion-*`, `--font-*-stack`.

```css
@theme inline {
  /* --spacing stays at Tailwind's 4px default. Fractional steps are real. */

  --font-sans: var(--font-sans-stack);
  --font-mono: var(--font-mono-stack);

  --text-title: 20px;
  --text-title--line-height: 24px;
  --text-title--letter-spacing: -0.015em;
  --text-title--font-weight: 600;

  --text-prose: 14px;
  --text-prose--line-height: 20px;
  --text-prose--font-weight: 500;

  --text-stat: 20px;
  --text-stat--line-height: 24px;
  --text-stat--font-weight: 500;

  --text-row: 13px;
  --text-row--line-height: 20px;
  --text-row--font-weight: 500;

  --text-micro: 11px;
  --text-micro--line-height: 14px;
  --text-micro--font-weight: 500;

  --text-label: 10px;
  --text-label--line-height: 10px;
  --text-label--letter-spacing: 0.06em;
  --text-label--font-weight: 600;

  --color-surface-0: var(--surface-0);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-sunken: var(--surface-sunken);
  --color-surface-inverted: var(--surface-inverted);
  --color-ink:   var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-ink-4: var(--ink-4);
  --color-ink-inverted: var(--ink-inverted);
  --color-hairline: var(--hairline);
  --color-hover:    var(--overlay-hover);
  --color-press:    var(--overlay-press);
  --color-selected: var(--overlay-selected);
  --color-focus:    var(--focus);
  --color-on-solid: var(--on-solid);
  /* plus iris-solid, block-solid, and <hue>-contrast / -soft for the eight hues */

  --radius-1: 6px;
  --radius-2: 8px;
  --radius-3: 10px;
  --radius-4: 12px;

  --ease-enter: var(--motion-ease-enter);
  --ease-morph: var(--motion-ease-morph);
  --ease-exit:  var(--motion-ease-exit);
}
```

Elevation is exposed through `@utility hairline / raised / overlay` (section 4), not through a `--shadow-*` theme key, so that no chip ever wears a class named `shadow`.

There is no shadcn compatibility bridge. `--background`, `--card`, `--popover`, `--primary`, `--muted`, `--accent`, and `--sidebar-*` do not exist. That bridge maps `--card` to a panel in an app that forbids cards, and it exists to make stock shadcn look right, which is the one outcome we do not want. Radix primitives keep their behaviour; their styling comes from the tokens above directly.

**Deleting a `@theme` key does not raise an error; it silently stops generating the class.** `border-border`, `text-muted-foreground`, `bg-accent`, and `bg-sidebar-accent` become no-ops with no build error, no type error, and no test failure. Nothing in the toolchain except the grep gate in section 10 can see it. Treat any change to a `@theme` key as a change with no compiler behind it.

Every Tailwind default font size, radius, and shadow is removed from the theme so that the arbitrary-value escape hatch is the only way to be wrong, and lint closes it.

---

## 10. Enforcement

Rules nobody can check are wishes. Four gates, all cheap, all CI-safe.

**1. `npm run tokens:check`.** Parses `globals.css`, converts every authored oklch to sRGB, asserts each value is inside the gamut, composites alpha **source-over in sRGB**, computes WCAG 2.1 relative luminance, and asserts every row of the contract in section 1.8 across all five surfaces in both themes, plus the two orderings (selected beats hover; selected-plus-hover beats selected).

The compositing model is pinned because it is not obvious. sRGB source-over and oklab premultiplied interpolation disagree by up to 0.7 contrast points on these exact tokens. That is the difference between passing and failing, and if the checker and the compositor disagree about the model, the checker is asserting a property of a page nobody renders. This is also why the ink alphas are authored as `oklch(L C H / a)` rather than `color-mix(in oklab, ..., transparent)`: the explicit form has exactly one interpretation.

Any change to the palette is made by editing the tokens and re-running the checker. The published table in section 1.7 is output, never input; nobody edits a number in it by hand.

**2. An eslint rule** over `electron/renderer-vite/src/components` and `src/views`, rejecting:
- any arbitrary Tailwind value whose contents match a bare length literal, `\[[-0-9.]+(px|rem|em)\]`. `[var(--token)]` is explicitly allowed, because `w-[var(--sidebar-width)]` is legitimate and a blanket `w-[` ban would kill it.
- any spacing utility outside the permitted steps `0.5 1 1.5 2 2.5 3 4 6`.
- any `dark:` variant, any `font-bold`, any `font-semibold` outside the two roles.
- any `outline-none`.
- a bare `lucide-react` import outside `components/ui/icon.tsx`.

**3. A grep gate over a denylist of retired class names** (`bg-accent`, `text-muted-foreground`, `border-border`, `bg-sidebar-*`, `shadow-(xs|md|lg|2xl)`, `rounded-(sm|md|lg)`). Tailwind silently drops unknown classes rather than erroring, so lint is the only thing standing between a refactor and a hundred invisible no-ops.

**4. A fonts budget.** `scripts/bundle-size-check.js` sums only `.js` and `.css` from `dist/assets`, so woff2 is unmeasured and raising the JS budget for fonts would buy nothing. It carries a `fonts` budget over `.woff2` (four latin-subset files, roughly 90KB total). The gate genuinely at risk is CSS, where a naive font import that pulls latin-ext, cyrillic, greek, and vietnamese subsets adds five `@font-face` blocks per family.

Note what these gates cannot see. `scripts/perf-selftest/run.js` measures wall clock to DOM-ready rather than first contentful paint, so a `font-display: block` period would not trip it. A perf gate that cannot see the failure it was pointed at is worse than no gate: point the font rules at `bundle:check`, and read section 2.2 rather than trusting a green `perf:selftest`.
