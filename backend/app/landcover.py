# Land-cover data: find the yearly maps for a place, read our 2 x 2 km square, and translate the
# dataset's classes into Landturn's own six categories.
# The maps are Impact Observatory's 10 m annual land cover, read from its public AWS Open Data bucket (CC BY 4.0):
# one file per UTM grid zone per year, so the file for a place can be worked out from its coordinates (no catalog search).

import json  # Built into Python; reads and writes the saved grid-zone facts (zones.json)
import os  # Built into Python; os.environ holds settings that GDAL reads
import threading  # Built into Python; a "lock" so two requests never write zones.json at the same moment

# Settings for GDAL, the library rasterio uses to read files over the internet. They must be set before any file is opened.
# Without them, every file opening first lists the whole online folder and makes many small requests: about 2 seconds
# each time. With them, an opening takes about 0.4 seconds (measured 2026-11-19).
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")  # Don't list the online folder before opening a file in it
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")  # Combine neighbouring small reads into one request
os.environ.setdefault("GDAL_HTTP_MULTIPLEX", "YES")  # Send several requests over one connection at the same time
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")  # Only treat .tif links as files (no guessing about other kinds)

import urllib.error  # Built into Python; the error raised when a web address answers "not found"
import urllib.request  # Built into Python; asks a web server whether a file exists (a HEAD request)

import numpy as np  # numpy: fast math on big grids of numbers
import planetary_computer  # Signs Planetary Computer file links so we're allowed to download them
import pystac_client  # Searches the STAC catalog (only for the Sentinel-2 photo in imagery.py now)
import rasterio  # Reads raster files, including just a small window of a big file
from rasterio.warp import transform  # Converts coordinates from one projection to another
from rasterio.windows import Window, from_bounds  # Window: a block of rows and columns; from_bounds: turns a box in meters into a window

from app import settings  # Our own code: where saved answers live

# ---------- Settings ----------

HALF_SIZE_M = 1000  # Half the square's width in meters: 1 km in each direction gives the 2 x 2 km square the map shows
PIXEL_AREA_M2 = 10 * 10  # Each pixel is 10 m x 10 m = 100 square meters
CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"  # The address of Planetary Computer's catalog (only imagery.py uses it now)
# Where the land-cover files are: Impact Observatory's public bucket on AWS (region us-west-2), named "{zone}_{year}.tif",
# e.g. "11S_2024.tif" for Fontana. The same files as Planetary Computer's "io-lulc-annual-v02" (checked: identical
# for 2023), plus newer years (2024 was added in June 2025; Planetary Computer stops at 2023).
LULC_URL = "https://io-10m-annual-lulc.s3.amazonaws.com/{zone}_{year}.tif"
FIRST_YEAR = 2017  # The first year of the dataset
NEWEST_KNOWN_YEAR = 2024  # The newest year known to exist (2026-11-21); newer years are found automatically (see years_in_zone)

# ---------- Our six categories ----------

# Each category gets a small number, because a raster can only store numbers, not words
NO_DATA = 0  # Clouds or nothing measured: we can't say what the land was
TREES = 1  # Forest and other dense, tall vegetation
GRASS = 2  # Grass/farmland: crops, rangeland, wetlands (green, but not trees)
BUILT = 3  # Buildings, roads, parking lots
WATER = 4  # Rivers, lakes, sea, ponds
BARE = 5  # Sand, rock, cleared soil, snow and ice

# The readable name of each category, for printouts and (later) the app
CATEGORY_NAMES = {
    NO_DATA: "No data",  # 0
    TREES: "Trees",  # 1
    GRASS: "Grass/farmland",  # 2
    BUILT: "Built",  # 3
    WATER: "Water",  # 4
    BARE: "Bare",  # 5
}  # End of the category names

# ---------- Translating the dataset's classes into our categories ----------

