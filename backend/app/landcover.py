# Land-cover data: find the yearly maps for a place, read our 2 x 2 km square, and translate the
# dataset's classes into Landturn's own six categories. Used by the exploration script now, and by the API later.

import numpy as np  # numpy: fast math on big grids of numbers
import planetary_computer  # Signs Planetary Computer file links so we're allowed to download them
import pystac_client  # Searches the STAC catalog (the index of available maps)
import rasterio  # Reads raster files, including just a small window of a big file
from rasterio.warp import transform  # Converts coordinates from one projection to another
from rasterio.windows import from_bounds  # Turns a box in map units (meters) into a window of rows and columns

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

# The readable name of each change code
CHANGE_NAMES = {
    CLEARED: "Green space cleared (red)",  # 1
    GAINED: "Green space gained (green)",  # 2
    NEW_BUILT: "Newly built (orange)",  # 3
    NEW_WATER: "New water (blue)",  # 4
    UNKNOWN: "No data in one or both years",  # 5
}  # End of the change names

GREEN = [TREES, GRASS]  # The categories that count as green space


def compare(before, after):
    """Compare two category grids pixel by pixel. Returns a grid of change codes (one per pixel)."""
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
    return change  # Hand back the finished change grid


def from_to_counts(before, after):
    """Count every from -> to pair of categories. Returns a 6 x 6 table: row = category before, column = category after."""
    n = len(CATEGORY_NAMES)  # 6 categories
    pair_numbers = before.astype(np.int32) * n + after  # Give each pair its own number: before x 6 + after (e.g. grass(2) -> built(3) = 15)
    counts = np.bincount(pair_numbers.ravel(), minlength=n * n)  # Count how often each pair number appears (ravel = flatten the grid into one long list)
    return counts.reshape(n, n)  # Fold the 36 counts back into a 6 x 6 table


def summarize(before, after, change):
    """Work out the stats in hectares: area per change color, green space lost and gained, and the total area."""
    stats = {name: to_hectares(int((change == code).sum())) for code, name in CHANGE_NAMES.items()}  # Hectares for each change code
    known = (before != NO_DATA) & (after != NO_DATA)  # Pixels we know in both years
    green_before = np.isin(before, GREEN)  # Green in the first year
    green_after = np.isin(after, GREEN)  # Green in the latest year
    stats["Green space lost (all)"] = to_hectares(int((known & green_before & ~green_after).sum()))  # Every green -> non-green pixel: red, plus orange and blue that used to be green
    stats["Green space gained (all)"] = to_hectares(int((known & ~green_before & green_after).sum()))  # Every non-green -> green pixel
    stats["Total area"] = to_hectares(change.size)  # All pixels in the square (should be 400 ha)
    return stats  # Hand back the dictionary of stats


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
    """Read only the 2 x 2 km square around the point from one map. Returns the grid of dataset class numbers."""
    url = item.assets["data"].href  # The (signed) web address of the map's GeoTIFF file
    with rasterio.open(url) as src:  # Open the file over the internet; nothing big is downloaded yet
        xs, ys = transform("EPSG:4326", src.crs, [lon], [lat])  # Convert the point from longitude/latitude (EPSG:4326) to the file's projection (a UTM zone, in meters)
        x, y = xs[0], ys[0]  # transform works on lists, so take the first (only) point
        window = from_bounds(  # Work out which rows and columns of the file our square covers:
            x - HALF_SIZE_M, y - HALF_SIZE_M,  # the square's left and bottom edges (in meters),
            x + HALF_SIZE_M, y + HALF_SIZE_M,  # and its right and top edges,
            transform=src.transform,  # using the file's "transform", which links pixel rows/columns to meters
        )  # End of the window
        return src.read(1, window=window)  # Download and read just that window of band 1 (the only band: class numbers)
