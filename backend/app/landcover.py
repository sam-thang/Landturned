# Land-cover data: find the yearly maps for a place, read our 2 x 2 km square, and translate the
# dataset's classes into Landturn's own six categories. Used by the exploration script now, and by the API later.

import numpy as np  # numpy: fast math on big grids of numbers
import planetary_computer  # Signs Planetary Computer file links so we're allowed to download them
import pystac_client  # Searches the STAC catalog (the index of available maps)
import rasterio  # Reads raster files, including just a small window of a big file
from rasterio.warp import transform  # Converts coordinates from one projection to another
from rasterio.windows import Window, from_bounds  # Window: a block of rows and columns; from_bounds: turns a box in meters into a window

# ---------- Settings ----------

HALF_SIZE_M = 1000  # Half the square's width in meters: 1 km in each direction gives the 2 x 2 km square the map shows
PIXEL_AREA_M2 = 10 * 10  # Each pixel is 10 m x 10 m = 100 square meters
CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"  # The address of Planetary Computer's catalog
COLLECTION = "io-lulc-annual-v02"  # The dataset: Impact Observatory 10 m annual land use / land cover, version 2

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

def find_items_by_year(lon, lat):
    """Search the catalog for all maps covering the point, and return them as {year: item}, oldest year first."""
    catalog = pystac_client.Client.open(  # Connect to the catalog...
        CATALOG_URL,  # ...at this address...
        modifier=planetary_computer.sign_inplace,  # ...and sign every file link we get back, automatically
    )  # End of the connection
    search = catalog.search(  # Ask the catalog a question:
        collections=[COLLECTION],  # look only in this dataset,
        intersects={"type": "Point", "coordinates": [lon, lat]},  # for maps that cover the point (GeoJSON: longitude first)
    )  # End of the search
    items_by_year = {}  # An empty dictionary: year -> map item
    for item in search.items():  # Go through every map the catalog found
        year = int(item.properties["start_datetime"][:4])  # Each map covers one year; the first 4 characters of its start date are the year
        items_by_year[year] = item  # Remember the item under its year
    return dict(sorted(items_by_year.items()))  # Hand back the dictionary sorted from oldest to newest year


# ---------- Reading our square ----------

def read_square(item, lon, lat):
    """Read only the 2 x 2 km square around the point from one map.
    Returns (grid of dataset class numbers, the square's four corners as [longitude, latitude])."""
    url = item.assets["data"].href  # The (signed) web address of the map's GeoTIFF file
    with rasterio.open(url) as src:  # Open the file over the internet; nothing big is downloaded yet
        xs, ys = transform("EPSG:4326", src.crs, [lon], [lat])  # Convert the point from longitude/latitude (EPSG:4326) to the file's projection (a UTM zone, in meters)
        x, y = xs[0], ys[0]  # transform works on lists, so take the first (only) point
        exact = from_bounds(  # Work out which rows and columns of the file our square covers:
            x - HALF_SIZE_M, y - HALF_SIZE_M,  # the square's left and bottom edges (in meters),
            x + HALF_SIZE_M, y + HALF_SIZE_M,  # and its right and top edges,
            transform=src.transform,  # using the file's "transform", which links pixel rows/columns to meters
        )  # End of the exact window (its edges can fall partway through a pixel)
        size = round(2 * HALF_SIZE_M / src.res[0])  # How many pixels across: 2,000 m / 10 m = 200
        window = Window(round(exact.col_off), round(exact.row_off), size, size)  # Snap to whole pixels: round the starting column and row, keep 200 x 200
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
