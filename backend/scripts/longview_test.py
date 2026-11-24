# Long view, phase 1: a test script (not part of the app).
# It makes one Landsat photo of a 15 x 15 km square for each 5-year slot from 1985 to 2025 and saves them side by side
# as one "contact sheet" picture, so we can judge whether the long view is possible: are the years there, are they
# clear, how long does it take, and do the old (Landsat 5) and new (Landsat 8/9) photos look alike?
#
# Run it from the backend folder with:   uv run python -m scripts.longview_test fontana
#                                        uv run python -m scripts.longview_test stavanger
# Or for any place (latitude, longitude, name):   uv run python -m scripts.longview_test 34.09 -117.43 "My place"
# The contact sheet and a small report are saved in backend/cache/longview_test/ (ignored by git).

import functools  # Built into Python; lru_cache remembers answers so the same search isn't made twice
import json  # Built into Python; saves the report as JSON text
import math  # Built into Python; math.floor to find the UTM zone number
import os  # Built into Python; os.environ sets options for GDAL, the library rasterio uses to read files
import sys  # Built into Python; sys.argv is the list of words typed on the command line
import time  # Built into Python; time.perf_counter measures how long things take
from collections import Counter  # Built into Python; counts how often each thing appears
from concurrent.futures import ThreadPoolExecutor  # Built into Python; runs several downloads at the same time
from datetime import date  # Built into Python; today's year, and dates written nicely

# Don't let GDAL list the folder around each file before opening it: online that's a slow, useless extra request
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")  # Set before any file is opened

import numpy as np  # numpy: fast math on big grids of numbers
import rasterio  # Reads raster files, including just a small window of a big file
from affine import Affine  # A "transform": the rule that turns a pixel's column/row into meters on the ground
from PIL import Image, ImageDraw, ImageFont  # Pillow: makes pictures, draws text on them, and loads a font
from rasterio.enums import Resampling  # The ways of filling pixels when a raster is moved onto another grid
from rasterio.vrt import WarpedVRT  # A "virtual" raster: another raster seen through our grid, without saving a copy
from rasterio.warp import transform  # Converts coordinates from one projection to another

from app import imagery, landcover, settings  # Our own code: summer months and colour stretch (imagery), the catalog (landcover), the cache folder (settings)

# ---------- Settings ----------

