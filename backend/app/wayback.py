# Esri World Imagery "Wayback": the archive of every earlier version of Esri's satellite map (since 2014).
# For the map's "before" and "after" imagery, this module finds, for one place, the sharp photo the archive has shown there
# closest to the first land-cover year and to the last one, with the date each photo was taken.

import json  # Built into Python; reads the archive list and writes the saved answers
import math  # Built into Python; math.tan, math.asinh and math.pi, for working out which map tile holds the point
import threading  # Built into Python; a "lock" so parallel requests take turns checking which lookups are running
import time  # Built into Python; time.time() tells how old the remembered archive list is
import urllib.parse  # Built into Python; builds the "?name=value" part of a web address safely
import urllib.request  # Built into Python; downloads from the internet
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait  # Built into Python; asks many questions at the same time, "Future" = an answer box to wait on, and "wait" waits for some of them
from datetime import date  # Built into Python; dates we can subtract to measure how far apart they are
from pathlib import Path  # Built into Python; a handy way to build file paths

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
HEADERS = {"User-Agent": "Landturn (portfolio project)"}  # A polite name for our requests
CACHE_DIR = Path(__file__).resolve().parents[1] / "cache" / "wayback"  # backend/cache/wayback (ignored by git, like the other cache)

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


# Most archive versions say when their photo was taken within about a second, but one or two "sleepy" ones can take
# 10-15 s. So a request gets a quick answer this long after the questions start: the closest photo among the answers so
# far (every date is still real). The full lookup carries on in the background and saves the best answer for next time.
QUICK_S = 5

# The lookups running right now, one per saved-answer file: {path: {"quick": Future, "full": Future}}. A "Future" is a box
# for an answer that isn't ready yet: the lookup puts the answer in, and anyone can wait for it with .result().
_running = {}
_running_lock = threading.Lock()  # Only one request at a time may check or change _running (requests run in parallel threads)
_background = ThreadPoolExecutor(max_workers=8)  # Helpers that run the lookups, so they can finish after the request has its quick answer


def before_after(lat, lon, first_year, last_year, quick=True):
    """The sharp photo closest to the first year ("before") and to the last year ("after"), each as
    {date, resolution_m, source, version, tiles}, or None when no dated photo was found. Saved on disk per map tile.
    For a tile not seen before, quick=True answers after about QUICK_S seconds of asking (see QUICK_S); quick=False waits
    for the full answer (the warm-up script). If the same tile is already being looked up (e.g. the app's head start
    before "Analyse this area" is pressed), this waits for that lookup instead of asking Esri all over again."""
    row, column = tile_at(lat, lon, TILE_ZOOM)  # The archive answers per map tile (about 600 m across), so save per tile:
    path = CACHE_DIR / f"z{TILE_ZOOM}_{row}_{column}_{first_year}_{last_year}.json"  # every address in the same tile reuses this file (rarely, a photo boundary crosses a tile; then a neighbour's real, dated photo is used)
    if path.exists():  # Found before:
        return json.loads(path.read_text(encoding="utf-8"))  # Read it back: no need to ask Esri at all

    with _running_lock:  # Check and claim in one go, so two requests can't both start a lookup
        boxes = _running.get(path)  # A lookup of this tile that's already running, or None
        if boxes is None:  # None running: start one
            boxes = _running[path] = {"quick": Future(), "full": Future()}  # Two empty answer boxes that requests can wait on
            _background.submit(run_lookup, lat, lon, first_year, last_year, path, boxes)  # A background helper does the lookup
    return boxes["quick" if quick else "full"].result()  # Wait for the answer we want (if the lookup failed, this raises its error)


def run_lookup(lat, lon, first_year, last_year, path, boxes):
    """Runs in the background: the whole lookup, filling both answer boxes (or both with the error if it fails)."""
    try:  # Always fill the boxes, even if it fails
        result = look_up(lat, lon, first_year, last_year, path, boxes["quick"])  # Ask Esri (fills the quick box on the way)
        boxes["full"].set_result(result)  # The full answer
        if not boxes["quick"].done():  # Every answer came in before QUICK_S:
            boxes["quick"].set_result(result)  # then the quick answer is the full one
    except Exception as error:  # It failed:
        for box in boxes.values():  # Each box...
            if not box.done():  # ...that's still empty...
                box.set_exception(error)  # ...gets the error, so waiting requests don't wait for ever
    finally:  # Either way, at the end:
        with _running_lock:  # (one request at a time)
            _running.pop(path, None)  # This lookup no longer runs (the saved file answers from now on)


