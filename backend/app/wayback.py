# Esri World Imagery "Wayback": the archive of every earlier version of Esri's satellite map (since 2014).
# For the before/after swipe's earlier ("before") photo, this module finds, for one place, the sharp photo the archive has
# shown there closest to the first land-cover year, with the date it was taken. (The "after" photo is Esri's current imagery.)

import json  # Built into Python; reads the archive list and writes the saved answers
import math  # Built into Python; math.tan, math.asinh and math.pi, for working out which map tile holds the point
import threading  # Built into Python; a "lock" so parallel requests take turns checking which lookups are running
import time  # Built into Python; time.time() tells how old the remembered archive list is
import urllib.parse  # Built into Python; builds the "?name=value" part of a web address safely
import urllib.request  # Built into Python; downloads from the internet
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait  # Built into Python; asks many questions at the same time, "Future" = an answer box to wait on, and "wait" waits for some of them
from datetime import date  # Built into Python; dates we can subtract to measure how far apart they are

from app import settings  # Our own code: where saved answers live

# ---------- Settings ----------

# Esri's list of every archive version: its date, its map-tile address, and the address of its photo metadata
CONFIG_URL = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
CONFIG_MAX_AGE_S = 24 * 60 * 60  # Download the list again after a day (Esri adds a version every few weeks)
# Asking every version's metadata took 2.5-3 minutes per place, and sampling a few versions missed photos. Instead we use
# Esri's "tilemap" lookup, which tells for one map tile in which version it last changed: stepping back through those
# answers lists only the versions where this place got new imagery, and only those are asked for details.
# Each step waits for the one before (~0.6 s each), so we only step through the years we need: one short walk around the
# first year and one around the last year, side by side (one long walk from today back to 2016 took ~19 s; this ~6 s).
TILEMAP_URL = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap"  # The lookup's address
TILE_ZOOM = 16  # The map-tile zoom level we check (about what the result map shows)
WORKERS = 32  # How many versions to ask for details at the same time (the list is short, so usually all at once)
TIMEOUT_S = 30  # Some archive versions' metadata services take ~15 s to wake up: wait long enough not to lose their answer
# The "view" we describe to the metadata service, so it answers with the photo shown at our map's zoom:
VIEW_HALF_DEG = 0.009  # About 1 km each way: the 2 x 2 km square
VIEW_PIXELS = 800  # ...seen on about 800 screen pixels (roughly 2.5 m per screen pixel, like the result map)
HEADERS = {"User-Agent": "Landturned (portfolio project)"}  # A polite name for our requests
CACHE_DIR = settings.CACHE_ROOT / "wayback"  # backend/cache/wayback (or on the server's disk, see settings.py; ignored by git, like the other cache)

_config = {"loaded_at": 0, "versions": []}  # The remembered archive list ("_" = only for this module)


def versions():
    """Every archive version, oldest first, as dicts: {id, date, tiles, metadata}."""
    if time.time() - _config["loaded_at"] > CONFIG_MAX_AGE_S:  # Never loaded, or older than a day:
        with urllib.request.urlopen(urllib.request.Request(CONFIG_URL, headers=HEADERS), timeout=30) as answer:  # Download the list
            raw = json.load(answer)  # Read it: {id: {itemTitle, itemURL, metadataLayerUrl, ...}}
        found = []  # The versions
        for version_id, item in raw.items():  # Each version and its number
            found.append({  # Keep what we need:
                "id": int(version_id),  # Its number (not in date order!)
                "date": item["itemTitle"].split("Wayback ")[-1].rstrip(")"),  # "World Imagery (Wayback 2023-06-29)" -> "2023-06-29"
                "tiles": item["itemURL"].replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}"),  # Its tile address, in MapLibre's {z}/{y}/{x} spelling
                "metadata": item["metadataLayerUrl"],  # Where to ask about its photos
            })  # End of the version
        _config["versions"] = sorted(found, key=lambda v: v["date"])  # Oldest first (by date, since the numbers aren't in order)
        _config["loaded_at"] = time.time()  # Remember when
    return _config["versions"]  # Hand back the list


