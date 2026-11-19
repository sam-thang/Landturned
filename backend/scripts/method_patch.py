# Patch script: pick the small real example for the "How this works" page, and save it as a data file.
# It is not part of the app. Run it from the backend folder with:
#   uv run python -m scripts.method_patch              -> finds candidate patches and saves pictures to look at
#   uv run python -m scripts.method_patch --save 2     -> saves candidate number 2 for the page
#   add --place stavanger to use Stavanger instead of Ontario Ranch
#   add --name edges to save to method-patch-edges.json instead of method-patch.json (for a second, smaller example)
#
# The page explains the method with real pixels: a 40 x 40 pixel patch (400 x 400 m) cut out of one hotspot's square,
# with its land-cover category in every year. A patch is a good example when it has plenty of real new building AND a
# little edge noise, so the page's "edge cleaning on/off" switch visibly does something.

import json  # Built into Python; writes the data file in JSON, a text format JavaScript reads directly
import sys  # Built into Python; sys.argv is the list of words typed on the command line
import tempfile  # Built into Python; tells us where the computer's temporary-files folder is
from pathlib import Path  # Built into Python; a handy way to build file paths

import numpy as np  # numpy: fast math on big grids of numbers
from PIL import Image  # Pillow's Image: makes and saves pictures

from app import change_image, landcover  # Our own code: the change colours and the land-cover analysis

# ---------- Settings ----------
PLACES = {  # The places a patch may come from; pick one with --place (default: ontario)
    "ontario": ("Ontario Ranch, California", 33.9785, -117.5962),  # Farmland -> suburbs, our main test area (same center as in frontend/src/places.js)
    "stavanger": ("Stavanger, Norway", 58.9700, 5.7318),  # Harbour city: shorelines give real edge noise for the cleaning switch
}  # End of the places
PLACE_KEY = sys.argv[sys.argv.index("--place") + 1] if "--place" in sys.argv else "ontario"  # The word typed after --place, or "ontario"
PLACE, LAT, LON = PLACES[PLACE_KEY]  # Its name, latitude and longitude
PATCH = 40  # The patch is 40 x 40 pixels: 400 x 400 m
STEP = 20  # Candidate patches start every 20 pixels (200 m), so neighbours overlap by half
SHOW = 4  # How many of the best candidates to show
SCALE = 6  # Each pixel becomes a 6 x 6 block in the pictures, so it's big enough to see
NAME = sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else ""  # Optional extra word for the file name (e.g. "edges"), so a second patch doesn't overwrite the main one
OUT_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / f"method-patch{'-' + NAME if NAME else ''}.json"  # Where --save writes the data file (inside the frontend, so the page can load it)

# Colours for the land categories in the pictures. Only for choosing a patch: the page draws categories in its own style.
CATEGORY_RGB = {  # Category number -> (red, green, blue)
    landcover.NO_DATA: (40, 40, 40),  # Dark grey
    landcover.TREES: (47, 93, 58),  # Dark green
    landcover.GRASS: (155, 191, 107),  # Light green
    landcover.BUILT: (201, 201, 201),  # Light grey
    landcover.WATER: (59, 111, 181),  # Blue
    landcover.BARE: (200, 169, 126),  # Sand
}  # End of the category colours
BACKGROUND = (26, 29, 34)  # Dark backdrop for "no change" pixels in the change pictures


def read_all_years():
    """Read the place's 2 x 2 km square for every available year. Returns (list of years, {year: category grid}, corners)."""
    items_by_year = landcover.find_items_by_year(LON, LAT)  # All yearly maps covering the point
    grids = {}  # year -> 200 x 200 grid of our categories
    corners = None  # The square's corners (the same for every year)
    for year, item in items_by_year.items():  # Each year in turn
        print(f"  reading {year}...")  # Show progress (each read takes a few seconds)
        data, corners = landcover.read_square(item, LON, LAT)  # The square's dataset classes, and its corners
        grids[year] = landcover.to_categories(data)  # Translate into our six categories
    return list(grids), grids, corners  # Hand back the years, the grids, and the corners


