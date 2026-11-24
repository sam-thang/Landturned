# Sharing: the pictures people can download or that appear when a Landturned link is shared.
# - The long view as an animated GIF (1985 -> today) and as one "sheet" picture with all nine years in a 3 x 3 grid.
# - Link previews ("Open Graph" cards, 1200 x 630): messaging apps and social sites show this picture under a shared
#   link. They don't run the site's JavaScript, so the server draws the card and writes its address into the page.
# Everything is drawn with Pillow in the site's own look: the dark sheet, the four change colours, the two typefaces.
# Only Landsat photos (public domain, credited to USGS) and our own change maps are drawn: never Esri's imagery.

import base64  # Built into Python; reads the change picture, which comes as base64 text inside a data URL
import functools  # Built into Python; lru_cache remembers finished cards, so the same one isn't drawn twice
import html  # Built into Python; makes text safe to put inside the page's HTML
import io  # Built into Python; lets us "save a file" into memory instead of onto the disk
import math  # Built into Python; isfinite checks the coordinates are real numbers
import re  # Built into Python; finds the preview tags in the page to replace their contents
from datetime import date  # Built into Python; writes dates the American way
from pathlib import Path  # Built into Python; a handy way to build file paths
from urllib.parse import urlencode  # Built into Python; writes "lat=...&name=..." with every character made safe for an address

from PIL import Image, ImageDraw, ImageFont  # Pillow: makes pictures, draws lines and text on them, and loads fonts

from app import analysis, longview  # Our own code: the land-cover analysis (for the square and the numbers) and the long view's photos

# ---------- The site's look ----------

FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"  # backend/assets/fonts: Space Grotesk and JetBrains Mono (Open Font License)
SHEET = (10, 12, 15)  # Night Sheet: the page background
BOARD = (14, 17, 21)  # Night Board: the panel, one step lighter
HAIRLINE = (31, 37, 45)  # Hairline: thin dividers
INK = (230, 233, 238)  # Drafting Ink: main text
MUTED = (140, 150, 163)  # Pencil Grey: secondary text
FAINT = (116, 127, 142)  # Faint Pencil: small print
CHANGE_COLOURS = {"built": (255, 160, 31), "cleared": (255, 90, 79), "gained": (79, 217, 138), "water": (61, 184, 245)}  # The four change colours
SITE = "landturned.com"  # The address printed on every picture
CREDIT = "Landsat imagery courtesy of the U.S. Geological Survey"  # The credit USGS asks for

# ---------- Lettering ----------


@functools.lru_cache(maxsize=32)  # Fonts are loaded once per size and weight
def font(family, size, weight="Regular"):
    """One of the site's two typefaces ("sans" = Space Grotesk, "mono" = JetBrains Mono) at a size and weight."""
    face = ImageFont.truetype(str(FONT_DIR / ("SpaceGrotesk.ttf" if family == "sans" else "JetBrainsMono.ttf")), size)  # Load the font file at this size
    face.set_variation_by_name(weight)  # Both are "variable" fonts (one file, every weight): pick the weight by name, e.g. "Medium"
    return face  # Ready to draw with


def draw_label(draw, xy, text, size, fill, spacing=0.1, weight="Regular"):
    """Draw a drawing-voice label (mono capitals, letters spread apart) and return its width."""
    face = font("mono", size, weight)  # The mono font
    x, y = xy  # Where it starts
    for letter in text.upper():  # One letter at a time, so we can add the spacing between them
        draw.text((x, y), letter, font=face, fill=fill)  # Draw the letter
        x += face.getlength(letter) + size * spacing  # Move on by its width plus the spacing
    return x - xy[0] - size * spacing  # The label's width (without the spacing after the last letter)


def label_width(text, size, spacing=0.1):
    """How wide draw_label would draw a label, without drawing it."""
    face = font("mono", size)  # The mono font
    return sum(face.getlength(letter) for letter in text.upper()) + size * spacing * (len(text) - 1)  # Letters plus the gaps between them


