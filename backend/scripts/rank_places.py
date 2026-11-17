# Ranking script: find the best hotspot places for the globe, using exactly the same analysis as the app.
# It is not part of the app. Run it from the backend folder with:   uv run python -m scripts.rank_places
# To check only some candidates, add their ids:                      uv run python -m scripts.rank_places giga_texas gerd
#
# Why: a hotspot is only honest if its change happened inside our data's years (2017 to the latest year)
# AND inside the 2 x 2 km square the app analyses. A famous place isn't enough. So for every candidate we
# run the app's own analysis, try a few nearby squares ("nudging", because our starting points are rough),
# keep the square with the most change of the expected kind, and print a ranked table.

import math  # Built into Python; math.cos for converting kilometers to degrees of longitude
import sys  # Built into Python; sys.argv is the list of words typed on the command line
import tempfile  # Built into Python; tells us where the computer's temporary-files folder is
import time  # Built into Python; time.perf_counter measures how long things take
from pathlib import Path  # Built into Python; a handy way to build file paths

from app import change_image, landcover  # Our own code: the change picture (app/change_image.py) and land cover (app/landcover.py)

# ---------- Candidates ----------
# Each candidate: (id, name shown to people, latitude, longitude, expected kind of change).
# The kind is the stat we try to maximize: "built" (orange), "cleared" (red: green -> bare ground),
# "gained" (green: non-green -> green) or "water" (blue).
# The coordinates are rough starting points; the nudging below searches around them.
CANDIDATES = [
    ("giga_texas", "Tesla Giga Texas, Austin", 30.222, -97.617, "built"),  # Car factory built 2020-2022 on former farmland and gravel pits
    ("gerd", "Grand Ethiopian Renaissance Dam", 11.215, 35.093, "water"),  # Dam on the Blue Nile; its reservoir filled 2020-2023
    ("novo_progresso", "Novo Progresso, Brazil", -7.04, -55.42, "cleared"),  # Amazon frontier town on the BR-163 highway
]  # End of the candidates

# ---------- Nudging settings ----------
NUDGE_M = 1500  # Distance in meters between the squares we try (1.5 km)
NUDGE_STEPS = [-1, 0, 1]  # Try one step south/west, no step, and one step north/east: 3 x 3 = 9 squares in total
METERS_PER_DEGREE_LAT = 111_320  # One degree of latitude is about 111 km everywhere on Earth


def nudged_points(lat, lon):
    """List the 9 square centers around a point, 1.5 km apart, as (lat, lon) pairs."""
    lat_step = NUDGE_M / METERS_PER_DEGREE_LAT  # 1.5 km in degrees of latitude
    lon_step = NUDGE_M / (METERS_PER_DEGREE_LAT * math.cos(math.radians(lat)))  # 1.5 km in degrees of longitude: lines of longitude get closer together away from the equator, so divide by cos(latitude)
    return [  # Every combination of a north-south step and an east-west step:
        (lat + dy * lat_step, lon + dx * lon_step)  # the shifted center
        for dy in NUDGE_STEPS  # for each north-south step,
        for dx in NUDGE_STEPS  # and each east-west step
    ]  # End of the list


def analyse(items_by_year, lat, lon):
    """Run the app's analysis for one square: first year vs latest year. Returns (stats in hectares, change grid)."""
    years = list(items_by_year)  # The available years, oldest first
    before_item, after_item = items_by_year[years[0]], items_by_year[years[-1]]  # The first and the latest year's maps
    before_raw, _ = landcover.read_square(before_item, lon, lat)  # Read the square from the first year ("_" = we don't need the corners)
    after_raw, _ = landcover.read_square(after_item, lon, lat)  # ...and from the latest year
    before = landcover.to_categories(before_raw)  # Translate the dataset's classes into our six categories
    after = landcover.to_categories(after_raw)  # Same for the latest year
    change = landcover.compare(before, after)  # One change code per pixel, exactly like the app
    return landcover.summarize(before, after, change), change  # The stats and the change grid