def tile_at(lat, lon, zoom):
    """The map tile (row, column) that holds the point at a zoom level: the standard web-map ("Web Mercator") tile grid."""
    n = 2 ** zoom  # The number of tiles across (and down) at this zoom
    column = int((lon + 180) / 360 * n)  # How far east, in tiles
    row = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)  # How far south, in tiles (the Mercator formula)
    return row, column  # Hand back both


def changed_versions(lat, lon, year):
    """The archive versions in which the map tile at the point changed (new imagery) that could hold a photo close to
    the year: the changes published from the start of the year to two years after it, plus the last one before that
    window (its photo was still showing when the window began). Newest first."""
    all_versions = versions()  # Oldest first
    by_id = {v["id"]: i for i, v in enumerate(all_versions)}  # Version number -> its position in the list
    row, column = tile_at(lat, lon, TILE_ZOOM)  # The tile to follow
    window_start, window_end = f"{year}-01-01", f"{year + 2}-12-31"  # The window, as text dates (they compare correctly in this format)
    found = []  # The versions where it changed
    published = [i for i, v in enumerate(all_versions) if v["date"] <= window_end]  # Positions of the versions out by the window's end
    i = published[-1] if published else -1  # Start at the last of them (-1 = none, so the loop below doesn't run)
    while i >= 0:  # Step back through time
        url = f"{TILEMAP_URL}/{all_versions[i]['id']}/{TILE_ZOOM}/{row}/{column}"  # "In this version, where does this tile's imagery come from?"
        try:  # Ask
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=TIMEOUT_S) as answer:  # A tiny answer
                select = json.load(answer).get("select")  # The version where the tile last changed (missing = this version itself)
        except Exception:  # No answer:
            break  # Stop looking further back; use what we have
        source = by_id.get(select[0] if select else all_versions[i]["id"])  # Its position in our list
        if source is None:  # A version we don't know:
            break  # Stop
        found.append(all_versions[source])  # The tile changed in this version
        if all_versions[source]["date"] < window_start:  # This change is the last one before the window:
            break  # That's all we need, stop
        i = source - 1  # Continue from the version just before that change
    return found  # Newest first


def number_or_none(value):
    """A metadata value as a number, or None when it's missing, zero, or not a number (Esri sometimes writes the text "Null")."""
    try:  # Try to read it as a number
        return float(value) or None  # "or None": 0 means unknown too
    except (TypeError, ValueError):  # Missing (None) or not a number (e.g. "Null"):
        return None  # Unknown


def photo_in_once(version, lat, lon):
    """Which photo this archive version shows at the point, at the result map's zoom: {date, resolution, source}, or None."""
    params = urllib.parse.urlencode({  # The question:
        "geometry": f"{lon},{lat}",  # The point (longitude first)
        "geometryType": "esriGeometryPoint",  # A single point
        "sr": "4326",  # In longitude/latitude
        "layers": "visible",  # Only the metadata for photos visible at the view's zoom (below)
        "tolerance": "0",  # Exactly at the point
        "mapExtent": f"{lon - VIEW_HALF_DEG},{lat - VIEW_HALF_DEG},{lon + VIEW_HALF_DEG},{lat + VIEW_HALF_DEG}",  # Our 2 km view...
        "imageDisplay": f"{VIEW_PIXELS},{VIEW_PIXELS},96",  # ...on about 800 screen pixels: this sets the zoom
        "returnGeometry": "false",  # We don't need the photo's outline
        "f": "json",  # Answer in JSON
    })  # End of the question
    try:  # One version failing shouldn't stop the others
        with urllib.request.urlopen(urllib.request.Request(f"{version['metadata']}/identify?{params}", headers=HEADERS), timeout=TIMEOUT_S) as answer:  # Ask (giving up after TIMEOUT_S)
            results = json.load(answer).get("results", [])  # The metadata of the photos found
    except Exception:  # No answer:
        return None  # Treat it as "unknown"
    for result in results:  # The first result with a capture date is the photo shown
        attrs = result.get("attributes", {})  # Its details
        raw = str(attrs.get("SRC_DATE", ""))  # e.g. "20230127"
        if len(raw) == 8 and raw.isdigit():  # A real date:
            return {  # What we keep about the photo:
                "date": f"{raw[:4]}-{raw[4:6]}-{raw[6:]}",  # "2023-01-27"
                "resolution_m": number_or_none(attrs.get("SRC_RES")),  # How sharp, in metres per pixel (e.g. 0.31), or None if unknown
                "source": attrs.get("NICE_DESC") or attrs.get("SRC_DESC") or "",  # Who took it, e.g. "Maxar"
            }  # End of the photo
    return None  # No dated photo here


