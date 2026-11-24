# The Landturned backend: a small web API built with FastAPI.

import json  # Built into Python; writes the long view's pieces as JSON text
import re  # Built into Python; makes safe file names for downloads
import os  # Built into Python; reads settings ("environment variables"), such as where the built website is
import threading  # Built into Python; runs the land-cover year check in the background when the server starts
from pathlib import Path  # Built into Python; a handy way to build file paths
from typing import Annotated  # Lets us attach extra rules to a function input (like "must be between -90 and 90")

# Bring in FastAPI, the library that turns Python functions into web addresses,
# HTTPException (for sending back an error answer) and Query (rules for ?name=value inputs in the address)
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware  # Compresses replies (like zipping a file) so they travel faster
from fastapi.responses import HTMLResponse, StreamingResponse  # A web page reply, and a reply sent piece by piece as each piece is ready (the long view)
from fastapi.staticfiles import StaticFiles  # Hands out ready-made files (the built website) as they are

from app import analysis, change_image, geocoding, landcover, longview, share, wayback  # Our own code: the land-cover analysis, data URLs (change_image), the address search, the land-cover data, the long view's Landsat photos, sharing pictures (share), and Esri's imagery archive

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


# The long view: one Landsat photo of the 15 x 15 km square around a place for each 5-year slot from 1985 to 2025.
# Photos only (nothing measured). Example: /api/longview?lat=34.0922&lon=-117.4350
# The first answer for an area takes about 15-25 s; the frames are saved on disk (nearby addresses within about 1 km
# share them), so every later answer is instant. A plain "def": FastAPI runs it in a worker thread while it waits.
# The answer is "streamed": sent piece by piece as each is ready, one line of JSON per piece ("NDJSON", newline-delimited
# JSON). First line: {"type": "head", centre, corners, slots}. Then one line per slot, in the order they're ready:
# {"type": "frame", slot, date, satellite, ..., image} (image is a data URL, or null when no photo was found).
# So the app can show real progress ("3 of 9") and the first photos while the rest are still being made.
@app.get("/api/longview")
def long_view_route(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> StreamingResponse:  # Hands back a reply that is sent piece by piece
    def lines():  # The reply's lines, one at a time (a generator, like long_view_parts)
        try:  # Make the pieces...
            parts = longview.long_view_parts(lat, lon)  # The long view's pieces, still to come (see longview.py)
            yield json.dumps({"type": "head", **next(parts)}) + "\n"  # The first piece: centre, corners, slots
            for record, jpeg in parts:  # Each frame as it's ready
                image = change_image.to_data_url(jpeg, "image/jpeg") if jpeg is not None else None  # The photo as a data URL, which the browser reads like an image link
                yield json.dumps({"type": "frame", **record, "image": image}) + "\n"  # One line per frame
        except Exception as error:  # ...but if something fails halfway (e.g. Planetary Computer is down), the reply has already started, so an error status can't be sent any more:
            yield json.dumps({"type": "error", "detail": str(error)}) + "\n"  # say so in a last line instead
    # "Content-Encoding: identity" (not compressed) keeps the compression step from holding lines back until it has
    # enough to squeeze; JPEG photos hardly compress anyway. FastAPI runs the generator in a worker thread.
    return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"Content-Encoding": "identity"})  # Send the lines as they come


# ---------- Sharing: downloads and link previews (see share.py) ----------

def file_name(name, ending):
    """A download's file name, e.g. "landturned-fontana-1985-2025.gif": letters and digits only, so every system accepts it."""
    slug = re.sub(r"[^a-z0-9]+", "-", (share.short_name(name) or "place").lower()).strip("-") or "place"  # "New Capital" -> "new-capital"
    return f"landturned-{slug}-{longview.SLOTS[0]}-{longview.SLOTS[-1]}.{ending}"  # The full name


# The long view as an animated GIF, downloaded as a file. Example: /api/longview/gif?lat=34.0922&lon=-117.435&name=Fontana
# "square=false" leaves the analysis square off (the long view's "Show on photo" switch). The photos are normally saved
# already (people download after watching), so this takes about a second.
@app.get("/api/longview/gif")
def long_view_gif_route(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
    name: Annotated[str | None, Query(max_length=120, description="The place's name, for the footer and file name")] = None,  # Optional
    square: bool = True,  # Draw the analysis square? ("true" or "false" in the address)
) -> Response:  # Hands back the file itself
    data = share.long_view_gif(lat, lon, name, square)  # Draw it (see share.py)
    return Response(data, media_type="image/gif", headers={"Content-Disposition": f'attachment; filename="{file_name(name, "gif")}"'})  # "attachment": the browser saves it as a file


# The long view as one picture: all nine years in a 3 x 3 grid under a title block (JPEG). Same settings as the GIF.
@app.get("/api/longview/sheet")
def long_view_sheet_route(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
    name: Annotated[str | None, Query(max_length=120, description="The place's name, for the heading and file name")] = None,  # Optional
    square: bool = True,  # Draw the analysis square?
) -> Response:  # Hands back the file itself
    data = share.long_view_sheet(lat, lon, name, square)  # Draw it (see share.py)
    return Response(data, media_type="image/jpeg", headers={"Content-Disposition": f'attachment; filename="{file_name(name, "jpg")}"'})  # Saved as a file


# The link-preview card (1200 x 630) that messaging apps and social sites show under a shared link: the site's own card,
# a result's card (?lat=...&lon=...&name=...), or a long view's (...&view=long). Apps may keep it for a day.
@app.get("/api/preview.jpg")
def preview_route(request: Request) -> Response:  # "request" gives us the address's settings as they are
    data = share.card_for(dict(request.query_params))  # The right card (see share.py; it checks the settings itself)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})  # Allowed to be kept for a day (86,400 s)


# The website itself. In production (on Render), this same server also hands out the built site ("npm run build" puts it
# in frontend/dist), so the site and its /api share one address. This comes last, after every /api route, so the API
# always wins. During development the site comes from Vite (npm run dev) instead: if there's no built site, nothing
# changes. FRONTEND_DIST can point somewhere else; by default it's frontend/dist next to the backend folder.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))  # Where the built site is
if (FRONTEND_DIST / "index.html").exists():  # A built site is there:
    INDEX_PAGE = (FRONTEND_DIST / "index.html").read_text(encoding="utf-8")  # The page's text, read once at start

    # The page itself ("/"), with link-preview tags for the place in its address (share.py), so a shared link shows that
    # place's card. Registered before the files below, so it wins for "/"; every other file is served as it is.
    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)  # GET, and HEAD (some link checkers only ask for the headers)
    def page_route(request: Request) -> HTMLResponse:  # Hands back the page as HTML
        return HTMLResponse(share.page_for(INDEX_PAGE, dict(request.query_params), str(request.base_url)))  # The page with its tags filled in

    # Serve it at "/". html=True: a folder address gets its index.html, so "/" is the app and "/how/" is "How this works".
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="site")
