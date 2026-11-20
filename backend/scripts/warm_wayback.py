# Warm-up script: find and save the sharp "before" and "after" archive imagery for every hotspot in advance,
# so the places most visitors click show it instantly. It is not part of the app. Run it from the backend folder with:
#   uv run python -m scripts.warm_wayback
# Run it again whenever frontend/src/places.js or the land-cover years change. Places already saved are skipped quickly.

import re  # Built into Python; "regular expressions" find text patterns, here the places in places.js
import time  # Built into Python; time.perf_counter measures how long things take
from concurrent.futures import ThreadPoolExecutor  # Built into Python; works on a few places at the same time
from pathlib import Path  # Built into Python; a handy way to build file paths

from app import landcover, wayback  # Our own code: the land-cover years and the archive imagery

PLACES_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "places.js"  # The hotspot list the app uses
PARALLEL = 3  # How many places at once: quicker than one by one, gentler on Esri than all at once
# One place in places.js looks like: { id: 'gerd', name: 'Renaissance Dam, Ethiopia', lon: 35.093, lat: 11.2015, ... }
PLACE_PATTERN = re.compile(r"id: '([^']+)', name: '([^']+)', lon: (-?[\d.]+), lat: (-?[\d.]+)")  # Finds id, name, lon and lat


def read_places():
    """The hotspots from places.js, as (id, name, lat, lon)."""
    text = PLACES_FILE.read_text(encoding="utf-8")  # The whole file
    return [(pid, name, float(lat), float(lon)) for pid, name, lon, lat in PLACE_PATTERN.findall(text)]  # Every match, with numbers turned into numbers


def warm(place):
    """Find and save one place's before/after imagery. Returns a line for the table."""
    pid, name, lat, lon = place  # Take the place apart
    start = time.perf_counter()  # Note the start time
    years = list(landcover.find_items_by_year(lon, lat))  # Its land-cover years, oldest first (the app's request uses the same years)
    if not years:  # No land-cover data (shouldn't happen for a hotspot):
        return f"{pid:<15} no land-cover data"  # Say so
    photos = wayback.before_after(round(lat, 5), round(lon, 5), years[0], years[-1])  # Find and save (or read back) the two photos
    show = lambda p: f"{p['date']} ({p['source']}, {p['resolution_m']} m)" if p else "none"  # How to print one photo
    return f"{pid:<15} {time.perf_counter() - start:5.1f} s   before {show(photos['before']):<40} after {show(photos['after'])}"  # The table row


def main():
    """Warm every hotspot, a few at a time, and print a table."""
    places = read_places()  # The hotspots
    print(f"Warming the archive imagery for {len(places)} hotspots, {PARALLEL} at a time...")  # Say what's happening
    start = time.perf_counter()  # Note the start time
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:  # A few helpers
        for line in pool.map(warm, places):  # Each place's result, in list order
            print(line)  # Print it as soon as it's ready
    print(f"Done in {time.perf_counter() - start:.0f} s. Saved in {wayback.CACHE_DIR}")  # Where the answers are


if __name__ == "__main__":  # Only run main() when this file is run directly
    main()  # Start
