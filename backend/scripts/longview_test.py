# Long view test script (not part of the app): makes the long view's nine frames for a place with the app's own code
# (backend/app/longview.py) and saves them side by side as one "contact sheet" picture, labelled with year, date and
# satellite, so we can check the frames by eye and time how long they take (first time vs. from the cache).
#
# Run it from the backend folder with:   uv run python -m scripts.longview_test fontana
#                                        uv run python -m scripts.longview_test stavanger
# Or for any place (latitude, longitude, name):   uv run python -m scripts.longview_test 34.09 -117.43 "My place"
# The contact sheet and a small report are saved in backend/cache/longview_test/ (ignored by git).

import io  # Built into Python; lets us open JPEG bytes as if they were a file
import json  # Built into Python; saves the report as JSON text
import sys  # Built into Python; sys.argv is the list of words typed on the command line
import time  # Built into Python; time.perf_counter measures how long things take
from datetime import date  # Built into Python; dates written nicely

from PIL import Image, ImageDraw, ImageFont  # Pillow: opens pictures, draws text on them, and loads a font

from app import longview, settings  # Our own code: the long view (app/longview.py) and the cache folder (settings)

OUT_DIR = settings.CACHE_ROOT / "longview_test"  # backend/cache/longview_test (ignored by git)
SIZE_PX = longview.SIZE_PX  # Each frame is 500 x 500 pixels

# Test places: (name, latitude, longitude)
PLACES = {
    "fontana": ("Fontana, California", 34.0922, -117.4350),  # The main test: farmland that became warehouses
    "stavanger": ("Stavanger, Norway", 58.9700, 5.7331),  # The cloudy test
}

# Contact sheet look (dark like the app)
GAP = 12  # Space between frames, in pixels
LABEL_H = 92  # Height of the label strip under each frame
TITLE_H = 64  # Height of the title strip at the top
BACKGROUND = (11, 14, 18)  # Near black
INK = (230, 233, 237)  # Near white text
MUTED = (140, 150, 163)  # Grey text
SUBSTITUTE = (240, 150, 60)  # Orange text for a substituted year


def font(size):
    """Pillow's built-in font at a size in pixels."""
    return ImageFont.load_default(size=size)  # Comes with Pillow, so it works on every computer


def contact_sheet(name, centre, frames):
    """All frames side by side, each labelled with its year, date and satellite, under a title."""
    width = GAP + len(frames) * (SIZE_PX + GAP)  # Frames plus the gaps around them
    height = TITLE_H + SIZE_PX + LABEL_H  # Title, frames, labels
    sheet = Image.new("RGB", (width, height), BACKGROUND)  # A blank dark sheet
    draw = ImageDraw.Draw(sheet)  # A pen for that sheet
    lon, lat = centre  # The square's (rounded) centre
    title = f"{name}  ·  {lat:.2f}, {lon:.2f}  ·  15 x 15 km  ·  Landsat Collection 2 Level-2, true color, 30 m  ·  photos only, not measured"  # The title text
    draw.text((GAP, 20), title, fill=INK, font=font(24))  # Write it at the top
    for index, (record, jpeg) in enumerate(frames):  # Each frame, left to right
        x = GAP + index * (SIZE_PX + GAP)  # Its left edge on the sheet
        y = TITLE_H  # Its top edge
        if jpeg is None:  # No scene at all:
            draw.rectangle([x, y, x + SIZE_PX - 1, y + SIZE_PX - 1], outline=MUTED)  # an empty outlined box
            draw.text((x + 20, y + SIZE_PX // 2), "no clear scene", fill=MUTED, font=font(24))  # saying so
            draw.text((x, y + SIZE_PX + 8), str(record["slot"]), fill=INK, font=font(30))  # and the slot year below
            continue  # next frame
        sheet.paste(Image.open(io.BytesIO(jpeg)), (x, y))  # Open the JPEG bytes and put the photo on the sheet
        year_text = str(record["slot"]) if not record["substituted"] else f'{record["slot"]}: used {record["year"]}'  # "1985", or "1985: used 1986" when another year stood in (the built-in font has no arrow)
        draw.text((x, y + SIZE_PX + 8), year_text, fill=SUBSTITUTE if record["substituted"] else INK, font=font(30))  # The year, orange when substituted
        day = date.fromisoformat(record["date"])  # The date as a date object
        taken = f"{day:%b} {day.day}, {day.year}"  # Written the American way, e.g. "Sep 30, 1985"
        draw.text((x, y + SIZE_PX + 44), f'{taken}  ·  {record["satellite"]}', fill=INK, font=font(20))  # Date and satellite
        draw.text((x, y + SIZE_PX + 68), f'path/row {record["path_row"]}  ·  {record["hidden"] * 100:.1f}% hidden here  ·  scene {record["scene_cloud"]:.0f}% cloud', fill=MUTED, font=font(16))  # The small print
    return sheet  # The finished picture


def run(name, lat, lon):
    """Make (or load) the frames for one place, save the contact sheet and report, and print a summary."""
    started = time.perf_counter()  # Start the stopwatch
    answer = longview.long_view(lat, lon)  # The nine frames, from the cache where possible
    seconds = time.perf_counter() - started  # How long that took
    print(f"\n{name} (centre {answer['centre'][1]}, {answer['centre'][0]}): {seconds:.1f} s")  # The place and the time
    for record, jpeg in answer["frames"]:  # Each slot's result
        source = "cache" if record["cached"] else "made "  # Where it came from
        if jpeg is None:  # Nothing found:
            print(f'  {record["slot"]}: {source} MISSING (checked {record["checked"]} scenes)')  # say so
        else:  # Found:
            note = f' (substitute: {record["year"]})' if record["substituted"] else ""  # mention a substitute year
            print(f'  {record["slot"]}: {source} {record["date"]} {record["satellite"]} {record["path_row"]} '  # its details...
                  f'hidden {record["hidden"] * 100:.1f}% (scene {record["scene_cloud"]:.0f}%), {len(jpeg) // 1000} KB{note}')  # ...and its size
    OUT_DIR.mkdir(parents=True, exist_ok=True)  # Create the output folder the first time
    slug = name.split(",")[0].lower().replace(" ", "_")  # A file-name version of the name, e.g. "fontana"
    contact_sheet(name, answer["centre"], answer["frames"]).save(OUT_DIR / f"{slug}_sheet.jpg", quality=92, subsampling=0)  # Save the contact sheet (subsampling=0: full-sharpness color)
    report = {"name": name, "lat": lat, "lon": lon, "centre": answer["centre"], "corners": answer["corners"],  # The report: the place and its square...
              "seconds": round(seconds, 1), "frames": [record for record, _ in answer["frames"]]}  # ...the time, and every frame's record
    (OUT_DIR / f"{slug}_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")  # Save the report
    print(f"  saved {OUT_DIR / (slug + '_sheet.jpg')}")  # Say where


if __name__ == "__main__":  # Only when run as a script (not when imported)
    words = sys.argv[1:]  # What was typed after the script's name
    if len(words) >= 2:  # A latitude and longitude (and maybe a name):
        run(words[2] if len(words) > 2 else "Test place", float(words[0]), float(words[1]))  # run for that point
    else:  # Otherwise, test place names (default: both):
        for key in words or list(PLACES):  # Each requested place
            run(*PLACES[key])  # Run for it
