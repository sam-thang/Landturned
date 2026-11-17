# Exploration script: look at the real land-cover data for one place, in Landturn's six categories.
# It is not part of the app. Run it from the backend folder with:  uv run python -m scripts.explore_fontana
# To look at another spot, add its latitude and longitude:          uv run python -m scripts.explore_fontana 34.03 -117.47
# ("-m" runs the file as a module, which lets it find our own code in the app folder.)

import sys  # Built into Python; sys.argv is the list of words typed on the command line

from app import landcover  # Our own land-cover code, in app/landcover.py

# ---------- Which place ----------

if len(sys.argv) == 3:  # sys.argv is [script name, word 1, word 2]; 3 entries means two numbers were typed
    LAT, LON = float(sys.argv[1]), float(sys.argv[2])  # Turn the typed text into numbers: latitude first, as people usually say it
    PLACE_NAME = "Custom point"  # Just for the printout
else:  # Nothing (or the wrong number of words) typed:
    PLACE_NAME = "Fontana, California"  # use the default place
    LON, LAT = -117.435, 34.092  # The place's longitude and latitude (same as in frontend/src/places.js)


def count_categories(categories):
    """Count how many pixels of each of our categories are in the grid. Returns {category number: pixel count}."""
    return {cat: int((categories == cat).sum()) for cat in landcover.CATEGORY_NAMES}  # For each category: mark matching pixels True, then count the Trues


def main():
    """Find the maps, read the first and latest year, and print a table in our categories."""
    print(f"Place: {PLACE_NAME} ({LAT}, {LON})")  # Say which place we're looking at
    print("Searching the catalog...")  # Let the user know something is happening

    items_by_year = landcover.find_items_by_year(LON, LAT)  # Find all available years
    years = list(items_by_year)  # Just the years, e.g. [2017, 2018, ...]
    print(f"Years available: {', '.join(str(y) for y in years)}")  # Print them on one line
    first, latest = years[0], years[-1]  # The oldest and newest year

    counts = {}  # year -> {category number: pixel count}
    for year in (first, latest):  # Do the same for both years:
        print(f"Reading {year}...")  # Show progress
        data = landcover.read_square(items_by_year[year], LON, LAT)  # Read the square (dataset class numbers)
        categories = landcover.to_categories(data)  # Translate into our six categories
        print(f"  Window: {categories.shape[1]} x {categories.shape[0]} pixels")  # Columns x rows; should be 200 x 200
        counts[year] = count_categories(categories)  # Count the pixels per category

    # Print the table
    print()  # An empty line
    header = f"{'Category':<20}{first:>12}{'ha':>8}{latest:>12}{'ha':>8}{'net ha':>10}"  # Column titles; "<20" = left-aligned in 20 characters, ">12" = right-aligned in 12
    print(header)  # Print the titles
    print("-" * len(header))  # A line of dashes as wide as the titles
    for cat, name in landcover.CATEGORY_NAMES.items():  # One row per category, in our fixed order
        a = counts[first][cat]  # Pixels in the first year
        b = counts[latest][cat]  # Pixels in the latest year
        ha_a, ha_b = landcover.to_hectares(a), landcover.to_hectares(b)  # Both in hectares
        print(f"{name:<20}{a:>12}{ha_a:>8.1f}{b:>12}{ha_b:>8.1f}{ha_b - ha_a:>+10.1f}")  # ".1f" = one decimal; "+" always shows the sign
    total = sum(counts[first].values())  # Total pixels in the window
    print("-" * len(header))  # Closing line
    print(f"{'Total':<20}{total:>12}{landcover.to_hectares(total):>8.1f}")  # Should be 40,000 pixels = 400 ha (2 x 2 km)


if __name__ == "__main__":  # Only run main() when this file is started directly (not when another file imports it)
    main()  # Go!