COLLECTION = "landsat-c2-l2"  # Landsat Collection 2 Level-2 (surface reflectance) on Planetary Computer
SLOTS = [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]  # One frame every 5 years
NEAREST = [0, 1, -1, 2, -2]  # Years to try for each slot, in order: the slot year, then one after, one before, two after, two before
PIXEL_M = 30  # Landsat's pixel size: 30 meters
SIZE_PX = 500  # The frame is 500 x 500 pixels...
SIZE_M = SIZE_PX * PIXEL_M  # ...so it covers 500 x 30 m = 15,000 m = 15 km on each side
# Landsat's own pixel edges sit at 15 m past a multiple of 30 m (e.g. 399,885 m). Putting ours on the same lines means
# no pixel has to be split between two of theirs, so the photo stays as sharp as it can be (when the zones match).
GRID_OFFSET_M = 15  # Where Landsat's pixel edges sit within each 30 m step
SATELLITES = {"landsat-5": "Landsat 5", "landsat-7": "Landsat 7", "landsat-8": "Landsat 8", "landsat-9": "Landsat 9"}  # Allowed satellites and their names on the sheet
L7_BROKEN = "2003-05-31"  # The day Landsat 7's scan line corrector broke: after it, its images have striped gaps
MAX_SCENE_CLOUD = 80  # Skip scenes over 80% cloudy overall: our square is unlikely to be clear in those
# The catalog checks these itself, so scenes we'd throw away are never sent to us (written in "CQL2", the catalog's filter language):
SERVER_FILTER = {"op": "and", "args": [  # All of these must be true:
    {"op": "=", "args": [{"property": "landsat:collection_category"}, "T1"]},  # Tier 1 (see allowed)
    {"op": "in", "args": [{"property": "platform"}, ["landsat-5", "landsat-7", "landsat-8", "landsat-9"]]},  # one of our satellites
    {"op": "<", "args": [{"property": "eo:cloud_cover"}, MAX_SCENE_CLOUD]},  # not mostly cloud
]}  # End of the filter
# Each scene's description normally lists about 25 files and many details (about 30 KB); we only need these (about 5 KB).
# Asking for fewer made the searches about 3 times faster. The first five are the basics every scene description needs.
FIELDS = {"include": [  # Only send these parts:
    "type", "stac_version", "stac_extensions", "geometry", "bbox", "id", "collection",  # the basics
    "properties.datetime", "properties.platform", "properties.eo:cloud_cover",  # when, which satellite, how cloudy overall
    "properties.landsat:wrs_path", "properties.landsat:wrs_row", "properties.landsat:collection_category",  # path, row, tier
    "properties.proj:code", "properties.proj:epsg",  # the projection its files are stored in
    "assets.qa_pixel.href", "assets.red.href", "assets.green.href", "assets.blue.href",  # links to the four files we read
], "exclude": []}  # Leave nothing else out
CHECK = 8  # How many scenes per year to check at the place itself (main path/row and least cloudy first)
CLEAR_ENOUGH = 0.02  # A scene is "clear" when clouds, shadows or missing data hide at most 2% of our square
WORKERS = 16  # How many files to read at the same time (shared by all nine slots, which run at the same time)
# The QA_PIXEL band's flags (bits) that mean "we can't see the ground here":
# bit 0 no data, bit 1 near a cloud, bit 2 thin cirrus (Landsat 8/9 only), bit 3 cloud, bit 4 cloud shadow.
HIDDEN_BITS = 0b11111  # Bits 0 to 4 all set: 1 + 2 + 4 + 8 + 16 = 31
QA_FILL = 1  # The QA value of "no data" (only bit 0 set): what we see outside the scene's edges
SCALE, OFFSET = 0.0000275, -0.2  # Landsat Collection 2: reflectance = stored number x 0.0000275 - 0.2
OUT_DIR = settings.CACHE_ROOT / "longview_test"  # backend/cache/longview_test (ignored by git)

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

# ---------- The grid ----------


def utm_crs(lat, lon):
    """The UTM projection of the zone the place is in, e.g. "EPSG:32611" (Fontana). UTM measures in meters."""
    zone = math.floor((lon + 180) / 6) + 1  # UTM zones are 6 degrees of longitude wide, numbered from 1 at 180°W
    return f"EPSG:{32600 + zone}" if lat >= 0 else f"EPSG:{32700 + zone}"  # 326xx is the northern half, 327xx the southern


def square_grid(lat, lon):
    """Our 15 x 15 km square as (projection, transform): the same 500 x 500 grid of 30 m pixels for every year."""
    crs = utm_crs(lat, lon)  # The place's UTM zone
    (x,), (y,) = transform("EPSG:4326", crs, [lon], [lat])  # The place in meters (easting x, northing y)
    left = round((x - SIZE_M / 2 - GRID_OFFSET_M) / PIXEL_M) * PIXEL_M + GRID_OFFSET_M  # Left edge: 7.5 km west, moved onto Landsat's pixel lines
    top = round((y + SIZE_M / 2 - GRID_OFFSET_M) / PIXEL_M) * PIXEL_M + GRID_OFFSET_M  # Top edge: 7.5 km north, on the same lines
    return crs, Affine(PIXEL_M, 0, left, 0, -PIXEL_M, top)  # Each column steps 30 m east, each row 30 m south, from the top-left corner


def read_on_grid(href, crs, grid, resampling, nodata):
    """Read one band of a scene, moved onto our square's grid. Outside the scene's edges we get `nodata`."""
    with rasterio.open(href) as src, WarpedVRT(  # Open the file and see it through our grid...
        src, crs=crs, transform=grid, width=SIZE_PX, height=SIZE_PX,  # ...our projection, position and size...
        resampling=resampling, src_nodata=nodata, nodata=nodata,  # ...the fill method, and what "no data" is (so the gap outside the scene is marked, not 0)
    ) as vrt:  # End of the opening
        return vrt.read(1)  # Read just our 500 x 500 pixels of its first (only) band