def tag(draw, xy, text, size=15):
    """A map label: drawing-voice text on a solid Night Sheet backing, like "1995 · JUL 24 · LANDSAT 5" on the site."""
    x, y = xy  # Its top-left corner
    width = label_width(text, size)  # How wide the text is
    draw.rectangle([x, y, x + width + 16, y + size + 12], fill=SHEET)  # The backing, 8 px around the text sideways, 6 px up and down
    draw_label(draw, (x + 8, y + 5), text, size, INK)  # The text


def wrap_segments(segments, face, width):
    """Split coloured text into lines that fit a width. "segments" is a list of (text, colour); returns a list of lines,
    each a list of (word, colour), so a sentence can have one coloured number in it, like the site's result sentence."""
    lines, line, used = [], [], 0  # The finished lines, the line being filled, and its width so far
    space = face.getlength(" ")  # The width of a space
    for text, colour in segments:  # Each piece of the sentence
        for word in text.split(" "):  # Each word in it
            if not word:  # Two spaces in a row, or a space at the start or end:
                continue  # nothing to place
            w = face.getlength(word)  # The word's width
            if line and used + space + w > width:  # It doesn't fit on this line:
                lines.append(line)  # finish the line...
                line, used = [], 0  # ...and start a new one
            used += (space if line else 0) + w  # Add the word (and the space before it, unless it starts the line)
            line.append((word, colour))  # Keep it
    if line:  # The last line
        lines.append(line)  # Keep it too
    return lines  # The lines


def draw_lines(draw, xy, lines, face, line_height):
    """Draw lines made by wrap_segments, word by word in their colours. Returns the y just below the last line."""
    x0, y = xy  # Where the first line starts
    space = face.getlength(" ")  # The width of a space
    for line in lines:  # Each line
        x = x0  # Back to the left edge
        for word, colour in line:  # Each word
            draw.text((x, y), word, font=face, fill=colour)  # Draw it in its colour
            x += face.getlength(word) + space  # Move on past it and a space
        y += line_height  # Down to the next line
    return y  # Just below the last line

# ---------- The facts drawn on the pictures ----------


def short_name(name):
    """The part of a place name before the first comma, like the site's sentence ("Fontana, California" -> "Fontana")."""
    return name.split(",")[0].strip() if name else None  # None stays None (a spot without a name)


def main_result(lat, lon):
    """The land-cover analysis's main result (first -> latest year) for a place, or None when there's no land-cover data."""
    try:  # The analysis is saved on disk for places seen before, so this is usually instant (a new place takes a few seconds)
        return analysis.analyse(lat, lon)["changes"][-1]  # The last comparison is the main result
    except LookupError:  # No land-cover data here (e.g. at sea)
        return None  # Nothing to show


def sentence_segments(name, change):
    """The site's result sentence as coloured pieces, e.g. [("Between 2017 and 2024, Fontana turned ", ink), ("45.2 hectares", orange), ...].
    The same wording as frontend/src/results.js, so a preview says what the site says."""
    s = change["stats_ha"]  # The hectares of each change
    start = f"Between {change['years']['from']} and {change['years']['to']}, "  # e.g. "Between 2017 and 2024, "
    place = short_name(name) or "this area"  # The place's short name, or "this area"
    options = {key: s[key] for key in ("built", "cleared", "gained", "water")}  # The four changes
    if sum(options.values()) < 1:  # Less than 1 hectare in all (the site's "little changed" rule)
        return [(f"{start}little changed around {place}: less than 1 hectare.", INK)]  # One plain sentence
    key = max(options, key=options.get)  # The biggest change
    number = (f"{s[key]:.1f} hectares", CHANGE_COLOURS[key])  # Its hectares, in its colour
    if key == "built":  # Orange story
        return [(f"{start}{place} turned ", INK), number, (" of land into buildings.", INK)]
    if key == "cleared":  # Red story
        return [(f"{start}{place} lost ", INK), number, (" of green space to bare ground.", INK)]
    if key == "gained":  # Green story
        return [(f"{start}{place} gained ", INK), number, (" of green space.", INK)]
    return [(start, INK), number, (f" around {place} became water.", INK)]  # Blue story


