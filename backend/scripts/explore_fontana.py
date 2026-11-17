# Exploration script (B3): look at the real land-cover data for one place before we build anything on it.
# It is not part of the app. Run it from the backend folder with:  uv run python scripts/explore_fontana.py
# To look at another spot, add its latitude and longitude:          uv run python scripts/explore_fontana.py 34.03 -117.47

import sys  # Built into Python; sys.argv is the list of words typed on the command line

import numpy as np  # numpy: fast math on big grids of numbers (our raster window becomes a numpy grid)
import planetary_computer  # Signs Planetary Computer file links so we're allowed to download them
import pystac_client  # Searches the STAC catalog (the index of available maps)
import rasterio  # Reads raster files, including just a small window of a big file
from rasterio.warp import transform  # Converts coordinates from one projection to another
from rasterio.windows import from_bounds  # Turns a box in map units (meters) into a window of rows and columns

# ---------- Settings ----------

if len(sys.argv) == 3:  # sys.argv is [script name, word 1, word 2]; 3 entries means two numbers were typed
    LAT, LON = float(sys.argv[1]), float(sys.argv[2])  # Turn the typed text into numbers: latitude first, as people usually say it
    PLACE_NAME = "Custom point"  # Just for the printout
else:  # Nothing (or the wrong number of words) typed:
    PLACE_NAME = "Fontana, California"  # use the default place
    LON, LAT = -117.435, 34.092  # The place's longitude and latitude (same as in frontend/src/places.js)
HALF_SIZE_M = 1000  # Half the square's width in meters: 1 km in each direction gives a 2 x 2 km square
PIXEL_AREA_M2 = 10 * 10  # Each pixel is 10 m x 10 m = 100 square meters

CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"  # The address of Planetary Computer's catalog
COLLECTION = "io-lulc-annual-v02"  # The dataset: Impact Observatory 10 m annual land use / land cover, version 2

# What each pixel number means in this dataset (numbers 3 and 6 are not used)
CLASS_NAMES = {
    0: "No data",  # Nothing measured here
    1: "Water",  # Rivers, lakes, sea, ponds
    2: "Trees",  # Forest and other dense, tall vegetation
    4: "Flooded vegetation",  # Wetlands, mangroves, rice paddies
    5: "Crops",  # Farmland
    7: "Built area",  # Buildings, roads, parking lots, other paved surfaces
    8: "Bare ground",  # Sand, rock, cleared soil
    9: "Snow/ice",  # Permanent snow and glaciers
    10: "Clouds",  # Always cloudy all year, so the surface couldn't be seen
    11: "Rangeland",  # Grass, shrubs, and other open, low vegetation
}  # End of the class names


# ---------- Step 1: find the maps ----------

def find_items_by_year():
    """Search the catalog for all maps of our point, and return them sorted by year."""
    catalog = pystac_client.Client.open(  # Connect to the catalog...
        CATALOG_URL,  # ...at this address...
        modifier=planetary_computer.sign_inplace,  # ...and sign every file link we get back, automatically
    )  # End of the connection
    search = catalog.search(  # Ask the catalog a question:
        collections=[COLLECTION],  # look only in this dataset,
        intersects={"type": "Point", "coordinates": [LON, LAT]},  # for maps that cover our point (GeoJSON: longitude first)
    )  # End of the search
    items_by_year = {}  # An empty dictionary: year -> map item
    for item in search.items():  # Go through every map the catalog found
        year = int(item.properties["start_datetime"][:4])  # Each map covers one year; the first 4 characters of its start date are the year
        items_by_year[year] = item  # Remember the item under its year
    return dict(sorted(items_by_year.items()))  # Hand back the dictionary sorted from oldest to newest year


# ---------- Step 2: read our square ----------