# A "lookup table": a list of 256 slots, one for every number a pixel can hold (0 to 255).
# Slot N holds our category for dataset class N. Every slot starts as NO_DATA, so unknown numbers count as "no data".
IO_LOOKUP = np.full(256, NO_DATA, dtype=np.uint8)  # 256 slots, all filled with NO_DATA; uint8 = whole numbers from 0 to 255
IO_LOOKUP[1] = WATER  # Dataset class 1 (Water) -> water
IO_LOOKUP[2] = TREES  # Dataset class 2 (Trees) -> trees
IO_LOOKUP[4] = GRASS  # Dataset class 4 (Flooded vegetation: wetlands, rice) -> grass/farmland
IO_LOOKUP[5] = GRASS  # Dataset class 5 (Crops) -> grass/farmland
IO_LOOKUP[7] = BUILT  # Dataset class 7 (Built area) -> built
IO_LOOKUP[8] = BARE  # Dataset class 8 (Bare ground) -> bare
IO_LOOKUP[9] = BARE  # Dataset class 9 (Snow/ice) -> bare (open land without vegetation)
IO_LOOKUP[11] = GRASS  # Dataset class 11 (Rangeland: grass and shrubs) -> grass/farmland
# Classes 0 (No data) and 10 (Clouds) stay NO_DATA, as filled in above


def to_categories(data):
    """Translate a grid of dataset class numbers into a grid of our category numbers."""
    return IO_LOOKUP[data]  # numpy uses each pixel's number as a slot position in the lookup table, for all pixels at once


def to_hectares(pixel_count):
    """Turn a number of pixels into hectares (1 hectare = 10,000 square meters)."""
    return pixel_count * PIXEL_AREA_M2 / 10_000  # pixels x 100 m2, then divided by 10,000 m2 per hectare


# ---------- Comparing two years ----------

# The change code each pixel gets in the change grid; each code becomes one color on the map
NO_CHANGE = 0  # Same category in both years (or a change we don't color, like trees <-> grass/farmland)
CLEARED = 1  # Red: green space (trees or grass/farmland) that became bare ground
GAINED = 2  # Green: non-green land that became trees or grass/farmland
NEW_BUILT = 3  # Orange: any land that became built
NEW_WATER = 4  # Blue: any land that became water
UNKNOWN = 5  # No data in one or both years, so we can't tell

GREEN = [TREES, GRASS]  # The categories that count as green space


def compare(before, after, clean=True):
    """Compare two category grids pixel by pixel. Returns a grid of change codes (one per pixel).
    clean=False skips the edge cleaning (only the "How this works" page's patch script uses that, to show the difference)."""
    if before.shape != after.shape:  # The grids must cover the same pixels, or the comparison makes no sense
        raise ValueError(f"Grids differ in size: {before.shape} vs {after.shape}")  # Stop with a clear error message

    # Each line below makes a "mask": a grid of True/False, one per pixel, answering a yes/no question
    known = (before != NO_DATA) & (after != NO_DATA)  # Do we know the category in both years? ("&" = and, pixel by pixel)
    changed = known & (before != after)  # Known in both years, and the category is different
    green_before = np.isin(before, GREEN)  # Was the pixel green space in the first year?
    green_after = np.isin(after, GREEN)  # Is it green space in the latest year?

    change = np.full(before.shape, NO_CHANGE, dtype=np.uint8)  # Start with a grid where every pixel says "no change"
    change[changed & green_before & (after == BARE)] = CLEARED  # Green -> bare: red
    change[changed & ~green_before & green_after] = GAINED  # Non-green -> green: green ("~" = not)
    change[changed & (after == BUILT)] = NEW_BUILT  # Anything -> built: orange
    change[changed & (after == WATER)] = NEW_WATER  # Anything -> water: blue
    change[~known] = UNKNOWN  # No data in either year: unknown
    return remove_thin_changes(change) if clean else change  # Drop edge noise (see below) unless asked not to, then hand back the finished change grid


# ---------- Cleaning edge noise ----------
# A 10 m pixel on a shoreline or a road edge is partly one thing and partly another ("mixed pixel"), so its label can
# flip between years even though nothing changed. Those flips show up as thin rings, 1-2 pixels wide, along every edge.
# A "morphological opening" removes them: first shrink every colored patch by one pixel on all sides ("erode"), which
# wipes out anything narrower than 3 pixels, then grow what's left back by one pixel ("dilate"), which restores the
# shape of the bigger patches. Result: changes narrower than 30 m are dropped; wider ones (a new warehouse, a reservoir) stay.