def photo_in(version, lat, lon):
    """Like photo_in_once, but asks a second time if the first try gets no answer (slow archive services often answer then)."""
    return photo_in_once(version, lat, lon) or photo_in_once(version, lat, lon)  # "or" only asks again when the first answer is None


def photo_for_year(photos, year):
    """The photo whose capture date is closest to the middle of the year (1 July)."""
    middle = date(year, 7, 1)  # The middle of the year
    return min(photos, key=lambda p: abs((date.fromisoformat(p["date"]) - middle).days))  # The smallest distance in days wins


def versions_near(changed, year):
    """Of the versions where the imagery changed (oldest first), the ones that could hold a photo close to the year:
    those published from the start of the year to two years after it (archives lag behind the photos), plus the last
    one published before that window (its photo was still showing when the window began)."""
    start, end = f"{year}-01-01", f"{year + 2}-12-31"  # The window, as text dates (they compare correctly in this format)
    inside = [v for v in changed if start <= v["date"] <= end]  # Published inside the window
    before = [v for v in changed if v["date"] < start]  # Published before it
    return ([before[-1]] if before else []) + inside  # The last one before, then the ones inside


# ---------- The "before" photo (since speed-up phase 5 the only one looked up) ----------
# The app's "after" photo is always Esri's current imagery (it must be from the last land-cover year or later, and the
# archive only holds older versions), so only the earlier photo, for the before/after swipe, comes from the archive.

CACHE_ZOOM = 14  # Answers are saved per zoom-14 map tile (about 2.4 km at the equator, 2 km in California, 1.2 km in Norway),
# so neighbouring squares share one answer. The photo is the one Esri's archive shows where the first lookup in that tile
# was made; at a few spots a different patch of the photo mosaic shows at the exact centre, so its date can be slightly off.
GOOD_DAYS = 183  # A photo within half a year of 1 July is good enough to show at once (the lookup still finishes, and saves the best)
OK_DAYS = 365  # After LOOKUP_WAIT_S, a photo within a year of 1 July is still shown; a further one isn't: then every answer is waited for
# (with a 6 s cut-off for any photo, three hotspots got a photo 4-6 years off while a slow service held a much closer one)
LOOKUP_WAIT_S = 6  # After this long, use the closest photo answered so far if it's within OK_DAYS. Some archive services are "sleepy" (12-60 s, measured
# 2026-11-21) and which one is slow has nothing to do with which one holds the right photo, so asking the "likeliest" ones
# first didn't help; asking all candidates (only 4-6 since phase 5) at once and not waiting for the slow ones does

# The lookups running right now, one per saved-answer file: {path: Future}. A "Future" is a box for an answer that isn't
# ready yet: the lookup puts the answer in, and every request for the same tile waits for it with .result().
_running = {}
_running_lock = threading.Lock()  # Only one request at a time may check or change _running (requests run in parallel threads)
_background = ThreadPoolExecutor(max_workers=8)  # Helpers that run the lookups (a request just waits for the answer box)


def before_photo(lat, lon, year):
    """The sharp archive photo closest to the middle of the year (1 July), as {date, resolution_m, source, version, tiles},
    or None when no dated photo was found. Saved on disk per zoom-14 map tile, so neighbours share it. If the same tile is
    already being looked up (e.g. the app's head start before "Analyse this area" is pressed), this waits for that lookup."""
    row, column = tile_at(lat, lon, CACHE_ZOOM)  # The zoom-14 tile the point is in
    path = CACHE_DIR / f"z{CACHE_ZOOM}_{row}_{column}_{year}.json"  # e.g. "z14_3265_2853_2017.json"
    if path.exists():  # Found before (by anyone, anywhere in this tile):
        return json.loads(path.read_text(encoding="utf-8"))["before"]  # Read it back: no need to ask Esri at all
    with _running_lock:  # Check and claim in one go, so two requests can't both start a lookup
        future = _running.get(path)  # A lookup of this tile that's already running, or None
        if future is None:  # None running: start one
            future = _running[path] = Future()  # An empty answer box that requests can wait on
            _background.submit(run_lookup, lat, lon, year, path, future)  # A background helper does the lookup
    return future.result()  # Wait for the answer (if the lookup failed, this raises its error)