def score(stack):
    """How good a teaching example a patch is. "stack" holds the patch's category grid for every year, oldest first.
    A good example is a mix (about half new building, half unchanged), was built in stages over several years (so the
    page's year slider tells a story), shows some edge noise (so the cleaning switch does something), and has no gaps.
    Returns (score, built pixels after cleaning, pixels the cleaning removes, years in which building happened, no-data pixels)."""
    first, last = stack[0], stack[-1]  # The oldest and the latest year
    raw = landcover.compare(first, last, clean=False)  # The change without cleaning
    cleaned = landcover.compare(first, last)  # The change with cleaning (what the app shows)
    colored = [landcover.CLEARED, landcover.GAINED, landcover.NEW_BUILT, landcover.NEW_WATER]  # The four coloured codes
    built = int((cleaned == landcover.NEW_BUILT).sum())  # Real new building that survives the cleaning
    removed = int(np.isin(raw, colored).sum() - np.isin(cleaned, colored).sum())  # Coloured pixels the cleaning takes away
    no_data = int((raw == landcover.UNKNOWN).sum())  # Pixels with no data in either year
    became_built = [int(((stack[i - 1] != landcover.BUILT) & (stack[i] == landcover.BUILT)).sum()) for i in range(1, len(stack))]  # Pixels that turned built in each year-to-year step
    stages = sum(1 for n in became_built if n >= 40)  # In how many steps a real chunk (40+ pixels, 0.4 ha) was built
    share = built / (PATCH * PATCH)  # The share of the patch that is new building (0 to 1)
    value = 100 * (1 - abs(share - 0.5) * 2) + 15 * stages + min(removed, 80) - 5 * no_data  # Best near half, more stages, visible cleaning, no gaps
    return value, built, removed, stages, no_data  # Hand back the score and its parts


def to_rgb(grid, palette, default):
    """Turn a grid of codes into a picture array, using a {code: (r, g, b)} palette; codes not in it get "default"."""
    rgb = np.empty(grid.shape + (3,), dtype=np.uint8)  # An empty picture: rows x columns x 3 colour values
    rgb[:] = default  # Fill everything with the default colour first
    for code, colour in palette.items():  # Then each code in the palette...
        rgb[grid == code] = colour  # ...paints its pixels
    return rgb  # Hand back the picture array


def candidate_picture(first, last, path):
    """Save a strip of four pictures: first year, last year, change without cleaning, change with cleaning."""
    change_rgb = {code: tuple(int(v) for v in change_image.COLORS[code][:3]) for code in [landcover.CLEARED, landcover.GAINED, landcover.NEW_BUILT, landcover.NEW_WATER]}  # The app's four change colours, without their transparency
    panels = [  # The four panels, left to right
        to_rgb(first, CATEGORY_RGB, BACKGROUND),  # First year's categories
        to_rgb(last, CATEGORY_RGB, BACKGROUND),  # Last year's categories
        to_rgb(landcover.compare(first, last, clean=False), change_rgb, BACKGROUND),  # Change, raw
        to_rgb(landcover.compare(first, last), change_rgb, BACKGROUND),  # Change, cleaned
    ]  # End of the panels
    gap = np.full((PATCH, 2, 3), 255, dtype=np.uint8)  # A thin white divider, 2 pixels wide
    strip = np.hstack([part for panel in panels for part in (panel, gap)][:-1])  # Panels side by side with dividers between them (the last divider dropped)
    Image.fromarray(strip).resize((strip.shape[1] * SCALE, strip.shape[0] * SCALE), Image.NEAREST).save(path)  # Enlarge with sharp edges (NEAREST = no blurring) and save