# ---------- Finding scenes ----------


def in_summer(item, lat):
    """True when the scene was taken in the place's summer (always True in the tropics)."""
    summer = imagery.summer_months(lat)  # May-Sep north, Nov-Mar south, None in the tropics (the app's own rule)
    month = int(item.properties["datetime"][5:7])  # The month (characters 6-7 of "1985-09-30T...")
    return summer is None or month in summer  # Any month in the tropics, otherwise summer only


def allowed(item):
    """True for Tier 1 scenes of Landsat 5, 8 and 9, and of Landsat 7 only before its fault in 2003."""
    platform = item.properties["platform"]  # e.g. "landsat-5"
    if platform not in SATELLITES:  # Landsat 4 and anything else:
        return False  # not used
    # USGS sorts scenes into Tier 1 (placed on the map accurately enough to line up year after year) and Tier 2 (not:
    # one Stavanger scene from Sep 2000 showed mountains 50 km away instead of the city). Only Tier 1 can be compared.
    if item.properties["landsat:collection_category"] != "T1":  # Tier 2 (or not yet sorted):
        return False  # not used
    return platform != "landsat-7" or item.properties["datetime"][:10] <= L7_BROKEN  # Landsat 7 only up to the fault


def path_row(item):
    """The scene's WRS-2 path and row, e.g. "040/036"."""
    return f'{item.properties["landsat:wrs_path"]}/{item.properties["landsat:wrs_row"]}'  # Path first, then row


def distance_from_centre(item, lat, lon):
    """How far the place is from the middle of the scene's outline, in degrees of latitude (roughly 111 km each).
    The scene with its middle closest to the place has our square well inside it, far from its edges."""
    west, south, east, north = item.bbox  # The scene's outline as a box: its western, southern, eastern and northern edges
    across = ((west + east) / 2 - lon) * math.cos(math.radians(lat))  # East-west gap; a degree of longitude shrinks towards the poles, so it's scaled down
    up = (south + north) / 2 - lat  # North-south gap
    return math.hypot(across, up)  # The straight-line distance (Pythagoras)


def season_dates(lat, year):
    """The dates to ask the catalog for, as "start/end": the northern summer, or the whole year elsewhere.
    The catalog takes one date range per search. The southern summer (Nov-Mar) crosses New Year and the tropics have no
    summer, so there we ask for the whole year and drop the other months afterwards (in_summer)."""
    if imagery.summer_months(lat) == imagery.NORTH_SUMMER:  # North of the tropics:
        return f"{year}-05-01/{year}-09-30"  # May 1 to Sep 30 (the app's northern summer)
    return f"{year}-01-01/{year}-12-31"  # Elsewhere: the whole year


@functools.lru_cache(maxsize=256)  # Remember answers, so a year asked for again (as a neighbour of a slot) isn't searched twice
def search_year(lat, lon, year):
    """Every usable summer scene covering the place in one year."""
    catalog = landcover.open_catalog()  # The Planetary Computer catalog (file links signed automatically)
    found = catalog.search(  # Ask the catalog:
        collections=[COLLECTION],  # Landsat Collection 2 Level-2,
        intersects={"type": "Point", "coordinates": [lon, lat]},  # covering our place,
        datetime=season_dates(lat, year),  # taken in that year's summer (or that year),
        filter=SERVER_FILTER, filter_lang="cql2-json",  # Tier 1, our satellites, not mostly cloud (checked by the catalog itself)
        fields=FIELDS,  # only the parts of each scene's description we use
        limit=1000,  # up to 1,000 scenes per page, so one page is almost always enough
    )  # End of the search
    return tuple(item for item in found.items() if allowed(item) and in_summer(item, lat))  # Double-check (and drop Landsat 7 after 2003, and winter in the south); a tuple can't be changed by accident once remembered

# ---------- Checking clouds at the place ----------


def hidden_share(item, crs, grid):
    """The share of our square (0 to 1) hidden by clouds, their shadows, or missing data, from the QA_PIXEL band."""
    qa = read_on_grid(item.assets["qa_pixel"].href, crs, grid, Resampling.nearest, QA_FILL)  # The flags (nearest: never blend two pixels' flags)
    return float(((qa & HIDDEN_BITS) != 0).mean())  # "&" keeps only bits 0-4; any of them set means hidden; the mean of True/False is the share