CHANGE_COLORS = [CLEARED, GAINED, NEW_BUILT, NEW_WATER]  # The four colored change codes, cleaned one at a time


def neighbours(mask, pad_mode):
    """The 9 shifted copies of a True/False grid: each pixel paired with itself and its 8 neighbours.
    pad_mode says what lies beyond the edge of the square: "edge" repeats the border, "constant" means False."""
    padded = np.pad(mask, 1, mode=pad_mode)  # Add a 1-pixel frame around the grid, so every pixel has 8 neighbours
    rows, cols = mask.shape  # The grid's size
    return [padded[dy : dy + rows, dx : dx + cols] for dy in range(3) for dx in range(3)]  # Slide a window over the frame: 3 x 3 = 9 shifted grids


def erode(mask):
    """Shrink: a pixel stays True only if it and all 8 neighbours are True."""
    return np.logical_and.reduce(neighbours(mask, "edge"))  # "and" across the 9 shifted grids, pixel by pixel. "edge": the border of the square doesn't shrink a patch that just touches it


def dilate(mask):
    """Grow: a pixel becomes True if it or any of its 8 neighbours is True."""
    return np.logical_or.reduce(neighbours(mask, "constant"))  # "or" across the 9 shifted grids, pixel by pixel. "constant": nothing grows in from outside the square


def remove_thin_changes(change):
    """Remove colored changes narrower than 3 pixels (30 m), one color at a time. Removed pixels become NO_CHANGE."""
    cleaned = change.copy()  # Work on a copy, so the original grid stays as it was
    for code in CHANGE_COLORS:  # Red, green, orange, and blue, each on its own
        mask = change == code  # True where the pixel has this color
        kept = dilate(erode(mask))  # The opening: shrink, then grow back. Thin lines vanish in the shrink and can't grow back
        cleaned[mask & ~kept] = NO_CHANGE  # Pixels of this color that didn't survive become "no change" ("~" = not)
    return cleaned  # Hand back the cleaned grid


def from_to_counts(before, after):
    """Count every from -> to pair of categories. Returns a 6 x 6 table: row = category before, column = category after."""
    n = len(CATEGORY_NAMES)  # 6 categories
    pair_numbers = before.astype(np.int32) * n + after  # Give each pair its own number: before x 6 + after (e.g. grass(2) -> built(3) = 15)
    counts = np.bincount(pair_numbers.ravel(), minlength=n * n)  # Count how often each pair number appears (ravel = flatten the grid into one long list)
    return counts.reshape(n, n)  # Fold the 36 counts back into a 6 x 6 table


def summarize(before, after, change):
    """Work out the stats in hectares: area per change color, green space lost and gained, and the total area.
    Uses short keys (like "built") so the dictionary can go straight into the API's JSON answer."""
    green_before = np.isin(before, GREEN)  # Green in the first year
    colored_loss = np.isin(change, [CLEARED, NEW_BUILT, NEW_WATER])  # Red, orange, or blue on the (cleaned) map
    return {  # Hand back a dictionary of stats, all in hectares:
        "cleared": to_hectares(int((change == CLEARED).sum())),  # Red pixels ("== CLEARED" marks them True, ".sum()" counts the Trues)
        "gained": to_hectares(int((change == GAINED).sum())),  # Green pixels
        "built": to_hectares(int((change == NEW_BUILT).sum())),  # Orange pixels
        "water": to_hectares(int((change == NEW_WATER).sum())),  # Blue pixels
        "no_data": to_hectares(int((change == UNKNOWN).sum())),  # Pixels with no data in one or both years
        "green_lost": to_hectares(int((colored_loss & green_before).sum())),  # Every green -> non-green pixel still on the map after cleaning: red, plus orange and blue that used to be green
        "green_gained": to_hectares(int((change == GAINED).sum())),  # Every non-green -> green pixel still on the map after cleaning (the green pixels)
        "total": to_hectares(change.size),  # All pixels in the square (should be 400 ha)
    }  # End of the stats