def close_enough(photo, year):
    """Whether a photo (or None) was taken within a year of the middle of the year (1 July), so it can stand for that year."""
    return photo is not None and abs((date.fromisoformat(photo["date"]) - date(year, 7, 1)).days) <= 365  # Subtracting dates gives the days between


def choose(answers, wanted, first_year, last_year):
    """From the photo dates answered so far ({version id: photo or None}), the closest photo per moment, or None."""
    result = {}  # "before" and "after"
    for moment, year in [("before", first_year), ("after", last_year)]:  # Each moment and its year
        photos = [{**answers[v["id"]], "version": v["date"], "tiles": v["tiles"]} for v in wanted[moment] if answers.get(v["id"])]  # Its dated photos so far, each with the version that shows it ("**" copies the photo's fields in; .get = None if not answered yet)
        result[moment] = photo_for_year(photos, year) if photos else None  # The closest one, or None
    return result  # Hand back both


def look_up(lat, lon, first_year, last_year, path, quick_box):
    """The actual lookup for before_after: the two walks, then the photo dates; saves the full answer in "path".
    Puts a quick answer in "quick_box" about QUICK_S seconds after the photo-date questions start."""
    with ThreadPoolExecutor(max_workers=2) as pool:  # Two helpers, so the two walks run at the same time
        walks = pool.map(lambda year: changed_versions(lat, lon, year), [first_year, last_year])  # One walk per year
        changed_first, changed_last = [sorted(walk, key=lambda v: v["date"]) for walk in walks]  # Each walk's changes, oldest first
    wanted = {"before": versions_near(changed_first, first_year), "after": versions_near(changed_last, last_year)}  # The few versions worth asking, per moment
    to_ask = list({v["id"]: v for group in wanted.values() for v in group}.values())  # Each version once (a dict keyed by id removes repeats)

    answers = {}  # version id -> its photo (or None), filled in as the answers arrive
    quick_at = time.time() + QUICK_S  # When the quick answer is due
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:  # Many helpers, so the questions overlap
        jobs = {pool.submit(photo_in, v, lat, lon): v for v in to_ask}  # Ask every version at once; each "job" is a Future for its answer
        pending = set(jobs)  # The questions not answered yet
        while pending:  # Until every version has answered:
            due = quick_box.done() or time.time() >= quick_at  # Is the quick answer's moment past (or already handled)?
            wait_s = None if due else quick_at - time.time()  # Wait for the next answer, but not past that moment (None = no limit: just the next answer)
            done, pending = wait(pending, timeout=wait_s, return_when=FIRST_COMPLETED)  # The answers that came in meanwhile, and the rest
            for job in done:  # Each new answer:
                answers[jobs[job]["id"]] = job.result()  # Note it (photo_in never fails: a failure is None)
            if not quick_box.done() and time.time() >= quick_at:  # The quick answer is due:
                quick = choose(answers, wanted, first_year, last_year)  # The closest photos so far
                still_asking = {jobs[job]["id"] for job in pending}  # The versions that haven't answered
                years = {"before": first_year, "after": last_year}  # Each moment's year
                # Good enough when each moment has a photo within a year of its year's middle, or none of its versions are
                # left to answer (so waiting can't help). Otherwise e.g. an October 2018 photo could stand in for "2017".
                if all(close_enough(quick[m], years[m]) or not any(v["id"] in still_asking for v in wanted[m]) for m in years):
                    quick_box.set_result(quick)  # Hand it to the waiting requests (not saved: the full answer below is)

    result = choose(answers, wanted, first_year, last_year)  # The full answer: the closest photos among all
    if result["before"] or result["after"]:  # Only save a real answer
        CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Create the folder the first time
        temporary = path.with_suffix(".tmp")  # Write under a temporary name first...
        temporary.write_text(json.dumps(result), encoding="utf-8")  # ...the whole answer...
        temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read
    return result  # Hand back both