def pick(items, year, preferred, lat, crs, grid, pool):
    """Check one year's best few scenes at the place. Returns (clearest usable scene or None, every scene checked with its share)."""
    this_year = [item for item in items if int(item.properties["datetime"][:4]) == year]  # Scenes taken in that year
    this_year.sort(key=lambda item: (path_row(item) != preferred, item.properties["eo:cloud_cover"]))  # Main path/row first (False sorts first), then least cloudy overall
    this_year = this_year[:CHECK]  # Only the first few: checking costs a download each
    shares = list(pool.map(lambda item: hidden_share(item, crs, grid), this_year))  # Their hidden shares, read at the same time
    checked = list(zip(this_year, shares))  # Pair each scene with its share
    clear = [(item, share) for item, share in checked if share <= CLEAR_ENOUGH]  # The clear ones
    if not clear:  # None clear this year:
        return None, checked  # say so (the caller tries another year)
    clear.sort(key=lambda pair: (path_row(pair[0]) != preferred, pair[1]))  # Main path/row first, then the least hidden
    return clear[0][0], checked  # The winner, and everything we checked

# ---------- The photo ----------


def scene_crs(item):
    """The projection the scene's files are stored in, e.g. "EPSG:32611"."""
    code = item.properties.get("proj:code")  # Newer catalog entries write it as "EPSG:32611"...
    return code or f'EPSG:{item.properties["proj:epsg"]}'  # ...older ones as the number 32611


def true_colour(item, crs, grid, pool):
    """The scene's red, green and blue bands on our grid as a 500 x 500 x 3 picture, with the app's colour stretch.
    The pixel values are used as USGS delivers them: the only change is the display stretch, the same for every pixel and year."""
    # When the scene is stored in our UTM zone, our pixels sit exactly on Landsat's own pixels (see GRID_OFFSET_M),
    # so "nearest" just copies them, unchanged. A scene from another zone is turned slightly against our grid, so its
    # pixels must be blended into ours (bilinear).
    resampling = Resampling.nearest if scene_crs(item) == crs else Resampling.bilinear  # Copy when aligned, blend when not
    raws = list(pool.map(lambda band: read_on_grid(item.assets[band].href, crs, grid, resampling, 0), ["red", "green", "blue"]))  # The three bands, read at the same time (0 means no data)
    channels = []  # Red, green, blue after the stretch, filled in below
    for raw in raws:  # Each band in turn
        reflectance = np.clip(raw.astype(float) * SCALE + OFFSET, 0, None)  # Stored numbers to reflectance (0 to about 1); never below 0
        stretched = np.clip(reflectance / imagery.WHITE, 0, 1) ** imagery.GAMMA  # The app's stretch: 0 to 0.45 becomes 0 to 1, on a square-root curve
        channels.append(np.where(raw == 0, 0, stretched))  # Where there's no data, black
    return Image.fromarray((np.stack(channels, axis=-1) * 255).astype(np.uint8))  # Stack into rows x columns x 3, scale to 0-255, make a picture

# ---------- One frame per slot ----------