# ---------- Finding the maps ----------

def open_catalog():
    """Connect to Planetary Computer's catalog, with every file link signed automatically. Only imagery.py uses it now."""
    return pystac_client.Client.open(  # Connect to the catalog...
        CATALOG_URL,  # ...at this address...
        modifier=planetary_computer.sign_inplace,  # ...and sign every file link we get back, automatically
    )  # End of the connection


# The latitude bands of the UTM grid, 8 degrees each, from 80°S upwards ("I" and "O" are skipped, as they look like 1 and 0)
BAND_LETTERS = "CDEFGHJKLMNPQRSTUVWX"


def grid_zone(lat, lon):
    """The grid-zone name of the file that covers a point, e.g. "11S" (Fontana) or "32V" (Stavanger), or None outside it.
    It is the military grid's zone: a UTM zone number (6° of longitude each) plus a latitude band letter (8° each)."""
    if not -80 <= lat < 84:  # The grid only covers 80°S to 84°N
        return None  # No file
    zone = int((lon + 180) // 6) + 1  # Zones 1 to 60, numbered eastwards from 180°W
    zone = min(zone, 60)  # Longitude exactly 180 would give 61: that's zone 60
    band = BAND_LETTERS[min(int((lat + 80) // 8), 19)]  # The band letter; the last band, X, is 12° tall (72-84°N), so cap at the 20th letter
    if band == "V" and zone == 31 and lon >= 3:  # Exception: south-west Norway (around Stavanger) is drawn into zone 32
        zone = 32  # 32V covers 3-12°E
    if band == "X" and zone in (32, 34, 36):  # Exception: Svalbard has wider zones; 32X, 34X and 36X don't exist
        if zone == 32:  # 32X is split between its neighbours
            zone = 31 if lon < 9 else 33  # 0-9°E -> 31X, 9-21°E -> 33X
        elif zone == 34:  # 34X likewise
            zone = 33 if lon < 21 else 35  # 9-21°E -> 33X, 21-33°E -> 35X
        else:  # 36X likewise
            zone = 35 if lon < 33 else 37  # 21-33°E -> 35X, 33-42°E -> 37X
    return f"{zone:02d}{band}"  # e.g. "11S", or "01C" (zone numbers below 10 get a leading zero, like the file names)


def file_exists(url):
    """Ask the web server whether a file exists, without downloading it (a "HEAD" request)."""
    try:  # The server answers "not found" with an error
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=10):  # Ask for the file's details only
            return True  # It answered: the file is there
    except urllib.error.HTTPError:  # 404 (not found) or 403 (the bucket answers 403 for missing files to anonymous visitors)
        return False  # No such file


_newest_year = None  # The newest year with files, once checked (None = not yet): checked once per server run, see newest_year
REFERENCE_ZONE = "11S"  # A zone that certainly has data (southern California), used to look for newly published years


def newest_year():
    """The newest year with land-cover files. Impact Observatory publishes a new year for every zone at once (2024 came in
    June 2025), so one zone is enough to check, once per server run: is the year after the newest known one there yet?"""
    global _newest_year  # We change the module-level value (not a new local one)
    if _newest_year is None:  # Not checked yet in this server run:
        year = NEWEST_KNOWN_YEAR  # Start from the newest known year...
        while file_exists(LULC_URL.format(zone=REFERENCE_ZONE, year=year + 1)):  # ...and step forward while the next year exists
            year += 1  # It does: that's the newest so far
        _newest_year = year  # Remember it
    return _newest_year  # Hand it back


# ---------- Facts about each grid zone, saved on disk ----------
# Two facts per zone are needed before a saved analysis can even be found: whether the zone has data, and its pixel grid.
# Finding them out costs a HEAD request and a file-header read (about 1.3 s together), so they are saved in a small file
# and survive server restarts. They never change, except "has data", which is re-checked when a new year appears.
ZONE_FILE = settings.CACHE_ROOT / "zones.json"  # backend/cache/zones.json (or on the server's disk, see settings.py; generated, ignored by git)
_zone_lock = threading.Lock()  # One request at a time may change and save the facts (requests run in parallel threads)


def load_zone_facts():
    """The saved facts, e.g. {"11S": {"checked_year": 2024, "has_data": true, "crs": "EPSG:32611", "transform": [...]}},
    or an empty dictionary if there's no file yet (or it can't be read)."""
    try:  # The file may not exist yet
        return json.loads(ZONE_FILE.read_text(encoding="utf-8"))  # Read it
    except (OSError, ValueError):  # No file, or a damaged one:
        return {}  # Start empty (the facts are simply found out again)


_zone_facts = load_zone_facts()  # Read once when the server starts, then kept up to date in memory and on disk


def save_zone_fact(zone, **facts):
    """Add or update facts about one zone (e.g. has_data=True), in memory and in the file."""
    with _zone_lock:  # One at a time
        _zone_facts[zone] = {**_zone_facts.get(zone, {}), **facts}  # Merge the new facts into the zone's entry ("**" spreads a dictionary)
        ZONE_FILE.parent.mkdir(parents=True, exist_ok=True)  # Create the cache folder the first time
        temporary = ZONE_FILE.with_suffix(".tmp")  # Write under a temporary name first...
        temporary.write_text(json.dumps(_zone_facts, indent=1), encoding="utf-8")  # ...all the facts...
        temporary.replace(ZONE_FILE)  # ...then rename it in one go, so a half-written file can never be read


def years_in_zone(zone):
    """The years that have a file for this grid zone, oldest first (an empty list if the zone has none, e.g. open ocean).
    One quick check per zone, saved on disk: is there a file for the newest year? (Every year has the same zones.)"""
    last = newest_year()  # The newest year (checked once per server run)
    facts = _zone_facts.get(zone, {})  # What we know about this zone so far
    if facts.get("checked_year") != last:  # Never checked, or checked before a newer year appeared:
        save_zone_fact(zone, checked_year=last, has_data=file_exists(LULC_URL.format(zone=zone, year=last)))  # Check and save
        facts = _zone_facts[zone]  # The updated facts
    return list(range(FIRST_YEAR, last + 1)) if facts["has_data"] else []  # Every year from 2017 to the newest, or none


def find_files_by_year(lon, lat):
    """All the yearly map files covering the point, as {year: web address}, oldest year first (empty if there are none)."""
    zone = grid_zone(lat, lon)  # Which grid zone the point is in, e.g. "11S"
    if zone is None:  # Outside the grid (near the poles):
        return {}  # No files
    return {year: LULC_URL.format(zone=zone, year=year) for year in years_in_zone(zone)}  # e.g. {2017: ".../11S_2017.tif", ...}


# ---------- Reading our square ----------

def square_window(crs, file_transform, lon, lat):
    """Which rows and columns of a map file our 2 x 2 km square covers, snapped to whole pixels.
    "crs" is the file's projection and "file_transform" links its pixel rows/columns to meters.
    Shared by read_square and by the satellite photo (imagery.py), so both always use exactly the same pixel grid."""
    xs, ys = transform("EPSG:4326", crs, [lon], [lat])  # Convert the point from longitude/latitude (EPSG:4326) to the file's projection (a UTM zone, in meters)
    x, y = xs[0], ys[0]  # transform works on lists, so take the first (only) point
    exact = from_bounds(  # Work out which rows and columns of the file our square covers:
        x - HALF_SIZE_M, y - HALF_SIZE_M,  # the square's left and bottom edges (in meters),
        x + HALF_SIZE_M, y + HALF_SIZE_M,  # and its right and top edges,
        transform=file_transform,  # using the file's "transform"
    )  # End of the exact window (its edges can fall partway through a pixel)
    size = round(2 * HALF_SIZE_M / file_transform.a)  # How many pixels across: 2,000 m / 10 m = 200 ("a" is the pixel width in the transform)
    return Window(round(exact.col_off), round(exact.row_off), size, size)  # Snap to whole pixels: round the starting column and row, keep 200 x 200


def square_grid(url, lon, lat):
    """The square's pixel grid in one land-cover map file: (its projection, its "transform", its size in pixels).
    The satellite photo (imagery.py) is drawn onto this grid, so every photo pixel sits exactly on one land-cover pixel."""
    with rasterio.open(url) as src:  # Open the map file over the internet (only its header is read)
        crs, file_transform = src.crs, src.transform  # Its projection and grid
    window = square_window(crs, file_transform, lon, lat)  # Our square's rows and columns
    return crs, rasterio.windows.transform(window, file_transform), window.width  # The projection, the square's own transform, and 200


def zone_grid(zone, url):
    """The projection and pixel grid ("transform") of a grid zone's files. Every year's file of a zone uses exactly the same
    grid (checked for 11S, 32V and 33U, 2017-2024), so one file header (url, any year) is read once per zone and saved on disk."""
    facts = _zone_facts.get(zone, {})  # What we know about this zone so far
    if "crs" not in facts:  # Its grid isn't known yet:
        with rasterio.open(url) as src:  # Open the file over the internet (only its header is read)
            save_zone_fact(zone, crs=src.crs.to_string(), transform=list(src.transform)[:6])  # Save the projection's name and the grid's six numbers
        facts = _zone_facts[zone]  # The updated facts
    return rasterio.crs.CRS.from_string(facts["crs"]), rasterio.Affine(*facts["transform"])  # Rebuild the projection and grid from the saved text and numbers


def square_position(lon, lat, url):
    """Where the point's 2 x 2 km square sits on the land-cover grid: (grid zone, first column, first row), e.g.
    ("11S", 37112, 40381). The same snapped window read_square reads, so it identifies exactly which 200 x 200 pixels
    an analysis uses. "url" is any of the place's files (only needed the first time its zone is seen)."""
    zone = grid_zone(lat, lon)  # The grid zone, e.g. "11S"
    crs, file_transform = zone_grid(zone, url)  # Its projection and grid (remembered after the first time)
    window = square_window(crs, file_transform, lon, lat)  # The square's snapped rows and columns
    return zone, int(window.col_off), int(window.row_off)  # Where it starts on the grid


def read_square(url, lon, lat):
    """Read only the 2 x 2 km square around the point from one map file (its web address, from find_files_by_year).
    Returns (grid of dataset class numbers, the square's four corners as [longitude, latitude])."""
    with rasterio.open(url) as src:  # Open the file over the internet; nothing big is downloaded yet
        window = square_window(src.crs, src.transform, lon, lat)  # Our square's rows and columns (see square_window above)
        size = window.width  # How many pixels across: 200
        data = src.read(  # Download and read just that window...
            1,  # ...of band 1 (the only band: class numbers)...
            window=window,  # ...in our snapped window...
            boundless=True,  # ...allowing it to stick out past the file's edge...
            fill_value=0,  # ...in which case the missing pixels become 0 (no data) instead of an error
        )  # End of the read

        # The square's four corners, in the file's meters. window_transform links this window's pixel columns/rows to meters.
        win_transform = src.window_transform(window)  # The "transform" for just our window
        left, top = win_transform * (0, 0)  # Column 0, row 0: the top-left corner of the first pixel
        right, bottom = win_transform * (size, size)  # Column 200, row 200: the bottom-right corner of the last pixel
        corner_xs = [left, right, right, left]  # Corners in MapLibre's order: top-left, top-right, bottom-right, bottom-left
        corner_ys = [top, top, bottom, bottom]  # The matching up-down positions
        lons, lats = transform(src.crs, "EPSG:4326", corner_xs, corner_ys)  # Convert all four from UTM meters back to longitude/latitude
        corners = [[lo, la] for lo, la in zip(lons, lats)]  # Pair them up: [[lon, lat], [lon, lat], ...]
        return data, corners  # Hand back the pixel grid and its corners
