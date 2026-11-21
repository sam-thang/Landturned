# The Landturn backend: a small web API built with FastAPI.

from concurrent.futures import ThreadPoolExecutor  # Built into Python; runs several downloads at the same time
import threading  # Built into Python; runs the land-cover year check in the background when the server starts
from typing import Annotated  # Lets us attach extra rules to a function input (like "must be between -90 and 90")

# Bring in FastAPI, the library that turns Python functions into web addresses,
# HTTPException (for sending back an error answer) and Query (rules for ?name=value inputs in the address)
from fastapi import FastAPI, HTTPException, Query

from app import change_image, imagery, landcover, wayback  # Our own code: the change picture, the satellite photo, the land-cover data, and Esri's imagery archive

# Create the app. The title is shown on FastAPI's automatic documentation page (at /docs).
app = FastAPI(title="Landturn backend")

# Check which land-cover years exist (is a newer year than the newest known one published yet?) as soon as the server starts,
# in the background, so the first visitor doesn't wait for it. "daemon=True": this helper never keeps the server from stopping.
threading.Thread(target=landcover.newest_year, daemon=True).start()


# The line starting with "@" is a "decorator": it tells FastAPI to run the function below
# whenever someone asks for the address /api/health with a GET request (a normal "please give me" request).
@app.get("/api/health")
def health() -> dict:  # "-> dict" notes that this function hands back a dictionary (named values)
    return {"status": "ok"}  # Answer with a small dictionary; FastAPI turns it into JSON: {"status": "ok"}