def best_square(name, lat, lon, kind):
    """Try the 9 nudged squares around a candidate and return the one with the most change of the expected kind.
    Returns a dictionary with the best square's center, its stats, its change grid, and the years compared."""
    items_by_year = landcover.find_items_by_year(lon, lat)  # Find the maps once; nearby squares are on the same maps
    if not items_by_year:  # No maps at all (e.g. a point in the sea):
        print(f"  {name}: no data here")  # say so
        return None  # and give up on this candidate
    years = list(items_by_year)  # The available years
    best = None  # The best square so far (none yet)
    for i, (lat_n, lon_n) in enumerate(nudged_points(lat, lon), start=1):  # Try each nudged square, counting from 1
        stats, change = analyse(items_by_year, lat_n, lon_n)  # Run the analysis there
        print(f"  {name}: square {i}/9 -> {kind} {stats[kind]:.1f} ha")  # Show progress
        if best is None or stats[kind] > best["stats"][kind]:  # The first square, or more change than the best so far:
            best = {"lat": lat_n, "lon": lon_n, "stats": stats, "change": change, "years": (years[0], years[-1])}  # it's the new best
    return best  # Hand back the winner


def main():
    """Rank the candidates (or only the ones named on the command line) and print a table."""
    wanted = set(sys.argv[1:])  # Any ids typed after the script name, e.g. {"giga_texas", "gerd"}
    candidates = [c for c in CANDIDATES if not wanted or c[0] in wanted]  # All candidates, or only the wanted ones
    out_dir = Path(tempfile.gettempdir()) / "landturn-places"  # A folder in the temporary-files folder for the change pictures
    out_dir.mkdir(exist_ok=True)  # Create it (no error if it already exists)

    results = []  # One row per candidate, filled in below
    start = time.perf_counter()  # Note the start time, to report the total time at the end
    for cid, name, lat, lon, kind in candidates:  # Go through the candidates one by one
        print(f"{name} (expecting {kind})...")  # Say which one we're on
        try:  # Reading data over the internet can fail; one failure shouldn't stop the whole run
            best = best_square(name, lat, lon, kind)  # Find its best square
        except Exception as error:  # Anything went wrong:
            print(f"  {name}: failed ({error})")  # report it
            continue  # and move on to the next candidate
        if best is None:  # No data at all:
            continue  # skip it
        (out_dir / f"{cid}.png").write_bytes(change_image.make_png(best["change"]))  # Save its change picture, to look at with our own eyes
        results.append((cid, name, kind, best))  # Remember the result

    # The table: sorted by kind of change, then by hectares of that kind, biggest first
    results.sort(key=lambda r: (r[2], -r[3]["stats"][r[2]]))  # "lambda" = a tiny unnamed function; here it says what to sort by
    print()  # An empty line before the table
    print(f"{'id':<16} {'kind':<8} {'score':>7} {'built':>7} {'cleared':>8} {'gained':>7} {'water':>7} {'no data':>8}  {'years':<10} best square (lat, lon)")  # Column headings; "<16" = left-aligned in 16 characters, ">7" = right-aligned in 7
    for cid, name, kind, best in results:  # One line per candidate
        s = best["stats"]  # Its stats, in hectares
        print(  # Print the row:
            f"{cid:<16} {kind:<8} {s[kind]:>7.1f} {s['built']:>7.1f} {s['cleared']:>8.1f} {s['gained']:>7.1f} {s['water']:>7.1f} {s['no_data']:>8.1f}"  # the numbers, 1 decimal place
            f"  {best['years'][0]}-{best['years'][1]}  {best['lat']:.4f}, {best['lon']:.4f}"  # the years and the best square's center
        )  # End of the row
    print()  # An empty line after the table
    print(f"Change pictures saved in: {out_dir}")  # Where to find the pictures
    print(f"Total time: {time.perf_counter() - start:.0f} s")  # How long the whole run took


if __name__ == "__main__":  # Only run main() when this file is run directly (not when another file imports it)
    main()  # Start