def run_lookup(lat, lon, year, path, future):
    """Runs in the background: the whole lookup. Waiting requests get an early answer as soon as a good-enough photo is in
    (see look_up); the lookup then carries on until every version has answered and saves the best photo of all, so
    everyone after that gets the best one. The questions are already sent, so finishing them costs Esri nothing extra."""
    def answer_early(photo):  # Called by look_up when a good-enough photo is in
        if not future.done():  # Only the first time
            future.set_result(photo)  # Hand it to everyone waiting
    try:  # Always fill the box, even if it fails
        photo = look_up(lat, lon, year, answer_early)  # Ask Esri; the best photo of all once every version has answered
        if photo:  # Only save a real answer
            CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Create the folder the first time
            temporary = path.with_suffix(".tmp")  # Write under a temporary name first...
            temporary.write_text(json.dumps({"before": photo}), encoding="utf-8")  # ...the answer...
            temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read
        answer_early(photo)  # If nobody got an answer yet (no early one), they get this one
    except Exception as error:  # It failed:
        if not future.done():  # Nobody got an answer yet:
            future.set_exception(error)  # Waiting requests get the error, so they don't wait for ever
    finally:  # Either way, at the end:
        with _running_lock:  # (one request at a time)
            _running.pop(path, None)  # This lookup no longer runs (the saved file answers from now on)


def days_from_middle(photo, year):
    """How many days a photo was taken from 1 July of the year (before or after)."""
    return abs((date.fromisoformat(photo["date"]) - date(year, 7, 1)).days)  # Subtracting dates gives the days between


def choose(answers, candidates, year):
    """From the photo dates answered so far ({version id: photo or None}), the photo closest to 1 July, or None."""
    photos = [{**answers[v["id"]], "version": v["date"], "tiles": v["tiles"]} for v in candidates if answers.get(v["id"])]  # The dated photos so far, each with the version that shows it ("**" copies the photo's fields in)
    return photo_for_year(photos, year) if photos else None  # The closest one, or None


def look_up(lat, lon, year, answer_early):
    """The actual lookup for before_photo: walk back through the archive versions where this place got new imagery around
    the year, then ask all of them at once when their photo was taken. As soon as a photo is good enough, answer_early(photo)
    is called (so the app can show it): the first one within half a year of 1 July, or after LOOKUP_WAIT_S the closest one so
    far if it's within a year. Then every answer is waited for, and the closest photo of all is handed back (to be saved)."""
    changed = sorted(changed_versions(lat, lon, year), key=lambda v: v["date"])  # Where the imagery changed around the year, oldest first
    candidates = versions_near(changed, year)  # The versions that could hold a photo close to the year (usually 4-6)
    answers = {}  # version id -> its photo (or None), filled in as the answers arrive
    deadline = time.time() + LOOKUP_WAIT_S  # When an answer within a year becomes good enough
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:  # Helpers, so all the questions run at the same time
        jobs = {pool.submit(photo_in, v, lat, lon): v for v in candidates}  # Ask every candidate at once
        pending = set(jobs)  # The questions not answered yet
        while pending:  # Until every candidate has answered (each question gives up after TIMEOUT_S, twice):
            past_deadline = time.time() >= deadline  # Has the first waiting time run out?
            timeout = None if past_deadline else deadline - time.time()  # Wait for the next answer, but not past the deadline (once past it, just the next answer)
            done, pending = wait(pending, timeout=timeout, return_when=FIRST_COMPLETED)  # The answers that came in meanwhile, and the rest
            for job in done:  # Each new answer:
                answers[jobs[job]["id"]] = job.result()  # Note it (photo_in never fails: a failure is None)
            best = choose(answers, candidates, year)  # The closest photo so far (or None)
            if best:  # There is one: is it good enough to show now?
                days = days_from_middle(best, year)  # How far from 1 July it was taken
                if days <= GOOD_DAYS or (time.time() >= deadline and days <= OK_DAYS):  # Within half a year, or within a year once the waiting time is over:
                    answer_early(best)  # Let the app show it (only the first call counts)
    return choose(answers, candidates, year)  # Every version has answered: the closest photo of all (or None)