# The change between the first and latest year, for the 2 x 2 km square around a point.
# Example: /api/change?lat=33.96&lon=-117.55
# This is a plain "def" (not "async def"), so FastAPI runs it in a separate worker thread:
# while it waits a few seconds for the map data, the server can still answer other requests.
@app.get("/api/change")
def change(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90 (ge = greater or equal, le = less or equal); FastAPI rejects anything else with a clear error
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    files_by_year = landcover.find_files_by_year(lon, lat)  # The land-cover map files for this point, by year (worked out from its coordinates; no catalog search)
    if not files_by_year:  # No maps found (e.g. far out at sea)?
        raise HTTPException(status_code=404, detail="No land-cover data for this location.")  # Answer with error 404 ("not found") and a message
    years = list(files_by_year)  # The available years, oldest first
    first, latest = years[0], years[-1]  # Compare the oldest with the newest

    data_before, _ = landcover.read_square(files_by_year[first], lon, lat)  # Read the first year's square ("_" = we don't need its corners)
    data_after, corners = landcover.read_square(files_by_year[latest], lon, lat)  # Read the latest year's square, and keep its corners
    before = landcover.to_categories(data_before)  # Translate into our six categories
    after = landcover.to_categories(data_after)  # Same for the latest year
    return change_answer(lat, lon, years, first, latest, before, after, corners)  # Build the answer (shared with /api/timeline)


def change_answer(lat, lon, years, first, last, before, after, corners):
    """The answer for one comparison (first year -> last year), as /api/change sends it. /api/timeline sends a list of
    these, built by this same function, so the two can never disagree about a number."""
    change_grid = landcover.compare(before, after)  # One change code per pixel
    return {  # The answer, which FastAPI turns into JSON:
        "location": {"lat": lat, "lon": lon},  # The point we were asked about
        "years": {"from": first, "to": last, "available": years},  # Which years we compared, and all years there are
        "stats_ha": landcover.summarize(before, after, change_grid),  # The stats, in hectares
        "image": {  # The change picture for the map:
            "url": change_image.to_data_url(change_image.make_png(change_grid)),  # The PNG, written as a data URL
            "corners": corners,  # Its four corners as [longitude, latitude]: top-left, top-right, bottom-right, bottom-left
        },  # End of the image
        "source": "Impact Observatory annual land cover, 10 m (AWS Open Data, CC BY 4.0)",  # Where the data comes from, for the title block
    }  # End of the answer


# Every comparison from the first year to each later year (2017 -> 2018, 2017 -> 2019, ... 2017 -> 2023), for the year slider.
# Example: /api/timeline?lat=33.96&lon=-117.55
# All the yearly squares are read side by side (at the same time), so it takes about as long as one /api/change.
@app.get("/api/timeline")
def timeline(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    files_by_year = landcover.find_files_by_year(lon, lat)  # The land-cover map files for this point, by year (worked out from its coordinates; no catalog search)
    if not files_by_year:  # No maps found (e.g. far out at sea)?
        raise HTTPException(status_code=404, detail="No land-cover data for this location.")  # Answer with error 404 and a message
    years = list(files_by_year)  # The available years, oldest first
    if len(years) < 2:  # Only one year: nothing to compare
        raise HTTPException(status_code=404, detail="Only one year of land-cover data for this location.")  # Say so

    with ThreadPoolExecutor(max_workers=len(years)) as pool:  # One helper per year, so all the reads happen at the same time
        reads = list(pool.map(lambda year: landcover.read_square(files_by_year[year], lon, lat), years))  # (data, corners) for each year, oldest first
    grids = {year: landcover.to_categories(data) for year, (data, _) in zip(years, reads)}  # Each year's square in our six categories
    corners = reads[-1][1]  # The square's corners (the same in every year: same grid)
    first = years[0]  # The start of every comparison

    return {  # The answer:
        "years": {"from": first, "available": years},  # The start year and every year there is
        "changes": [  # One /api/change-style answer per later year, oldest first
            change_answer(lat, lon, years, first, year, grids[first], grids[year], corners) for year in years[1:]  # first -> each later year
        ],  # End of the list
    }  # End of the answer


# Sharp satellite imagery for the first and the last land-cover year, from Esri's archive ("Wayback"): the "before" and
# "after" imagery for the map. Example: /api/wayback?lat=33.9785&lon=-117.5962
# The first answer for a place can take up to a minute (Esri's archive services are slow to wake up); it is saved on disk,
# so every later answer for the same place is instant.
@app.get("/api/wayback")
def wayback_imagery(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
    first: Annotated[int | None, Query(alias="from", ge=2015, le=2100, description="The first land-cover year, if known")] = None,  # Optional: the app already knows the years ("alias" lets the address say "from", which is a reserved word in Python)
    last: Annotated[int | None, Query(alias="to", ge=2015, le=2100, description="The last land-cover year, if known")] = None,  # Optional, likewise
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    if first is None or last is None:  # The years weren't given:
        files_by_year = landcover.find_files_by_year(lon, lat)  # Work them out (instant once the grid zone has been checked)
        if not files_by_year:  # None here:
            raise HTTPException(status_code=404, detail="No land-cover data for this location.")  # Nothing to match
        years = list(files_by_year)  # Oldest first
        first, last = years[0], years[-1]  # The first and the last year
    photos = wayback.before_after(lat, lon, first, last)  # The two photos (or None for each); saved per map tile, so neighbours share
    return {"years": {"from": first, "to": last}, **photos}  # e.g. {"years": {...}, "before": {...}, "after": {...}}


# The Sentinel-2 photo of the 2 x 2 km square for one year, on the same pixel grid as the land-cover data.
# Example: /api/imagery?lat=33.9785&lon=-117.5962&year=2017
# A plain "def" again: reading the images takes a few seconds, and FastAPI runs it in a worker thread meanwhile.
@app.get("/api/imagery")
def imagery_photo(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
    year: Annotated[int | None, Query(ge=2015, le=2100, description="The year of the photo; leave out for the latest land-cover year")] = None,  # Sentinel-2 started in 2015; "None" = not given
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    try:  # Try to make the photo...
        if year is None:  # No year given (the app's first request, before it knows the years):
            maps = landcover.find_files_by_year(lon, lat)  # The land-cover maps for the point
            if not maps:  # None here:
                raise LookupError("No land-cover data for this location.")  # Nothing to match
            year = max(maps)  # The latest year with a land-cover map, so the photo matches the "after" year of the change
        return imagery.square_photo(round(lat, 5), round(lon, 5), year)  # Rounded to about 1 m, so the memory (cache) recognises the same place asked twice
    except LookupError as error:  # ...but if there's no data or no usable image:
        raise HTTPException(status_code=404, detail=str(error)) from error  # Answer with 404 ("not found") and the reason