def read_square(item):
    """Read only the 2 x 2 km square around our point from one map, and return the pixel grid."""
    url = item.assets["data"].href  # The (signed) web address of the map's GeoTIFF file
    with rasterio.open(url) as src:  # Open the file over the internet; nothing big is downloaded yet
        xs, ys = transform("EPSG:4326", src.crs, [LON], [LAT])  # Convert our point from longitude/latitude (EPSG:4326) to the file's projection (a UTM zone, in meters)
        x, y = xs[0], ys[0]  # transform works on lists, so take the first (only) point
        window = from_bounds(  # Work out which rows and columns of the file our square covers:
            x - HALF_SIZE_M, y - HALF_SIZE_M,  # the square's left and bottom edges (in meters),
            x + HALF_SIZE_M, y + HALF_SIZE_M,  # and its right and top edges,
            transform=src.transform,  # using the file's "transform", which links pixel rows/columns to meters
        )  # End of the window
        data = src.read(1, window=window)  # Download and read just that window of band 1 (the only band: class numbers)
        return data, src.crs  # Hand back the pixel grid and the projection's name


# ---------- Step 3: count pixels per class ----------

def count_classes(data):
    """Count how many pixels of each class are in the grid. Returns {class number: pixel count}."""
    values, counts = np.unique(data, return_counts=True)  # numpy lists every distinct number in the grid, and how often it appears
    return {int(v): int(c) for v, c in zip(values, counts)}  # Pair them up into a normal dictionary


# ---------- Run everything ----------

def main():
    """Find the maps, read the first and latest year, and print a comparison table."""
    print(f"Place: {PLACE_NAME} ({LAT}, {LON})")  # Say which place we're looking at
    print("Searching the catalog...")  # Let the user know something is happening

    items_by_year = find_items_by_year()  # Step 1: find all available years
    years = list(items_by_year)  # Just the years, e.g. [2017, 2018, ...]
    print(f"Years available: {', '.join(str(y) for y in years)}")  # Print them on one line
    first, latest = years[0], years[-1]  # The oldest and newest year

    counts = {}  # year -> {class number: pixel count}
    for year in (first, latest):  # Do the same for both years:
        item = items_by_year[year]  # the map for that year
        print(f"Reading {year} (map tile {item.id})...")  # Show which tile we're reading
        data, crs = read_square(item)  # Step 2: read the square
        print(f"  Window: {data.shape[1]} x {data.shape[0]} pixels, projection {crs}")  # Columns x rows; should be 200 x 200
        counts[year] = count_classes(data)  # Step 3: count the classes

    # Print the table
    print()  # An empty line
    header = f"{'Class':<20}{first:>12}{'ha':>8}{latest:>12}{'ha':>8}{'change ha':>12}"  # Column titles; "<20" means left-aligned in 20 characters, ">12" right-aligned in 12
    print(header)  # Print the titles
    print("-" * len(header))  # A line of dashes as wide as the titles
    all_classes = sorted(set(counts[first]) | set(counts[latest]))  # Every class that appears in either year
    for cls in all_classes:  # One row per class
        a = counts[first].get(cls, 0)  # Pixels in the first year (0 if the class is absent)
        b = counts[latest].get(cls, 0)  # Pixels in the latest year
        ha_a = a * PIXEL_AREA_M2 / 10_000  # Pixels -> hectares: x 100 m2, then / 10,000 m2 per hectare
        ha_b = b * PIXEL_AREA_M2 / 10_000  # Same for the latest year
        name = CLASS_NAMES.get(cls, f"Unknown ({cls})")  # The class name, or "Unknown" if the number isn't in our list
        print(f"{name:<20}{a:>12}{ha_a:>8.1f}{b:>12}{ha_b:>8.1f}{ha_b - ha_a:>+12.1f}")  # ".1f" = one decimal; "+" always shows the sign
    total = sum(counts[first].values())  # Total pixels in the window
    print("-" * len(header))  # Closing line
    print(f"{'Total':<20}{total:>12}{total * PIXEL_AREA_M2 / 10_000:>8.1f}")  # Should be 40,000 pixels = 400 ha (2 x 2 km)


if __name__ == "__main__":  # Only run main() when this file is started directly (not when another file imports it)
    main()  # Go!