def plain_sentence(name, change):
    """The result sentence as plain text (for the link preview's description)."""
    return "".join(text for text, _ in sentence_segments(name, change))  # The pieces joined, without colours


def photo_pixels(point, corners):
    """Where a [lon, lat] point falls on a long-view photo, in its 500 x 500 pixels (the same sum as longview.js's toPhotoPixels)."""
    (tl_lon, tl_lat), (tr_lon, tr_lat), _, (bl_lon, bl_lat) = corners  # The photo's top-left, top-right and bottom-left corners
    ax, ay = tr_lon - tl_lon, tr_lat - tl_lat  # The top edge
    bx, by = bl_lon - tl_lon, bl_lat - tl_lat  # The left edge
    px, py = point[0] - tl_lon, point[1] - tl_lat  # The point, from the top-left corner
    det = ax * by - ay * bx  # The two small equations' determinant
    u = (px * by - py * bx) / det  # How far along the top edge (0 to 1)
    v = (ax * py - ay * px) / det  # How far down the left edge (0 to 1)
    return u * longview.SIZE_PX, v * longview.SIZE_PX  # In the photo's pixels


def frame_picture(record, jpeg, square_points, size, with_tag=True):
    """One long-view year as a picture of a given size: the photo (or a dark "no photo" square), the analysis square
    if wanted (square_points: its corners in the photo's pixels, or None), and the date tag in the corner."""
    if jpeg is None:  # No photo for this year:
        picture = Image.new("RGB", (size, size), BOARD)  # A dark square...
        draw = ImageDraw.Draw(picture)  # ...with a pen
        words = f"No clear summer photo near {record['slot']}"  # What to say
        draw_label(draw, ((size - label_width(words, 14)) / 2, size / 2 - 7), words, 14, MUTED)  # Centred
        return picture  # Done
    picture = Image.open(io.BytesIO(jpeg)).convert("RGB").resize((size, size), Image.LANCZOS)  # The photo at the wanted size
    draw = ImageDraw.Draw(picture)  # A pen for it
    if square_points:  # The analysis square, if wanted:
        scale = size / longview.SIZE_PX  # From photo pixels to this picture's pixels
        points = [(x * scale, y * scale) for x, y in square_points]  # Its corners here
        closed = points + points[:1]  # Back to the first corner, so the outline closes
        draw.line(closed, fill=SHEET, width=4, joint="curve")  # A dark line underneath... ("joint": corners drawn whole; Pillow's thick polygon outlines leave a notch)
        draw.line(closed, fill=INK, width=2, joint="curve")  # ...and the light line on top, like on the site
    day = date.fromisoformat(record["date"])  # The photo's date
    if with_tag:  # The date tag in the corner (the sheet leaves it off: its labels under the photos say the same)
        tag(draw, (10, 10), f"{day.year} · {day:%b} {day.day} · {record['satellite']}")  # e.g. "1995 · JUL 24 · LANDSAT 5"
    return picture  # Done


def long_view_material(lat, lon, square, saved_only=False):
    """Everything the long-view pictures need: (frames {slot: (record, jpeg or None)}, square corners in photo pixels or None).
    With saved_only, only frames already saved are used (link previews must not wait for new ones)."""
    if saved_only:  # Previews:
        answer = longview.saved_long_view(lat, lon)  # Only what's saved
        frames = answer["frames"]  # {slot: (record, jpeg)}
    else:  # Downloads: make anything missing (normally all saved already, since people download after watching)
        answer = longview.long_view(lat, lon)  # All nine
        frames = {record["slot"]: (record, jpeg) for record, jpeg in answer["frames"]}  # {slot: (record, jpeg or None)}
    points = None  # No square unless wanted and known
    if square:  # Wanted:
        change = main_result(lat, lon)  # The analysis (its square's corners)
        if change:  # There is a square here:
            points = [photo_pixels(corner, answer["corners"]) for corner in change["image"]["corners"]]  # Its corners on the photos
    return frames, points  # The material

# ---------- Long-view downloads ----------