def make_frame(slot, preferred, lat, lon, crs, grid, pool):
    """Find and download the frame for one slot. Returns a dictionary describing it (with the picture under "image")."""
    started = time.perf_counter()  # Start this slot's stopwatch
    tried = []  # Every scene checked, for the report
    this_year = date.today().year  # No point looking past this year
    for step in NEAREST:  # The slot year first, then the nearest years
        year = slot + step  # The year to try
        if year > this_year:  # In the future:
            continue  # skip it
        items = search_year(lat, lon, year)  # That year's scenes (already remembered for the slot year; searched now for a neighbour)
        winner, checked = pick(items, year, preferred, lat, crs, grid, pool)  # The clearest scene that year, if any
        tried += checked  # Remember what was checked
        if winner is not None:  # Found a clear one:
            break  # stop looking
    if winner is None and tried:  # No clear scene in any of the five years, but there were scenes:
        winner = min(tried, key=lambda pair: pair[1])[0]  # use the least hidden one anyway, and the report says how hidden
    frame = {"slot": slot, "checked": len(tried)}  # What we know so far
    if winner is None:  # Nothing at all:
        frame.update(missing=True, seconds=round(time.perf_counter() - started, 1))  # mark the slot as missing
        return frame  # and stop here
    share = dict((id(item), s) for item, s in tried)[id(winner)]  # The winner's hidden share (found again by matching the scene)
    taken = winner.properties["datetime"][:10]  # e.g. "1985-09-30"
    frame.update(  # Record the winner:
        missing=False,  # we have a frame
        date=taken,  # the day it was taken
        year=int(taken[:4]),  # its year
        substituted=int(taken[:4]) != slot,  # True when it's from another year than the slot
        satellite=SATELLITES[winner.properties["platform"]],  # e.g. "Landsat 5"
        path_row=path_row(winner),  # e.g. "040/036"
        hidden=round(share, 3),  # the share of our square hidden by clouds or missing data
        scene_cloud=winner.properties["eo:cloud_cover"],  # the whole scene's cloud percentage, for comparison
        scene=winner.id,  # the scene's name in the catalog
        image=true_colour(winner, crs, grid, pool),  # the photo itself
    )  # End of the record
    frame["seconds"] = round(time.perf_counter() - started, 1)  # How long the slot took (checking plus downloading)
    return frame  # Hand it back

# ---------- The contact sheet ----------


def font(size):
    """Pillow's built-in font at a size in pixels."""
    return ImageFont.load_default(size=size)  # Comes with Pillow, so it works on every computer


