# Exploration script: look at the real land-cover data for one place, in Landturn's six categories.
# It is not part of the app. Run it from the backend folder with:  uv run python -m scripts.explore_fontana
# To look at another spot, add its latitude and longitude:          uv run python -m scripts.explore_fontana 34.03 -117.47
# ("-m" runs the file as a module, which lets it find our own code in the app folder.)

import sys  # Built into Python; sys.argv is the list of words typed on the command line
import tempfile  # Built into Python; tells us where the computer's temporary-files folder is
from pathlib import Path  # Built into Python; a handy way to build file paths

from app import change_image, landcover  # Our own code: the change picture (app/change_image.py) and land cover (app/landcover.py)

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
    grids = {}  # year -> category grid (kept for the comparison below)
    for year in (first, latest):  # Do the same for both years:
        print(f"Reading {year}...")  # Show progress
        data, corners = landcover.read_square(items_by_year[year], LON, LAT)  # Read the square (dataset class numbers) and its four corners
        categories = landcover.to_categories(data)  # Translate into our six categories
        print(f"  Window: {categories.shape[1]} x {categories.shape[0]} pixels")  # Columns x rows; should be 200 x 200
        counts[year] = count_categories(categories)  # Count the pixels per category
        grids[year] = categories  # Keep the grid

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

    # ---------- Pixel-by-pixel comparison ----------
    before, after = grids[first], grids[latest]  # The two category grids
    change = landcover.compare(before, after)  # One change code per pixel

    print()  # An empty line
    print(f"Change {first} -> {latest} (pixel by pixel)")  # Section title
    print("-" * 44)  # A line of dashes
    for name, hectares in landcover.summarize(before, after, change).items():  # Each stat and its value
        print(f"{name:<34}{hectares:>7.1f} ha")  # Name left-aligned, hectares right-aligned with one decimal

    # The biggest from -> to changes, largest first
    table = landcover.from_to_counts(before, after)  # 6 x 6 table of pixel counts
    names = landcover.CATEGORY_NAMES  # Shorter name for the category names
    pairs = []  # A list of (pixel count, from name, to name)
    for a in names:  # Every "before" category
        for b in names:  # Every "after" category
            if a != b and table[a, b] > 0:  # Only real changes that actually happened
                pairs.append((int(table[a, b]), names[a], names[b]))  # Remember this pair
    pairs.sort(reverse=True)  # Sort by pixel count, largest first

    print()  # An empty line
    print("Biggest from -> to changes")  # Section title
    print("-" * 44)  # A line of dashes
    for count, from_name, to_name in pairs[:10]:  # The top 10 pairs
        print(f"{from_name + ' -> ' + to_name:<34}{landcover.to_hectares(count):>7.1f} ha")  # e.g. "Grass/farmland -> Built   12.3 ha"
    changed_total = sum(count for count, _, _ in pairs)  # All changed pixels together (gross change)
    print(f"{'All changes together (gross)':<34}{landcover.to_hectares(changed_total):>7.1f} ha")  # The total of every from -> to change

    # ---------- The change picture and its corners ----------
    print()  # An empty line
    print("Corners (longitude, latitude)")  # Section title
    for label, (lo, la) in zip(["top-left", "top-right", "bottom-right", "bottom-left"], corners):  # Each corner with its name
        print(f"  {label:<14}{lo:.6f}, {la:.6f}")  # 6 decimals = about 10 cm
    png = change_image.make_png(change)  # Turn the change grid into a PNG picture
    out_path = Path(tempfile.gettempdir()) / "landturn-change.png"  # Save it in the temporary-files folder, not in the project
    out_path.write_bytes(png)  # Write the PNG bytes to that file
    print(f"Change picture saved ({len(png):,} bytes): {out_path}")  # Say where it is and how big ("," adds thousands separators)


if __name__ == "__main__":  # Only run main() when this file is started directly (not when another file imports it)
    main()  # Go!
