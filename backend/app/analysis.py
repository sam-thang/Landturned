# The whole land-cover analysis of one place in one go: the main result (first year -> newest year) and every comparison
# the year slider needs (first year -> each later year). All years are read side by side, and the finished answer is saved
# on disk for good, so the same square never has to be read again.

import json  # Built into Python; writes and reads the saved answers
from concurrent.futures import ThreadPoolExecutor  # Built into Python; reads all the years at the same time
from pathlib import Path  # Built into Python; a handy way to build file paths

from app import change_image, landcover  # Our own code: the change picture and the land-cover data

# Saved answers, one small JSON file per square: generated data, not code (the cache folder is listed in .gitignore).
CACHE_DIR = Path(__file__).resolve().parents[1] / "cache" / "landcover"  # backend/cache/landcover
SOURCE = "Impact Observatory annual land cover, 10 m (AWS Open Data, CC BY 4.0)"  # Where the data comes from, for the title block


def comparison(years, first, last, before, after, corners):
    """One comparison (first year -> last year) as the app uses it: years, stats in hectares, and the change picture.
    The main result and every slider year are built by this same function, so they can never disagree about a number."""
    change_grid = landcover.compare(before, after)  # One change code per pixel (with the 30 m edge cleaning)
    return {  # The comparison, ready for JSON:
        "years": {"from": first, "to": last, "available": years},  # Which years are compared, and all years there are
        "stats_ha": landcover.summarize(before, after, change_grid),  # The stats, in hectares
        "image": {  # The change picture for the map:
            "url": change_image.to_data_url(change_image.make_png(change_grid)),  # The PNG, written as a data URL
            "corners": corners,  # Its four corners as [longitude, latitude]: top-left, top-right, bottom-right, bottom-left
        },  # End of the image
        "source": SOURCE,  # Where the data comes from
    }  # End of the comparison


def compute(files_by_year, lon, lat):
    """Read every year's square at the same time and build every comparison from the first year. The slow part (about
    1-2 seconds: one small read per year over the internet)."""
    years = list(files_by_year)  # Every year, oldest first, e.g. [2017, ..., 2024]
    with ThreadPoolExecutor(max_workers=len(years)) as pool:  # One helper per year, so all the reads happen at the same time
        reads = list(pool.map(lambda year: landcover.read_square(files_by_year[year], lon, lat), years))  # (data, corners) per year, oldest first
    grids = {year: landcover.to_categories(data) for year, (data, _) in zip(years, reads)}  # Each year in our six categories
    corners = reads[-1][1]  # The square's corners (the same in every year: same grid)
    first = years[0]  # The start of every comparison
    return {  # The whole answer:
        "years": {"from": first, "to": years[-1], "available": years},  # The years: start, newest, and all of them
        "changes": [comparison(years, first, year, grids[first], grids[year], corners) for year in years[1:]],  # First -> each later year, oldest first; the last one is the main result
    }  # End of the answer


def analyse(lat, lon):
    """The analysis of the 2 x 2 km square around a point: {years, changes, location}, where changes[-1] is the main result
    (first year -> newest year). Read from the disk cache when this square was analysed before (by anyone).
    Raises LookupError when there is no land-cover data here (or only one year)."""
    files = landcover.find_files_by_year(lon, lat)  # The land-cover files for this point, by year
    if len(files) < 2:  # None (e.g. open ocean), or a single year: nothing to compare
        raise LookupError("No land-cover data to compare for this location.")  # The API turns this into a 404
    years = list(files)  # Oldest first
    # The cache key: the square's exact position on the land-cover grid, plus the years compared. Addresses whose squares snap
    # to the same 10 m pixels share one file; a new data year changes the key, so its answer is made fresh.
    zone, column, row = landcover.square_position(lon, lat, files[years[-1]])  # e.g. ("11S", 37112, 40381)
    path = CACHE_DIR / f"{zone}_c{column}_r{row}_{years[0]}_{years[-1]}.json"  # e.g. "11S_c37112_r40381_2017_2024.json"
    if path.exists():  # Analysed before:
        answer = json.loads(path.read_text(encoding="utf-8"))  # Read it back: no land-cover file is opened at all
    else:  # New square:
        answer = compute(files, lon, lat)  # Read and compare (about 1-2 s)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Create the folder the first time
        temporary = path.with_name(path.name + f".{id(answer)}.tmp")  # Write under a temporary name first (unique per request, so two at once don't collide)...
        temporary.write_text(json.dumps(answer), encoding="utf-8")  # ...the whole answer...
        temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read
    return {**answer, "location": {"lat": lat, "lon": lon}}  # Add the point asked about (not saved: neighbours share the file)