def contact_sheet(name, lat, lon, frames):
    """All frames side by side, each labelled with its year, date and satellite, under a title."""
    width = GAP + len(frames) * (SIZE_PX + GAP)  # Frames plus the gaps around them
    height = TITLE_H + SIZE_PX + LABEL_H  # Title, frames, labels
    sheet = Image.new("RGB", (width, height), BACKGROUND)  # A blank dark sheet
    draw = ImageDraw.Draw(sheet)  # A pen for that sheet
    title = f"{name}  ·  {lat:.4f}, {lon:.4f}  ·  15 x 15 km  ·  Landsat Collection 2 Level-2, true color, 30 m  ·  photos only, not measured"  # The title text
    draw.text((GAP, 20), title, fill=INK, font=font(24))  # Write it at the top
    for index, frame in enumerate(frames):  # Each frame, left to right
        x = GAP + index * (SIZE_PX + GAP)  # Its left edge on the sheet
        y = TITLE_H  # Its top edge
        if frame["missing"]:  # No scene at all:
            draw.rectangle([x, y, x + SIZE_PX - 1, y + SIZE_PX - 1], outline=MUTED)  # an empty outlined box
            draw.text((x + 20, y + SIZE_PX // 2), "no clear scene", fill=MUTED, font=font(24))  # saying so
            draw.text((x, y + SIZE_PX + 8), str(frame["slot"]), fill=INK, font=font(30))  # and the slot year below
            continue  # next frame
        sheet.paste(frame["image"], (x, y))  # Put the photo on the sheet
        year_text = str(frame["slot"]) if not frame["substituted"] else f'{frame["slot"]}: used {frame["year"]}'  # "1985", or "1985: used 1986" when another year stood in (the built-in font has no arrow)
        draw.text((x, y + SIZE_PX + 8), year_text, fill=SUBSTITUTE if frame["substituted"] else INK, font=font(30))  # The year, orange when substituted
        day = date.fromisoformat(frame["date"])  # The date as a date object
        taken = f"{day:%b} {day.day}, {day.year}"  # Written the American way, e.g. "Sep 30, 1985"
        draw.text((x, y + SIZE_PX + 44), f'{taken}  ·  {frame["satellite"]}', fill=INK, font=font(20))  # Date and satellite
        draw.text((x, y + SIZE_PX + 68), f'path/row {frame["path_row"]}  ·  {frame["hidden"] * 100:.1f}% hidden here  ·  scene {frame["scene_cloud"]:.0f}% cloud', fill=MUTED, font=font(16))  # The small print
    return sheet  # The finished picture

# ---------- Main ----------


def run(name, lat, lon):
    """Make the contact sheet and report for one place, and print a summary."""
    started = time.perf_counter()  # Start the overall stopwatch
    crs, grid = square_grid(lat, lon)  # Our 15 x 15 km grid
    with ThreadPoolExecutor(max_workers=len(SLOTS)) as pool:  # One helper per slot, so the nine searches happen at the same time
        found = list(pool.map(lambda slot: search_year(lat, lon, slot), SLOTS))  # Each slot year's scenes (neighbouring years are searched later, only if needed)
    searched = time.perf_counter() - started  # How long the searching took
    counts = Counter(path_row(item) for items in found for item in items)  # How many scenes each path/row has in the slot years (for the printout)
    # The main path/row: the one whose scenes are centred closest to the place, so our square sits well inside every
    # one of its photos. (Counting scenes doesn't work: in Stavanger the most common path/row only just reaches the city.)
    every = [item for items in found for item in items]  # All the slot years' scenes in one list
    preferred = path_row(min(every, key=lambda item: distance_from_centre(item, lat, lon))) if every else None  # The path/row of the best-centred scene
    print(f"\n{name}: {sum(counts.values())} summer scenes found in {searched:.1f} s; path/rows {dict(counts)}; main {preferred}")  # What the searches found
    # All nine slots are worked on at the same time: each one mostly waits for the internet, so the waits overlap.
    # Two groups of helpers: one per slot (each finds its frame), and a shared group that reads the files. A slot
    # helper waits for file readers, never the other way round, so they can't get stuck waiting for each other.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool, ThreadPoolExecutor(max_workers=len(SLOTS)) as slot_pool:  # The file readers, and one helper per slot
        frames = list(slot_pool.map(lambda slot: make_frame(slot, preferred, lat, lon, crs, grid, pool), SLOTS))  # Every slot's frame, in slot order
    for slot, frame in zip(SLOTS, frames):  # Print each slot's result (its time overlaps the others', so they don't add up to the total)
        if frame["missing"]:  # Nothing found:
            print(f'  {slot}: MISSING (checked {frame["checked"]} scenes) {frame["seconds"]} s')  # say so
        else:  # Found:
            note = f' (substitute: {frame["year"]})' if frame["substituted"] else ""  # mention a substitute year
            print(f'  {slot}: {frame["date"]} {frame["satellite"]} {frame["path_row"]} hidden {frame["hidden"] * 100:.1f}% '  # its details...
                  f'(scene {frame["scene_cloud"]:.0f}%), checked {frame["checked"]}, {frame["seconds"]} s{note}')  # ...and how long it took
    total = time.perf_counter() - started  # The whole run
    print(f"  total {total:.1f} s")  # Print it
    OUT_DIR.mkdir(parents=True, exist_ok=True)  # Create the output folder the first time
    slug = name.split(",")[0].lower().replace(" ", "_")  # A file-name version of the name, e.g. "fontana"
    contact_sheet(name, lat, lon, frames).save(OUT_DIR / f"{slug}_sheet.jpg", quality=92, subsampling=0)  # Save the contact sheet; subsampling=0 keeps color at full sharpness (by default JPEG halves it, which smears color across roof edges)
    report = {"name": name, "lat": lat, "lon": lon, "main_path_row": preferred, "search_seconds": round(searched, 1),  # The report: place and searching...
              "total_seconds": round(total, 1), "frames": [{k: v for k, v in f.items() if k != "image"} for f in frames]}  # ...total time and every frame without its picture
    (OUT_DIR / f"{slug}_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")  # Save the report
    print(f"  saved {OUT_DIR / (slug + '_sheet.jpg')}")  # Say where


if __name__ == "__main__":  # Only when run as a script (not when imported)
    words = sys.argv[1:]  # What was typed after the script's name
    if len(words) >= 2:  # A latitude and longitude (and maybe a name):
        run(words[2] if len(words) > 2 else "Test place", float(words[0]), float(words[1]))  # run for that point
    else:  # Otherwise, test place names (default: both):
        for key in words or list(PLACES):  # Each requested place
            run(*PLACES[key])  # Run for it