GIF_SIZE = 500  # Each GIF frame's photo: 500 x 500 pixels, the photos' own size
GIF_FOOTER = 64  # The strip under the photo with the place, the address and the credit
GIF_STEP_MS = 900  # Each year shows this long...
GIF_LAST_MS = 2500  # ...and the last one longer, before the loop starts again


def footer(draw, y, width, name, first, last):
    """The strip under a GIF frame: the place and years on the left, the site's address on the right, the credit below."""
    draw.rectangle([0, y, width, y + GIF_FOOTER], fill=SHEET)  # The strip's background
    draw.text((14, y + 10), f"{short_name(name) or 'This place'} · {first} → {last}", font=font("sans", 20, "Medium"), fill=INK)  # e.g. "Fontana · 1985 → 2025"
    draw_label(draw, (width - 14 - label_width(SITE, 12), y + 16), SITE, 12, MUTED)  # The address, right-aligned
    draw_label(draw, (14, y + 42), "Photos only · " + CREDIT, 9, FAINT, spacing=0.06)  # The small print


def long_view_gif(lat, lon, name, square):
    """The long view as an animated GIF: each year's photo for GIF_STEP_MS, looping, with the footer. Returns the bytes."""
    frames, points = long_view_material(lat, lon, square)  # The photos and the square
    slots = sorted(frames)  # The slots in order
    pictures = []  # One finished picture per year
    for slot in slots:  # Each year
        record, jpeg = frames[slot]  # Its photo
        canvas = Image.new("RGB", (GIF_SIZE, GIF_SIZE + GIF_FOOTER), SHEET)  # The photo plus the footer strip
        canvas.paste(frame_picture(record, jpeg, points, GIF_SIZE), (0, 0))  # The photo at the top
        footer(ImageDraw.Draw(canvas), GIF_SIZE, GIF_SIZE, name, slots[0], slots[-1])  # The strip below
        pictures.append(canvas.quantize(colors=256, method=Image.Quantize.MEDIANCUT))  # GIFs hold 256 colours per frame: pick the best 256 for this one
    buffer = io.BytesIO()  # A "file" in memory
    durations = [GIF_STEP_MS] * (len(pictures) - 1) + [GIF_LAST_MS]  # How long each frame shows (the last one longer)
    pictures[0].save(buffer, format="GIF", save_all=True, append_images=pictures[1:], duration=durations, loop=0, optimize=True)  # An animated GIF that loops for ever (loop=0)
    return buffer.getvalue()  # The bytes


SHEET_CELL = 500  # Each year in the sheet: 500 x 500 pixels
SHEET_GAP = 16  # Space between the years
SHEET_HEADER = 120  # The title block at the top
SHEET_LABEL = 52  # The label under each year