def find_candidates(grids, years):
    """Score every patch position and return the best non-overlapping ones as [(row, col, score parts), ...]."""
    size = grids[years[0]].shape[0]  # 200 pixels across
    scored = []  # Every candidate with its score
    for row in range(0, size - PATCH + 1, STEP):  # Every starting row: 0, 20, ..., 160
        for col in range(0, size - PATCH + 1, STEP):  # Every starting column, the same
            window = (slice(row, row + PATCH), slice(col, col + PATCH))  # The patch's rows and columns
            scored.append((score([grids[y][window] for y in years]), row, col))  # Score it (all years, oldest first) and remember where it is
    scored.sort(key=lambda s: -s[0][0])  # Best score first
    chosen = []  # The winners
    for parts, row, col in scored:  # Walk down the ranking
        if all(abs(row - r) >= PATCH or abs(col - c) >= PATCH for r, c, _ in chosen):  # Keep it only if it doesn't overlap a winner
            chosen.append((row, col, parts))  # It's a winner
        if len(chosen) == SHOW:  # Enough winners:
            break  # stop looking
    return chosen  # Hand back the winners


def patch_center(corners, row, col):
    """The patch's center as (lat, lon), worked out from the square's four corners (close enough over 2 km)."""
    (tl_lon, tl_lat), (tr_lon, _), _, (_, bl_lat) = corners  # Top-left, top-right, bottom-right, bottom-left corners
    fx = (col + PATCH / 2) / 200  # How far across the square the patch center is (0 = left edge, 1 = right edge)
    fy = (row + PATCH / 2) / 200  # How far down (0 = top, 1 = bottom)
    return round(tl_lat + (bl_lat - tl_lat) * fy, 5), round(tl_lon + (tr_lon - tl_lon) * fx, 5)  # Step that far between the edges


def main():
    """Show candidates, or save the one picked with --save N."""
    print(f"Reading every year for {PLACE}...")  # Say what's happening
    years, grids, corners = read_all_years()  # Read the square once per year
    candidates = find_candidates(grids, years)  # Find the best patches
    out_dir = Path(tempfile.gettempdir()) / "landturn-method"  # A folder for the pictures
    out_dir.mkdir(exist_ok=True)  # Create it (no error if it already exists)

    if "--save" in sys.argv:  # Saving a chosen candidate:
        number = int(sys.argv[sys.argv.index("--save") + 1])  # The number typed after --save (1 to SHOW)
        row, col, _ = candidates[number - 1]  # Its position in the square
        window = (slice(row, row + PATCH), slice(col, col + PATCH))  # Its rows and columns
        lat, lon = patch_center(corners, row, col)  # Its center
        data = {  # What the page needs:
            "place": PLACE,  # Where it is
            "center": {"lat": lat, "lon": lon},  # The patch's center
            "size": PATCH,  # Pixels across (and down)
            "pixel_m": 10,  # Each pixel is 10 m wide
            "years": years,  # Every year included
            "categories": {str(y): "".join(str(int(v)) for v in grids[y][window].ravel()) for y in years},  # Each year as one string of 1,600 digits (0-5), row by row
            "category_names": {str(k): v for k, v in landcover.CATEGORY_NAMES.items()},  # What each digit means
            "source": "Impact Observatory annual land cover, 10 m (Microsoft Planetary Computer)",  # Credit
        }  # End of the data
        OUT_FILE.parent.mkdir(parents=True, exist_ok=True)  # Make the data folder if it doesn't exist yet
        OUT_FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")  # Write the file
        print(f"Saved candidate {number} (rows {row}-{row + PATCH}, columns {col}-{col + PATCH}) to {OUT_FILE}")  # Report it
        return  # Done

    print(f"\nYears: {years[0]}-{years[-1]}. Best {SHOW} patches of {PATCH} x {PATCH} pixels:")  # Heading
    for number, (row, col, (value, built, removed, stages, no_data)) in enumerate(candidates, start=1):  # Each winner, numbered from 1
        path = out_dir / f"{PLACE.split(',')[0].replace(' ', '-').lower()}-candidate-{number}.png"  # Its picture's file, named after the place
        window = (slice(row, row + PATCH), slice(col, col + PATCH))  # Its rows and columns
        candidate_picture(grids[years[0]][window], grids[years[-1]][window], path)  # Save the picture
        print(f"  {number}: rows {row}-{row + PATCH}, cols {col}-{col + PATCH}: built {built / 100:.2f} ha ({built / 16:.0f}% of the patch), built in {stages} stages, cleaning removes {removed} px, no data {no_data} px -> {path}")  # Its numbers


if __name__ == "__main__":  # Only run main() when this file is run directly
    main()  # Start
