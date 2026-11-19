# Design brief: "How this works" (SHEET 01 · METHOD)

Confirmed with the user on 2026-11-19 via `/impeccable shape`. Visual rules come from `DESIGN.md`; product truth from `PRODUCT.md`.

## 1. Job and audience
A **Read** page. Curious visitors arrive from the landing page or from a result's small print, often on a phone, with two or three minutes. Planners and portfolio reviewers come to check that the method is sound.

## 2. Outcome
After reading, a visitor can say in one sentence: *"They compare two land-cover maps pixel by pixel and count what changed, so it's an estimate, not a survey."* Trust comes from showing the limits, not hiding them. Every number shown is true: 40,000 pixels per square, 0.01 ha per pixel, the 30 m rule, 2017 to the latest year.

## 3. Direction
One vertical sheet in the drawing style, in this order:

- **A. Title block:** "How Landturn estimates change", plus one framing line: estimates from satellite-based maps, not exact science.
- **B. The idea as a clean diagram (made-up, labelled "Diagram"):** a minimal 2 × 2 km square becomes a grid, gets labels for two years, changed cells take their change colour, and they are counted. Hairlines, the four colours, no fluff. Each scroll step adds one stage.
- **C. Real pixels:** a small real patch from Ontario Ranch (about 400 × 400 m, 40 × 40 pixels), 2017 and 2023. Tap a pixel to see its label in both years.
- **D. The explorer (focal moment):** the same real patch with a year slider (2017 to the latest year), an "edge cleaning on/off" switch, and the hectares recounted live.
- **E. Why it's an estimate:** four short honest notes, each with a tiny pixel illustration: labels can be wrong; edges are fuzzy (the 30 m rule); clouds mean no data; 10 m is coarse.
- **F. Sources:** dataset, years, resolution, credits, and a way back to the globe.
- **Inside the result:** a small "What am I looking at?" link in the result panel opens a three-line explanation (the colours, how they're counted, that it's an estimate) with "How this works →" to the full page.

## 4. Scope and boundaries
In scope: the full page (production quality, phone and desktop), the short in-result explanation, links from the landing page and the result note. Untouched: the analysis, the map, the globe.
Must not: hype, false precision, patterns over imagery, stock illustrations or icons, a long essay, unlabelled made-up data, a fifth colour.

## 5. States and data
The real patch is computed once by the app's own analysis and shipped as a small data file, so the page works when the backend is down. Reduced motion: steps appear without animation. Colour never carries meaning alone: every readout names its category.

## 6. Interaction and layout
Phone: one column, text and its diagram stacked. Desktop: the diagram may stay in view while the text scrolls. Pixels, slider and switch work by keyboard; the recounted hectares are announced to screen readers.

## 7. Constraints and open decisions
Plain JavaScript, a second page built by Vite (e.g. `/how/`). To choose and show the user: the exact real patch (a clear farmland → houses change with a little edge noise, so the cleaning switch has something to show). Open: the page address and the exact link wording.
