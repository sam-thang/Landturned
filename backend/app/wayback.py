# Esri World Imagery "Wayback": the archive of every earlier version of Esri's satellite map (since 2014).
# For the map's "before" and "after" imagery, this module finds, for one place, the sharp photo the archive has shown there
# closest to the first land-cover year and to the last one, with the date each photo was taken.

import json  # Built into Python; reads the archive list and writes the saved answers
import math  # Built into Python; math.tan, math.asinh and math.pi, for working out which map tile holds the point
import time  # Built into Python; time.time() tells how old the remembered archive list is
import urllib.parse  # Built into Python; builds the "?name=value" part of a web address safely
import urllib.request  # Built into Python; downloads from the internet
from concurrent.futures import ThreadPoolExecutor  # Built into Python; asks many questions at the same time
from datetime import date  # Built into Python; dates we can subtract to measure how far apart they are
from pathlib import Path  # Built into Python; a handy way to build file paths

# ---------- Settings ----------

# Esri's list of every archive version: its date, its map-tile address, and the address of its photo metadata
CONFIG_URL = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
CONFIG_MAX_AGE_S = 24 * 60 * 60  # Download the list again after a day (Esri adds a version every few weeks)
FIRST_VERSION = "2016-06-01"  # Stop looking back at this date: older photos can't be closer to the slider's years (2017 on)
# Asking every version's metadata took 2.5-3 minutes per place, and sampling a few versions missed photos. Instead we use
# Esri's "tilemap" lookup, which tells for one map tile in which version it last changed: stepping back through those
# answers lists only the versions where this place got new imagery (about 5 seconds), and only those are asked for details.
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


def changed_versions(lat, lon):
    """The archive versions in which the map tile at the point changed (new imagery), newest first, back to FIRST_VERSION."""
    all_versions = versions()  # Oldest first
    by_id = {v["id"]: i for i, v in enumerate(all_versions)}  # Version number -> its position in the list
    row, column = tile_at(lat, lon, TILE_ZOOM)  # The tile to follow
    found = []  # The versions where it changed
    i = len(all_versions) - 1  # Start at the newest version
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
        if all_versions[source]["date"] < FIRST_VERSION:  # Far enough back:
            break  # Stop
        i = source - 1  # Continue from the version just before that change
    return found  # Newest first


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
                "resolution_m": float(attrs.get("SRC_RES") or 0) or None,  # How sharp, in metres per pixel (e.g. 0.31)
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


def before_after(lat, lon, first_year, last_year):
    """The sharp photo closest to the first year ("before") and to the last year ("after"), each as
    {date, resolution_m, source, version, tiles}, or None when no dated photo was found. Saved on disk per place."""
    path = CACHE_DIR / f"{lat:.5f}_{lon:.5f}_{first_year}_{last_year}.json"  # This place's file
    if path.exists():  # Found before:
        return json.loads(path.read_text(encoding="utf-8"))  # Read it back: no need to ask Esri at all

    changed = sorted(changed_versions(lat, lon), key=lambda v: v["date"])  # Where this place's imagery changed, oldest first
    wanted = {"before": versions_near(changed, first_year), "after": versions_near(changed, last_year)}  # The few versions worth asking, per moment
    to_ask = list({v["id"]: v for group in wanted.values() for v in group}.values())  # Each version once (a dict keyed by id removes repeats)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:  # Many helpers, so the questions overlap
        answers = dict(zip([v["id"] for v in to_ask], pool.map(lambda v: photo_in(v, lat, lon), to_ask)))  # version id -> its photo (or None)

    result = {}  # "before" and "after"
    for moment, year in [("before", first_year), ("after", last_year)]:  # Each moment and its year
        photos = [{**answers[v["id"]], "version": v["date"], "tiles": v["tiles"]} for v in wanted[moment] if answers[v["id"]]]  # Its dated photos, each with the version that shows it ("**" copies the photo's fields in)
        result[moment] = photo_for_year(photos, year) if photos else None  # The closest one, or None
    if result["before"] or result["after"]:  # Only save a real answer
        CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Create the folder the first time
        temporary = path.with_suffix(".tmp")  # Write under a temporary name first...
        temporary.write_text(json.dumps(result), encoding="utf-8")  # ...the whole answer...
        temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read
    return result  # Hand back both
