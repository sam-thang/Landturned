# The Landturned backend: a small web API built with FastAPI.

import os  # Built into Python; reads settings ("environment variables"), such as where the built website is
import threading  # Built into Python; runs the land-cover year check in the background when the server starts
from pathlib import Path  # Built into Python; a handy way to build file paths
from typing import Annotated  # Lets us attach extra rules to a function input (like "must be between -90 and 90")

# Bring in FastAPI, the library that turns Python functions into web addresses,
# HTTPException (for sending back an error answer) and Query (rules for ?name=value inputs in the address)
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware  # Compresses replies (like zipping a file) so they travel faster
from fastapi.staticfiles import StaticFiles  # Hands out ready-made files (the built website) as they are

from app import analysis, geocoding, imagery, landcover, wayback  # Our own code: the land-cover analysis, the address search, the satellite photo, the land-cover data, and Esri's imagery archive

# Create the app. The title is shown on FastAPI's automatic documentation page (at /docs).
app = FastAPI(title="Landturned backend")
# Compress every reply bigger than 1,000 bytes for browsers that accept it (all modern ones do). The website's code
# shrinks from about 1.8 MB to about 0.7 MB, and the analysis answers shrink too.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Check which land-cover years exist (is a newer year than the newest known one published yet?) as soon as the server starts,
# in the background, so the first visitor doesn't wait for it. "daemon=True": this helper never keeps the server from stopping.
threading.Thread(target=landcover.newest_year, daemon=True).start()


# The line starting with "@" is a "decorator": it tells FastAPI to run the function below
# whenever someone asks for the address /api/health with a GET request (a normal "please give me" request).
@app.get("/api/health")
def health() -> dict:  # "-> dict" notes that this function hands back a dictionary (named values)
    return {"status": "ok"}  # Answer with a small dictionary; FastAPI turns it into JSON: {"status": "ok"}


# The years the app compares: the dataset's first year and the newest published year, from the same setting and the same
# check every analysis uses. The "How this works" page shows these, so it always matches the data.
# Answer: {"first": 2017, "latest": 2024}
@app.get("/api/years")
def years() -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    return {"first": landcover.FIRST_YEAR, "latest": landcover.newest_year()}  # The first year, and the newest year with files


# Address search, through Geoapify (see geocoding.py). Example: /api/search?q=Fontana, California
# Answer: {"found": true, "lat": 34.09, "lon": -117.43, "name": "Fontana, CA, ..."} or {"found": false}.
# Errors: 503 with "busy" (too many searches right now), "daily-limit" (today's allowance used up) or "unavailable".
@app.get("/api/search")
def search_route(
    q: Annotated[str, Query(min_length=1, max_length=200, description="The address to look up")],  # The typed address: 1 to 200 characters
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    try:  # Try to look it up...
        found = geocoding.search(q)  # The best match, or None
    except (geocoding.GeocodingBusy, geocoding.GeocodingUnavailable) as error:  # ...but search can't be used right now:
        raise HTTPException(status_code=503, detail=str(error)) from error  # Answer 503 ("service unavailable") with the reason
    if found is None:  # Nothing matched:
        return {"found": False}  # Say so
    return {"found": True, **found}  # "**found" copies its lat, lon and name into the answer


# The town or city at a point (for a tapped spot or an analysed area). Example: /api/place-name?lat=34.09&lon=-117.43
# Answer: {"name": "Fontana"}, or {"name": null} where there's no town (open sea, desert). Errors as /api/search.
@app.get("/api/place-name")
def place_name_route(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    try:  # Try to look it up...
        return {"name": geocoding.place_name(lat, lon)}  # The town's name, or None
    except (geocoding.GeocodingBusy, geocoding.GeocodingUnavailable) as error:  # ...but it can't be used right now:
        raise HTTPException(status_code=503, detail=str(error)) from error  # Answer 503 with the reason


# The land-cover analysis of the 2 x 2 km square around a point, in one request: the main result (first year -> newest year)
# and every comparison the year slider needs (first year -> each later year), so the slider works as soon as the result shows.
# Example: /api/analysis?lat=33.96&lon=-117.55
# Answer: { years: {from, to, available}, changes: [one comparison per later year, oldest first; the last is the main result],
#           location: {lat, lon} }. Saved on disk per square, so a square analysed before (by anyone) answers at once.
# This is a plain "def" (not "async def"), so FastAPI runs it in a separate worker thread:
# while it waits for the map data, the server can still answer other requests.
@app.get("/api/analysis")
def analysis_route(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90 (ge = greater or equal, le = less or equal); FastAPI rejects anything else with a clear error
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    try:  # Try to analyse...
        return analysis.analyse(lat, lon)  # Read (or look up) every comparison (see analysis.py)
    except LookupError as error:  # ...but if there's no land-cover data to compare here (e.g. far out at sea):
        raise HTTPException(status_code=404, detail=str(error)) from error  # Answer with error 404 ("not found") and the reason


# The sharp archive photo closest to the first land-cover year, from Esri's archive ("Wayback"): the earlier ("before")
# photo of the before/after swipe (the "after" photo is Esri's current imagery). Example: /api/wayback?lat=33.9785&lon=-117.5962
# The first answer for an area takes a few seconds (Esri's archive services can be slow); it is saved on disk per zoom-14
# map tile, so every later answer there (also for neighbouring squares) is instant.
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
    photo = wayback.before_photo(lat, lon, first)  # The earlier photo (or None); saved per zoom-14 map tile, so neighbours share
    return {"years": {"from": first, "to": last}, "before": photo}  # e.g. {"years": {...}, "before": {date, tiles, ...}} (the "after" photo is Esri's current imagery)


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


# The website itself. In production (on Render), this same server also hands out the built site ("npm run build" puts it
# in frontend/dist), so the site and its /api share one address. This comes last, after every /api route, so the API
# always wins. During development the site comes from Vite (npm run dev) instead: if there's no built site, nothing
# changes. FRONTEND_DIST can point somewhere else; by default it's frontend/dist next to the backend folder.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))  # Where the built site is
if (FRONTEND_DIST / "index.html").exists():  # A built site is there:
    # Serve it at "/". html=True: a folder address gets its index.html, so "/" is the app and "/how/" is "How this works".
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="site")