def long_view_sheet(lat, lon, name, square):
    """The long view as one picture: a title block, then the nine years in a 3 x 3 grid, each labelled. Returns JPEG bytes."""
    frames, points = long_view_material(lat, lon, square)  # The photos and the square
    slots = sorted(frames)  # The slots in order
    columns = 3  # Three years per row
    rows = math.ceil(len(slots) / columns)  # Three rows for nine years
    width = columns * SHEET_CELL + (columns + 1) * SHEET_GAP  # The sheet's width
    height = SHEET_HEADER + rows * (SHEET_CELL + SHEET_LABEL + SHEET_GAP) + 40  # Its height, with room for the credit at the bottom
    sheet = Image.new("RGB", (width, height), SHEET)  # A blank dark sheet
    draw = ImageDraw.Draw(sheet)  # A pen for it
    draw_label(draw, (SHEET_GAP, 22), f"Landturned · Long view · {slots[0]} → {slots[-1]}", 13, MUTED)  # The kicker
    draw.text((SHEET_GAP, 44), f"{short_name(name) or 'This place'} from {slots[0]} to {slots[-1]}", font=font("sans", 44, "Medium"), fill=INK)  # The heading, like the site's
    block = "Photos only · 30 m · not measured"  # The title block's line
    draw_label(draw, (width - SHEET_GAP - label_width(block, 14), 30), block, 14, INK)  # Right-aligned at the top
    draw_label(draw, (width - SHEET_GAP - label_width("15 × 15 km · summer · Landsat 5, 7, 8, 9", 12), 60), "15 × 15 km · summer · Landsat 5, 7, 8, 9", 12, MUTED)  # The facts under it
    draw.line([SHEET_GAP, SHEET_HEADER - 14, width - SHEET_GAP, SHEET_HEADER - 14], fill=HAIRLINE, width=1)  # A hairline under the title block
    for index, slot in enumerate(slots):  # Each year
        record, jpeg = frames[slot]  # Its photo
        x = SHEET_GAP + (index % columns) * (SHEET_CELL + SHEET_GAP)  # Its column's left edge
        y = SHEET_HEADER + (index // columns) * (SHEET_CELL + SHEET_LABEL + SHEET_GAP)  # Its row's top edge
        sheet.paste(frame_picture(record, jpeg, points, SHEET_CELL, with_tag=False), (x, y))  # The photo (its date goes in the label below)
        below = y + SHEET_CELL + 8  # The label's line
        draw.text((x, below), str(slot), font=font("sans", 26, "Medium"), fill=INK)  # The slot's year, large
        if jpeg is not None:  # A photo: its date and satellite beside the year
            day = date.fromisoformat(record["date"])  # The date
            note = f"{day:%b} {day.day}, {day.year} · {record['satellite']}"  # e.g. "Jul 24, 1995 · Landsat 5"
            if record.get("substituted"):  # Another year stood in:
                note += f" · nearest clear year"  # say so
            draw_label(draw, (x + 80, below + 9), note, 12, MUTED, spacing=0.06)  # Beside the year
    draw_label(draw, (SHEET_GAP, height - 30), f"{SITE} · {CREDIT}, via Microsoft Planetary Computer", 11, FAINT, spacing=0.06)  # The credit at the bottom
    buffer = io.BytesIO()  # A "file" in memory
    sheet.save(buffer, format="JPEG", quality=90, subsampling=0)  # A sharp JPEG (full-sharpness colour)
    return buffer.getvalue()  # The bytes

# ---------- Link preview cards (1200 x 630) ----------

CARD_W, CARD_H = 1200, 630  # The size messaging apps and social sites expect


def card_frame(draw):
    """What every card has: the four-colour bar (like the underline of "turned." on the site) and the address."""
    for i, colour in enumerate(CHANGE_COLOURS.values()):  # The four colours, in the site's order
        draw.rectangle([60 + i * 50, CARD_H - 62, 60 + i * 50 + 44, CARD_H - 57], fill=colour)  # One short bar each, with gaps
    draw_label(draw, (CARD_W - 60 - label_width(SITE, 18), CARD_H - 70), SITE, 18, MUTED)  # The address, bottom right


def to_jpeg(picture):
    """A card as JPEG bytes (small enough for every app's preview)."""
    buffer = io.BytesIO()  # A "file" in memory
    picture.save(buffer, format="JPEG", quality=88, subsampling=0)  # Saved sharply
    return buffer.getvalue()  # The bytes


@functools.lru_cache(maxsize=1)  # Drawn once
def default_card():
    """The card for the site itself: the landing headline with its four-colour underline."""
    card = Image.new("RGB", (CARD_W, CARD_H), SHEET)  # The dark sheet
    draw = ImageDraw.Draw(card)  # A pen
    draw_label(draw, (60, 70), "Landturned", 18, MUTED)  # The name, as a sheet label
    big = font("sans", 92, "Medium")  # The headline's size
    draw.text((60, 150), "Every place on Earth", font=big, fill=INK)  # The headline, first line
    draw.text((60, 255), "has turned.", font=big, fill=INK)  # ...second line
    left = 60 + big.getlength("has ")  # Where "turned." starts
    width = big.getlength("turned.")  # How wide it is
    for i, colour in enumerate(CHANGE_COLOURS.values()):  # Its underline in the four colours, like on the site
        draw.rectangle([left + i * width / 4, 372, left + (i + 1) * width / 4 - 6, 379], fill=colour)  # One quarter each, with small gaps
    draw.text((60, 420), "See how the land around any address on Earth has changed.", font=font("sans", 32), fill=MUTED)  # The intro
    draw_label(draw, (CARD_W - 60 - label_width(SITE, 18), CARD_H - 70), SITE, 18, MUTED)  # The address
    return to_jpeg(card)  # Done


@functools.lru_cache(maxsize=64)  # The last 64 cards are kept in memory
def place_card(lat, lon, name):
    """The card for a result: the place, the result sentence with its number in colour, and the change square as drawn
    on the site (the colours on the dark sheet, without the photo). Falls back to the site's card without land-cover data."""
    change = main_result(lat, lon)  # The main result
    if change is None:  # No data here:
        return default_card()  # the site's own card
    card = Image.new("RGB", (CARD_W, CARD_H), SHEET)  # The dark sheet
    draw = ImageDraw.Draw(card)  # A pen
    draw_label(draw, (60, 62), f"Landturned · {change['years']['from']} → {change['years']['to']}", 18, MUTED)  # The kicker
    draw.text((60, 100), short_name(name) or f"{lat:.4f}, {lon:.4f}", font=font("sans", 64, "Medium"), fill=INK)  # The place (or its coordinates)
    face = font("sans", 36)  # The sentence's size
    lines = wrap_segments(sentence_segments(name, change), face, 560)  # The sentence, wrapped to the left column
    draw_lines(draw, (60, 205), lines[:5], face, 48)  # Drawn (at most 5 lines)
    side = 450  # The square's size on the card
    x, y = CARD_W - 60 - side, 90  # Its top-left corner
    png = base64.b64decode(change["image"]["url"].split(",", 1)[1])  # The change picture (a data URL: "data:image/png;base64,...")
    colours = Image.open(io.BytesIO(png)).convert("RGBA").resize((side, side), Image.NEAREST)  # Scaled up, keeping its pixels sharp
    card.paste(BOARD, [x, y, x + side, y + side])  # The square's ground, one step lighter than the sheet
    card.paste(colours, (x, y), colours)  # The change colours on top (their own transparency as the mask)
    draw.rectangle([x, y, x + side - 1, y + side - 1], outline=INK, width=2)  # The square's outline, like on the map
    if sum(change["stats_ha"][key] for key in CHANGE_COLOURS) < 1:  # Hardly any coloured change (the sentence says "little changed"):
        words = "No colored change"  # say so in the square, so it doesn't look empty by mistake
        draw_label(draw, (x + (side - label_width(words, 16)) / 2, y + side / 2 - 8), words, 16, MUTED)  # Centred
    tag(draw, (x, y - 34), "Analysis area · 2 × 2 km", 14)  # Its label above it
    card_frame(draw)  # The colour bar and the address
    return to_jpeg(card)  # Done


@functools.lru_cache(maxsize=64)  # The last 64 cards are kept in memory
def long_view_card(lat, lon, name):
    """The card for a long view: the earliest and the newest saved photo side by side. Falls back to the place's card
    while the photos aren't saved yet (they're made the first time someone opens the long view there)."""
    frames, points = long_view_material(lat, lon, square=True, saved_only=True)  # Only saved photos (never wait)
    if len(frames) < 2:  # Not enough to compare:
        return place_card(lat, lon, name)  # the place's card instead
    first, last = min(frames), max(frames)  # The earliest and the newest saved slot
    card = Image.new("RGB", (CARD_W, CARD_H), SHEET)  # The dark sheet
    draw = ImageDraw.Draw(card)  # A pen
    draw_label(draw, (60, 40), "Landturned · Long view · photos only", 16, MUTED)  # The kicker
    draw.text((60, 66), f"{short_name(name) or 'This place'} from {first} to {last}", font=font("sans", 44, "Medium"), fill=INK)  # The heading
    side, top, gap = 410, 132, 50  # Each photo's size, where they start, and the space between them (leaving the bottom strip clear)
    for i, slot in enumerate((first, last)):  # The two photos
        record, jpeg = frames[slot]  # The photo
        card.paste(frame_picture(record, jpeg, points, side), (60 + i * (side + gap), top))  # Side by side
    draw.text((60 + side + 9, top + side / 2 - 24), "→", font=font("sans", 36), fill=MUTED)  # An arrow between them
    card_frame(draw)  # The colour bar and the address
    return to_jpeg(card)  # Done


def card_for(params):
    """The right card for a shared address's settings (lat, lon, name, view), or the site's card when there's no place."""
    place = place_from(params)  # The place, if the settings hold a real one
    if place is None:  # None:
        return default_card()  # the site's card
    lat, lon, name = place  # Its parts
    if params.get("view") == "long":  # A long-view link:
        return long_view_card(lat, lon, name)  # the photos card
    return place_card(lat, lon, name)  # A result link: the result card

# ---------- The page's preview tags ----------


def place_from(params):
    """A place from a shared address's settings, as (lat, lon, name), or None when they don't hold a real place."""
    try:  # The numbers might be missing or nonsense:
        lat, lon = float(params.get("lat", "")), float(params.get("lon", ""))  # Read them
    except ValueError:  # Not numbers:
        return None  # no place
    if not (math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180):  # Not real coordinates:
        return None  # no place
    name = (params.get("name") or "").strip()[:80] or None  # The name, cut to 80 letters (it's typed by people), or None
    return round(lat, 5), round(lon, 5), name  # Rounded like the site rounds places (about 1 m)


def set_meta(page, key, value):
    """Set one preview tag's content in the page (adding the tag if it isn't there). "key" is e.g. "og:image"."""
    attribute = "name" if key.startswith("twitter:") else "property"  # X/Twitter's tags use name=, Open Graph's use property=
    tag_html = f'<meta {attribute}="{key}" content="{html.escape(value, quote=True)}" />'  # The new tag (the value made safe for HTML)
    pattern = re.compile(rf'<meta {attribute}="{re.escape(key)}" content="[^"]*" />')  # The old tag
    if pattern.search(page):  # It's there:
        return pattern.sub(lambda _: tag_html, page, count=1)  # replace it ("lambda" so nothing in the value is read as a pattern)
    return page.replace("</head>", f"{tag_html}\n</head>", 1)  # Otherwise add it at the end of the head


def page_for(page, params, base_url):
    """The site's page with link-preview tags for a shared place: its title, its sentence and its card's address.
    "page" is index.html's text, "params" the address's settings, "base_url" e.g. "https://landturned.com/"."""
    query = urlencode({key: params[key] for key in ("lat", "lon", "name", "view") if key in params})  # Only the settings the card uses, safely encoded
    image = f"{base_url}api/preview.jpg" + (f"?{query}" if query else "")  # The card's address
    page = set_meta(page, "og:image", image)  # The card
    page = set_meta(page, "og:image:width", str(CARD_W))  # Its size, so apps can lay it out before loading it
    page = set_meta(page, "og:image:height", str(CARD_H))  # ...
    page = set_meta(page, "twitter:card", "summary_large_image")  # X/Twitter: show the big picture
    page = set_meta(page, "twitter:image", image)  # ...this one
    place = place_from(params)  # The shared place, if any
    if place is None:  # The site itself: keep its own title and description
        return page  # Done
    lat, lon, name = place  # Its parts
    label = short_name(name) or f"{lat:.4f}, {lon:.4f}"  # What to call it
    long = params.get("view") == "long"  # A long-view link?
    title = f"{label} from {longview.SLOTS[0]} to {longview.SLOTS[-1]} · Landturned" if long else f"{label} · Landturned"  # The preview's title, naming the real years
    change = main_result(lat, lon)  # The result (for the description)
    description = "Satellite photos every 5 years since 1985. Photos only, not measured." if long else (plain_sentence(name, change) if change else "See how the land here has changed.")  # The line under the title
    for key in ("og:title", "twitter:title"):  # Both title tags
        page = set_meta(page, key, title)  # Set it
    for key in ("og:description", "twitter:description"):  # Both description tags
        page = set_meta(page, key, description)  # Set it
    return set_meta(page, "og:url", f"{base_url}?{query}")  # The shared address itself
