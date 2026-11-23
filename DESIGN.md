---
name: Landturned
description: How the land around any address on Earth has changed, drawn like a site plan at night.
colors:
  night-sheet: "#0a0c0f"
  night-board: "#0e1115"
  hairline: "#1f252d"
  drafting-ink: "#e6e9ee"
  pencil-grey: "#8c96a3"
  faint-pencil: "#747f8e"
  built-orange: "#ffa01f"
  cleared-red: "#ff5a4f"
  gained-green: "#4fd98a"
  new-water-blue: "#3db8f5"
  night-veil: "rgba(10, 12, 15, 0.7)"
  ghost-line: "rgba(220, 228, 238, 0.35)"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(30px, 6vw, 40px)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(24px, 5vw, 30px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
  body:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.06em"
  kicker:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.12em"
  coordinates:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 500
rounded:
  none: "0px"
  dot: "50%"
spacing:
  hair: "6px"
  tight: "8px"
  row: "11px"
  gutter-phone: "16px"
  section: "22px"
  gutter-desktop: "28px"
components:
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.drafting-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  button-outline-hover:
    backgroundColor: "transparent"
    textColor: "{colors.drafting-ink}"
  place-chip:
    backgroundColor: "transparent"
    textColor: "{colors.drafting-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  search-field:
    backgroundColor: "{colors.night-sheet}"
    textColor: "{colors.drafting-ink}"
    rounded: "{rounded.none}"
    padding: "14px 12px 14px 8px"
  pin-card:
    backgroundColor: "rgba(10, 12, 15, 0.85)"
    textColor: "{colors.drafting-ink}"
    typography: "{typography.coordinates}"
    rounded: "{rounded.none}"
    padding: "7px 10px"
  callout-label:
    backgroundColor: "rgba(10, 12, 15, 0.85)"
    textColor: "{colors.drafting-ink}"
    rounded: "{rounded.none}"
    padding: "7px 10px"
  map-backing:
    backgroundColor: "{colors.night-veil}"
    textColor: "{colors.drafting-ink}"
    rounded: "{rounded.none}"
    padding: "6px 8px"
  stat-row:
    backgroundColor: "transparent"
    textColor: "{colors.drafting-ink}"
    typography: "{typography.label}"
    padding: "11px 0"
---

# Design System: Landturned

## Overview

**Creative North Star: "The Site Plan at Night"**

Landturned is a planner's drawing set laid out on a dark sheet. The satellite photo is the drawing's base layer, and everything Landturned adds sits on top of it the way annotations sit on a site plan: a square analysis boundary, a north arrow, a scale bar, a title block, a short legend, and a few lines of plain lettering. The interface is the drafting around the picture, never the picture itself. It is calm and honest: it states what was measured, where, between which years, and how rough the estimate is, without dramatising the change.

The sheet is dark because the photo and the four change colours need to glow against it, and because a lit plan read at night is the mood: quiet, focused, unhurried. Density is low. A visitor sees one image, one sentence and one short table at a time. Hierarchy comes from size, weight and the step from drafting ink down to pencil grey, never from boxes, fills or shadows.

Everything is square-cornered and drawn with 1 px lines. Labels and buttons speak in the "drawing voice", small uppercase monospace lettering spread a little apart, as on an architectural sheet, while sentences people actually read stay in normal sentence case. The four change colours are the only colour in the whole system, and each one means exactly one kind of change.

**Key Characteristics:**
- A dark sheet with off-white "ink": near-black backgrounds, light text, no light theme.
- The satellite photo and the globe lead; controls are quiet and drafted (thin outlines, no fills).
- Exactly four accent colours, each tied to one meaning (built, cleared, gained, water).
- Square corners, 1 px hairlines, no shadows.
- Two type voices: Space Grotesk for reading, JetBrains Mono uppercase for labels, buttons and coordinates.
- Drawing conventions as identity: survey marks, a north arrow, a scale bar, a square boundary, a title block, a legend.

## Colors

A night sheet of cool near-blacks and drafting-ink greys, lit only by the four change colours.

### Primary
The system has no single brand accent. Its "primary" role is shared by the four change colours, which are reserved for meaning:
- **Built Orange** (#ffa01f): newly built land. It marks orange change pixels on the map, the "Newly built" legend swatch, and the orange hectares in the reveal sentence.
- **Cleared Red** (#ff5a4f): green space cleared to bare ground, nothing built yet.
- **Gained Green** (#4fd98a): green space gained. It is also used for the ✓ of a finished loading step, the one place a change colour stands for "good, done".
- **New-Water Blue** (#3db8f5): new water. It also serves as the keyboard focus outline, chosen because it reads clearly (8.45:1) on the dark sheet.

### Neutral
- **Night Sheet** (#0a0c0f): the page and the stage behind the globe and map; also the inside of the search field, so the field sits slightly darker than the panel around it.
- **Night Board** (#0e1115): the text panel, one step lighter than the sheet so the panel and the stage read as two parts of the same drawing.
- **Hairline** (#1f252d): every 1 px divider and outline: the panel edge, the stats table rules, the outlines of buttons and the search field, the progress-bar track.
- **Drafting Ink** (#e6e9ee): all primary text, the scale bar, the north arrow, finished loading steps, and the survey-mark pin on the globe.
- **Pencil Grey** (#8c96a3): secondary text: the intro, the coordinates under a title, kickers, the "green space lost" total, and hover outlines.
- **Faint Pencil** (#747f8e): the least important text: the data note, the search hint, and loading steps not reached yet. It is kept at 4.66:1 on the panel so small text still meets WCAG AA.
- **Night Veil** (night-sheet at 70%): the backing behind everything drawn over the photo (scale bar and north arrow, the area label, the image credit), so annotations stay readable over bright imagery while the photo shows through.
- **Ghost Line** (drafting ink at 35%): the outline of annotation boxes that float over the globe or the map: the pin card, the callout label, and the line between the pin card's rows.

### Named Rules
**The Four Meanings Rule.** The only accent colours are the four change colours, and each one means exactly one kind of land change. Never use them for decoration, branding, or a generic state (the ✓ and the focus outline are the only reuses, and they are fixed).

**The Ink and Pencil Rule.** Text has three levels only: Drafting Ink for what people should read, Pencil Grey for support, Faint Pencil for small print. Any new text picks one of the three, and Faint Pencil never goes below 4.5:1.

## Typography

**Display Font:** Space Grotesk (with system-ui, sans-serif)
**Body Font:** Space Grotesk (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** Space Grotesk is a slightly technical grotesque that still reads warmly in full sentences. JetBrains Mono supplies the drawing lettering: even-width capitals for labels, buttons and coordinates, the way an architect letters a sheet.

### Hierarchy
- **Display** (500, 30–40 px fluid, 1.05 line height, −0.02em): the landing headline, "Every place on Earth has turned.", with its four-colour underline under "turned.".
- **Headline** (500, 24–30 px fluid, 1.15): the reveal sentence on the result page, with the hectares in their change colour and the place name underlined by a thin Pencil Grey line.
- **Title** (500, 28 px): the place name (or coordinates) in the locating panel.
- **Body** (400, 15 px, 1.5): the intro and other reading text, in Pencil Grey.
- **Small** (400, 12–13 px, 1.45–1.5): the data note, the green-space total, messages and loading steps.
- **Label** (400, 12 px, 0.06em, uppercase via CSS): the drawing voice for buttons, place buttons and stats rows. Hectare figures in the stats keep normal case at 13 px with tabular numbers so the column lines up and "ha" stays correct.
- **Kicker** (400, 11 px, 0.12em, uppercase): small sheet labels such as "OR START WITH A PLACE THAT TURNED", "LOCATING" and the callout's "SITE · …" line.
- **Coordinates** (mono, 13 px, 500): the pin card; map labels use mono at 10–11 px (area label, scale numbers, the "N").

### Named Rules
**The Drawing Voice Rule.** Labels, buttons and tags are lettered like drawing annotations: mono, uppercase through `text-transform` (so screen readers read words, not letters), slightly spread. Anything people read as a sentence stays in sentence case; on a drawing too, long text is never set in capitals.

**The No-Bold Rule.** The heaviest weight in use is 500. Emphasis comes from size, ink level or a change colour, never from bold.

## Layout

The app is two panes. On screens at least 900 px wide, a fixed 400 px text panel sits on the left with a hairline on its right edge, and the stage (globe, then map) fills the rest. Below 900 px, the stage takes the top 56% of the screen and the panel scrolls underneath, separated by a hairline across the top. The whole page never scrolls; only the panel does.

Panel gutters are 16 px on phones and 28 px on desktop (32 px top on desktop). Vertical rhythm is built from a small set of steps: 6–8 px between paired controls, about 10–12 px between a label and what it labels, 22 px between sections. The stats table uses 11 px row padding with hairline rules above and between rows, like a schedule on a drawing.

On phones the landing panel is trimmed to fit below the globe without scrolling: the sheet label is hidden and the place buttons become one sideways-scrolling row that fades out at the right edge. Overlays on the stage switch at a stage width of 700 px: below it, the callout label and the pin card sit centred above their mark instead of beside it, and both are kept 8 px inside the stage edges.

The map itself is turned grid-up so the square analysis area sits straight, and the north arrow turns with it to keep pointing at true north.

## Elevation & Depth

Landturned is flat. There are no shadows anywhere. Depth comes from three dark tones (Night Sheet for the page, Night Board for the panel, Night Veil over the imagery) and from 1 px lines. The only glow in the system is the faint atmosphere ring drawn around the globe, which belongs to the globe drawing, not to the interface.

### Named Rules
**The Flat Sheet Rule.** Nothing casts a shadow. To separate a layer, use a darker tone, a translucent veil or a hairline, the way a drawing separates its parts.

## Shapes

The form language is the drawing sheet: square corners (0 px radius) on every panel, button, field, card and label. Boundaries are 1 px lines (Hairline on the panel, Ghost Line over imagery). The only round forms are things that are round on a drawing: the 8 px dots that colour-code the place buttons, the hotspot dots and rings on the globe, the ring of the callout mark, the circle of the survey-mark pin, and the small ⓘ credit button on phones.

Recurring drawing marks are part of the shape vocabulary:
- the **survey mark** (a circle with a cross through it and a gap at the centre) for a tapped point
- the **square analysis boundary** labelled "ANALYSIS AREA · 2 × 2 KM"
- the **north arrow** and a two-block **scale bar** on a Night Veil backing
- **leader lines** from a mark to its label.

## Components

### Buttons
Quiet and drafted: an outline, a label, nothing else.
- **Shape:** square corners (0 px), 1 px Hairline outline, no fill.
- **Default:** Drafting Ink label in the drawing voice (mono 12 px uppercase, 0.06em), padding about 8 px × 14 px ("← NEW PLACE") or 0 × 10 px at field height ("MY LOCATION", with a drawn crosshair in Pencil Grey).
- **Hover:** the outline brightens from Hairline to Pencil Grey; nothing moves.
- **Focus:** a 2 px New-Water Blue outline, 2 px outside the button.
- **Busy:** the button's drawn icon pulses gently (it stays still and faded under reduced motion), and the cursor shows progress.

### Chips
- **Style:** the place buttons under the search box. Outlined like buttons (1 px Hairline, square), with an 8 px round dot in the place's change colour before the name, drawing-voice label, padding 7 × 11 px.
- **State:** hover brightens the outline; on phones they form one sideways-scrolling row that snaps to each chip.

### Cards / Containers
- **Corner Style:** square (0 px).
- **Background:** the panel is Night Board; annotation boxes over imagery (pin card, callout label) are Night Sheet at 85%.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** Ghost Line around annotation boxes; Hairline for panel edges.
- **Internal Padding:** 7 × 10 px for annotation boxes.

### Inputs / Fields
- **Style:** the search field is one outlined bar: 1 px Hairline, square, filled with Night Sheet so it sits a step darker than the panel. A drawn magnifier in Faint Pencil on the left, 16 px text (so phones don't zoom in), and a hint in Faint Pencil.
- **Focus:** the whole bar gets the 2 px New-Water Blue outline (the text box itself has none).
- **Submit:** a drawn arrow appears at the right only once something is typed; it is Pencil Grey, brightening to Drafting Ink on hover.

### Navigation
There is no navigation bar. Movement between states is the globe-to-map transition, the "← NEW PLACE" button, and the address bar, which always holds the current place.

### Pin card
The label of a tapped point on the globe, built like a two-row title block: the coordinates in mono on the first row, and a full-width "SHOW CHANGE →" button on the second, separated by a Ghost Line. It sits beside the survey mark on wide stages and centred above it on narrow ones.

### Callout label
The annotation that marks a chosen place while the globe turns: a ring at the place, a leader line up to a Night Sheet (85%) box with a Ghost Line border, holding a kicker ("SITE · …") and the place name. On narrow stages the leader line is dropped and the box sits centred above the ring.

### Stats table
A legend and a schedule in one: four rows, each with a 12 px square swatch in its change colour, the change name in the drawing voice, and the hectares right-aligned in tabular figures, separated by Hairline rules.

### Title-block marks
Over the map: a solid Drafting Ink north arrow with an "N", a two-block scale bar (one solid, one dark) with 0 / middle / end labels in mono, and the "ANALYSIS AREA · 2 × 2 KM" label at the boundary's corner, all on Night Veil backings.

## Do's and Don'ts

### Do:
- **Do** keep every corner square (0 px) and every boundary a 1 px line.
- **Do** use the four change colours only for their meanings: Built Orange (#ffa01f), Cleared Red (#ff5a4f), Gained Green (#4fd98a), New-Water Blue (#3db8f5).
- **Do** letter labels, buttons and tags in the drawing voice (JetBrains Mono, 12 px, uppercase via CSS, 0.06em) and keep sentences in sentence case.
- **Do** put anything drawn over the photo or the globe on a Night Veil backing or a Night Sheet (85%) box with a Ghost Line border.
- **Do** keep small text at 4.5:1 or more; Faint Pencil (#747f8e) is the lowest allowed text colour on the dark sheet.
- **Do** show keyboard focus with a 2 px New-Water Blue outline.
- **Do** reach for drawing conventions (survey marks, scale bars, north arrows, legends, title blocks) when a new element needs a form.

### Don't:
- **Don't** add shadows, glows or gradients to interface elements; the system is flat.
- **Don't** draw patterns, hatching or textures over the satellite imagery; overlays on the photo stay clean colour.
- **Don't** introduce a fifth accent colour or use a change colour as decoration.
- **Don't** use bold; 500 is the heaviest weight.
- **Don't** fill buttons or give them rounded corners; controls stay quiet and drafted so the imagery leads.
- **Don't** use MapLibre's built-in globe or a small locator "key map" globe; the landing globe is D3 linework only.
- **Don't** imitate watch.earth's signatures, such as a serif-italic accent word in the headline.
