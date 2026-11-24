# The long view: one Landsat photo of a 15 x 15 km square around a place for each 5-year slot from 1985 to 2025.
# Photos only, as USGS delivers them: nothing is measured, and the only change to the pixels is the display stretch
# (the same for every pixel and every year). See CLAUDE.md, "Long view".
#
# Finished frames are saved on disk (backend/cache/longview/, or the server's permanent disk), one JPEG and one small
# JSON file per place and slot. Nearby addresses share them: the square's centre is rounded to 0.01 degrees (about
# 1 km), so everyone searching within the same kilometer gets the same frames, instantly after the first time.

import functools  # Built into Python; lru_cache remembers answers so the same search isn't made twice
import io  # Built into Python; lets us "save a file" into memory instead of onto the disk
import json  # Built into Python; reads and writes the frame records as JSON text
import math  # Built into Python; math.floor for the UTM zone, cos and hypot for distances
import os  # Built into Python; os.environ sets options for GDAL, the library rasterio uses to read files
import threading  # Built into Python; a "semaphore" lets only one new place be made at a time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait  # Built into Python; runs several downloads at the same time, waits for the first of them, and hands out results as they finish
from datetime import date  # Built into Python; today's date, to know which slots may still get newer photos

# Don't let GDAL list the folder around each file before opening it: online that's a slow, useless extra request
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")  # Set before any file is opened

import numpy as np  # numpy: fast math on big grids of numbers
import rasterio  # Reads raster files, including just a small window of a big file
from affine import Affine  # A "transform": the rule that turns a pixel's column/row into meters on the ground
from PIL import Image  # Pillow's Image: makes and saves pictures
from rasterio.enums import Resampling  # The ways of filling pixels when a raster is moved onto another grid
from rasterio.vrt import WarpedVRT  # A "virtual" raster: another raster seen through our grid, without saving a copy
from rasterio.warp import transform  # Converts coordinates from one projection to another

from app import landcover, settings  # Our own code: the catalog and the grid's zone (landcover), the cache folder (settings)

# ---------- Settings ----------

# Summer: green, high sun, short shadows. The months depend on the hemisphere; in the tropics any month will do.
TROPICS = 23.5  # Latitude of the tropics: closer to the equator there is no real winter
NORTH_SUMMER = {5, 6, 7, 8, 9}  # May to September, north of the tropics
SOUTH_SUMMER = {11, 12, 1, 2, 3}  # November to March, south of the tropics
# The colour stretch: which surface brightness ("reflectance", 0 to 1) is shown as white, and how the values in
# between are spread. A square-root curve (gamma 0.5) lifts the dark ground and keeps bright roofs from turning pure white.
WHITE = 0.45  # Reflectance shown as pure white (bright warehouse roofs reach about 0.4)
GAMMA = 0.5  # The curve: output = (reflectance / WHITE) ** GAMMA

COLLECTION = "landsat-c2-l2"  # Landsat Collection 2 Level-2 (surface reflectance) on Planetary Computer
SLOTS = [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]  # One frame every 5 years
NEAREST = [0, 1, -1, 2, -2]  # Years to try for each slot, in order: the slot year, then one after, one before, two after, two before
PIXEL_M = 30  # Landsat's pixel size: 30 meters
SIZE_PX = 500  # The frame is 500 x 500 pixels...
SIZE_M = SIZE_PX * PIXEL_M  # ...so it covers 500 x 30 m = 15,000 m = 15 km on each side
# Landsat's own pixel edges sit at 15 m past a multiple of 30 m (e.g. 399,885 m). Putting ours on the same lines means
# no pixel has to be split between two of theirs: when the zones match, the photo's pixels are Landsat's own, unchanged.
GRID_OFFSET_M = 15  # Where Landsat's pixel edges sit within each 30 m step
SATELLITES = {"landsat-5": "Landsat 5", "landsat-7": "Landsat 7", "landsat-8": "Landsat 8", "landsat-9": "Landsat 9"}  # Allowed satellites and their names
L7_BROKEN = "2003-05-31"  # The day Landsat 7's scan line corrector broke: after it, its images have striped gaps
MAX_SCENE_CLOUD = 80  # Skip scenes over 80% cloudy overall: our square is unlikely to be clear in those
# The catalog checks these itself, so scenes we'd throw away are never sent to us (written in "CQL2", the catalog's filter language):
SERVER_FILTER = {"op": "and", "args": [  # All of these must be true:
    {"op": "=", "args": [{"property": "landsat:collection_category"}, "T1"]},  # Tier 1 (see allowed)
    {"op": "in", "args": [{"property": "platform"}, list(SATELLITES)]},  # one of our satellites
    {"op": "<", "args": [{"property": "eo:cloud_cover"}, MAX_SCENE_CLOUD]},  # not mostly cloud
]}  # End of the filter
# Each scene's description normally lists about 25 files and many details (about 30 KB); we only need these (about 5 KB).
# Asking for fewer made the searches about 3 times faster. The first five are the basics every scene description needs.
FIELDS = {"include": [  # Only send these parts:
    "type", "stac_version", "stac_extensions", "geometry", "bbox", "id", "collection",  # the basics
    "properties.datetime", "properties.platform", "properties.eo:cloud_cover",  # when, which satellite, how cloudy overall
    "properties.landsat:wrs_path", "properties.landsat:wrs_row", "properties.landsat:collection_category",  # path, row, tier
    "properties.proj:code", "properties.proj:epsg",  # the projection its files are stored in
    "assets.qa_pixel.href", "assets.red.href", "assets.green.href", "assets.blue.href",  # links to the four files we read
], "exclude": []}  # Leave nothing else out
SEARCH_PATIENCE_S = 6  # Seconds to wait for a catalog search before sending a backup request (a search normally takes 2-3 s)
CHECK = 8  # How many scenes per year to check at the place itself (main path/row and least cloudy first)
CLEAR_ENOUGH = 0.02  # A scene is "clear" when clouds, shadows or missing data hide at most 2% of our square
WORKERS = 16  # How many files to read at the same time (shared by all nine slots, which run at the same time)
# The QA_PIXEL band's flags (bits) that mean "we can't see the ground here":
# bit 0 no data, bit 1 near a cloud, bit 2 thin cirrus (Landsat 8/9 only), bit 3 cloud, bit 4 cloud shadow.
HIDDEN_BITS = 0b11111  # Bits 0 to 4 all set: 1 + 2 + 4 + 8 + 16 = 31
QA_FILL = 1  # The QA value of "no data" (only bit 0 set): what we see outside the scene's edges
SCALE, OFFSET = 0.0000275, -0.2  # Landsat Collection 2: reflectance = stored number x 0.0000275 - 0.2

# Cache
CACHE_DIR = settings.CACHE_ROOT / "longview"  # backend/cache/longview (or on the server's disk, see settings.py; ignored by git)
CENTRE_DECIMALS = 2  # The square's centre is rounded to 2 decimals of a degree (0.01 degrees: about 1.1 km north-south, less east-west)
JPEG_QUALITY = 85  # Photo quality (0-100): 85 looks the same as the original at a fraction of the size
# Old years never get new photos, so their frames are kept forever. A slot whose years reach the present (slot + 2 years
# or later) can still get better photos as new ones arrive, so its frame is made again when it's older than this:
REFRESH_DAYS = 30  # Days
# Making a new place's photos uses about 110 MB of memory for 15-25 s. The server has 512 MB, and three at once made Render
# restart it (2026-11-24). So only one place is made at a time: a second visitor waits for the first (still seeing their
# "Finding summer photos" line), while places already saved are never held up. A "semaphore" is a counter of free turns.
MAKING = threading.Semaphore(1)  # One turn

# ---------- The grid ----------


def utm_crs(lat, lon):
    """The UTM projection of the zone the place is in, e.g. "EPSG:32611" (Fontana). UTM measures in meters.
    The zone follows the same rule as the land-cover files (landcover.grid_zone), including the grid's exceptions, such as
    Norway's west coast, which uses zone 32 instead of 31. Otherwise the long view's photos and the analysis square would sit
    on two different zones' grids, and the square would look turned (about 4° in Stavanger, found 2026-11-24)."""
    grid = landcover.grid_zone(lat, lon)  # The land-cover grid zone, e.g. "32V" (None near the poles, outside the grid)
    zone = int(grid[:-1]) if grid else math.floor((lon + 180) / 6) + 1  # Its number ("32V" -> 32); near the poles, the plain 6-degree rule
    return f"EPSG:{32600 + zone}" if lat >= 0 else f"EPSG:{32700 + zone}"  # 326xx is the northern half, 327xx the southern


def square_grid(lat, lon):
    """Our 15 x 15 km square as (projection, transform): the same 500 x 500 grid of 30 m pixels for every year."""
    crs = utm_crs(lat, lon)  # The place's UTM zone
    (x,), (y,) = transform("EPSG:4326", crs, [lon], [lat])  # The place in meters (easting x, northing y)
    left = round((x - SIZE_M / 2 - GRID_OFFSET_M) / PIXEL_M) * PIXEL_M + GRID_OFFSET_M  # Left edge: 7.5 km west, moved onto Landsat's pixel lines
    top = round((y + SIZE_M / 2 - GRID_OFFSET_M) / PIXEL_M) * PIXEL_M + GRID_OFFSET_M  # Top edge: 7.5 km north, on the same lines
    return crs, Affine(PIXEL_M, 0, left, 0, -PIXEL_M, top)  # Each column steps 30 m east, each row 30 m south, from the top-left corner


def read_on_grid(href, crs, grid, resampling, nodata):
    """Read one band of a scene, moved onto our square's grid. Outside the scene's edges we get `nodata`."""
    with rasterio.open(href) as src, WarpedVRT(  # Open the file and see it through our grid...
        src, crs=crs, transform=grid, width=SIZE_PX, height=SIZE_PX,  # ...our projection, position and size...
        resampling=resampling, src_nodata=nodata, nodata=nodata,  # ...the fill method, and what "no data" is (so the gap outside the scene is marked, not 0)
    ) as vrt:  # End of the opening
        return vrt.read(1)  # Read just our 500 x 500 pixels of its first (only) band

# ---------- Finding scenes ----------


def summer_months(lat):
    """The months we prefer for a place, or None in the tropics (any month is fine there)."""
    if abs(lat) < TROPICS:  # Close to the equator:
        return None  # no season preference
    return NORTH_SUMMER if lat > 0 else SOUTH_SUMMER  # Northern or southern summer


def in_summer(item, lat):
    """True when the scene was taken in the place's summer (always True in the tropics)."""
    summer = summer_months(lat)  # May-Sep north, Nov-Mar south, None in the tropics (the app's own rule)
    month = int(item.properties["datetime"][5:7])  # The month (characters 6-7 of "1985-09-30T...")
    return summer is None or month in summer  # Any month in the tropics, otherwise summer only


def allowed(item):
    """True for Tier 1 scenes of Landsat 5, 8 and 9, and of Landsat 7 only before its fault in 2003."""
    platform = item.properties["platform"]  # e.g. "landsat-5"
    if platform not in SATELLITES:  # Landsat 4 and anything else:
        return False  # not used
    # USGS sorts scenes into Tier 1 (placed on the map accurately enough to line up year after year) and Tier 2 (not:
    # one Stavanger scene from Sep 2000 showed mountains 50 km away instead of the city). Only Tier 1 can be compared.
    if item.properties["landsat:collection_category"] != "T1":  # Tier 2 (or not yet sorted):
        return False  # not used
    return platform != "landsat-7" or item.properties["datetime"][:10] <= L7_BROKEN  # Landsat 7 only up to the fault


def path_row(item):
    """The scene's WRS-2 path and row, e.g. "040/036"."""
    return f'{item.properties["landsat:wrs_path"]}/{item.properties["landsat:wrs_row"]}'  # Path first, then row


def distance_from_centre(item, lat, lon):
    """How far the place is from the middle of the scene's outline, in degrees of latitude (roughly 111 km each).
    The scene with its middle closest to the place has our square well inside it, far from its edges."""
    west, south, east, north = item.bbox  # The scene's outline as a box: its western, southern, eastern and northern edges
    across = ((west + east) / 2 - lon) * math.cos(math.radians(lat))  # East-west gap; a degree of longitude shrinks towards the poles, so it's scaled down
    up = (south + north) / 2 - lat  # North-south gap
    return math.hypot(across, up)  # The straight-line distance (Pythagoras)


def season_dates(lat, year):
    """The dates to ask the catalog for, as "start/end": the northern summer, or the whole year elsewhere.
    The catalog takes one date range per search. The southern summer (Nov-Mar) crosses New Year and the tropics have no
    summer, so there we ask for the whole year and drop the other months afterwards (in_summer)."""
    if summer_months(lat) == NORTH_SUMMER:  # North of the tropics:
        return f"{year}-05-01/{year}-09-30"  # May 1 to Sep 30 (the app's northern summer)
    return f"{year}-01-01/{year}-12-31"  # Elsewhere: the whole year


@functools.lru_cache(maxsize=256)  # Remember answers, so a year asked for again (as a neighbour of a slot) isn't searched twice
def search_year(lat, lon, year):
    """Every usable summer scene covering the place in one year, with a backup request for a stuck search.
    A search normally answers in 2-3 s, but now and then one gets stuck at Planetary Computer for 15 s or more (measured
    2026-11-24: one of nine, at random), and the whole long view waits for it. So when the first request hasn't answered
    after SEARCH_PATIENCE_S, the same search is sent again and whichever answer comes first is used."""
    helpers = ThreadPoolExecutor(max_workers=2)  # Two helpers: the first request and, if needed, the backup
    first = helpers.submit(ask_catalog, lat, lon, year)  # Send the first request
    done, _ = wait([first], timeout=SEARCH_PATIENCE_S)  # Wait for it, but only so long
    if not done:  # Still no answer:
        backup = helpers.submit(ask_catalog, lat, lon, year)  # send the same search again
        done, _ = wait([first, backup], return_when=FIRST_COMPLETED)  # and wait for whichever answers first
    helpers.shutdown(wait=False)  # Don't wait for the slower one: it finishes in the background and its answer is ignored
    return done.pop().result()  # The first answer (if that request failed, its error is passed on)


def ask_catalog(lat, lon, year):
    """One catalog search: every usable summer scene covering the place in one year."""
    catalog = landcover.open_catalog()  # The Planetary Computer catalog (file links signed automatically)
    found = catalog.search(  # Ask the catalog:
        collections=[COLLECTION],  # Landsat Collection 2 Level-2,
        intersects={"type": "Point", "coordinates": [lon, lat]},  # covering our place,
        datetime=season_dates(lat, year),  # taken in that year's summer (or that year),
        filter=SERVER_FILTER, filter_lang="cql2-json",  # Tier 1, our satellites, not mostly cloud (checked by the catalog itself)
        fields=FIELDS,  # only the parts of each scene's description we use
        limit=1000,  # up to 1,000 scenes per page, so one page is almost always enough
    )  # End of the search
    return tuple(item for item in found.items() if allowed(item) and in_summer(item, lat))  # Double-check (and drop Landsat 7 after 2003, and winter in the south); a tuple can't be changed by accident once remembered


def main_path_row(lat, lon, pool):
    """The main path/row: the one whose scenes are centred closest to the place, so our square sits well inside every
    one of its photos. (Counting scenes doesn't work: in Stavanger the most common path/row only just reaches the city.)"""
    found = pool.map(lambda slot: search_year(lat, lon, slot), SLOTS)  # Every slot year's scenes, searched at the same time
    every = [item for items in found for item in items]  # All of them in one list
    if not every:  # No scenes at all (e.g. far out at sea):
        return None  # no main path/row
    return path_row(min(every, key=lambda item: distance_from_centre(item, lat, lon)))  # The path/row of the best-centred scene

# ---------- Checking clouds at the place ----------


def hidden_share(item, crs, grid):
    """The share of our square (0 to 1) hidden by clouds, their shadows, or missing data, from the QA_PIXEL band."""
    qa = read_on_grid(item.assets["qa_pixel"].href, crs, grid, Resampling.nearest, QA_FILL)  # The flags (nearest: never blend two pixels' flags)
    return float(((qa & HIDDEN_BITS) != 0).mean())  # "&" keeps only bits 0-4; any of them set means hidden; the mean of True/False is the share


def pick(items, year, preferred, crs, grid, pool):
    """Check one year's best few scenes at the place. Returns (clearest usable scene or None, every scene checked with its share)."""
    this_year = [item for item in items if int(item.properties["datetime"][:4]) == year]  # Scenes taken in that year
    this_year.sort(key=lambda item: (path_row(item) != preferred, item.properties["eo:cloud_cover"]))  # Main path/row first (False sorts first), then least cloudy overall
    this_year = this_year[:CHECK]  # Only the first few: checking costs a download each
    shares = list(pool.map(lambda item: hidden_share(item, crs, grid), this_year))  # Their hidden shares, read at the same time
    checked = list(zip(this_year, shares))  # Pair each scene with its share
    clear = [(item, share) for item, share in checked if share <= CLEAR_ENOUGH]  # The clear ones
    if not clear:  # None clear this year:
        return None, checked  # say so (the caller tries another year)
    clear.sort(key=lambda pair: (path_row(pair[0]) != preferred, pair[1]))  # Main path/row first, then the least hidden
    return clear[0][0], checked  # The winner, and everything we checked

# ---------- The photo ----------


def scene_crs(item):
    """The projection the scene's files are stored in, e.g. "EPSG:32611"."""
    code = item.properties.get("proj:code")  # Newer catalog entries write it as "EPSG:32611"...
    return code or f'EPSG:{item.properties["proj:epsg"]}'  # ...older ones as the number 32611


def true_colour(item, crs, grid, pool):
    """The scene's red, green and blue bands on our grid as a 500 x 500 picture, with the app's colour stretch.
    The pixel values are used as USGS delivers them: the only change is the display stretch, the same for every pixel and year."""
    # When the scene is stored in our UTM zone, our pixels sit exactly on Landsat's own pixels (see GRID_OFFSET_M),
    # so "nearest" just copies them, unchanged. A scene from another zone is turned slightly against our grid, so its
    # pixels must be blended into ours (bilinear).
    resampling = Resampling.nearest if scene_crs(item) == crs else Resampling.bilinear  # Copy when aligned, blend when not
    raws = list(pool.map(lambda band: read_on_grid(item.assets[band].href, crs, grid, resampling, 0), ["red", "green", "blue"]))  # The three bands, read at the same time (0 means no data)
    channels = []  # Red, green, blue after the stretch, filled in below
    for raw in raws:  # Each band in turn
        reflectance = np.clip(raw.astype(float) * SCALE + OFFSET, 0, None)  # Stored numbers to reflectance (0 to about 1); never below 0
        stretched = np.clip(reflectance / WHITE, 0, 1) ** GAMMA  # The app's stretch: 0 to 0.45 becomes 0 to 1, on a square-root curve
        channels.append(np.where(raw == 0, 0, stretched))  # Where there's no data, black
    return Image.fromarray((np.stack(channels, axis=-1) * 255).astype(np.uint8))  # Stack into rows x columns x 3, scale to 0-255, make a picture


def to_jpeg(picture):
    """A picture as JPEG file contents (bytes)."""
    buffer = io.BytesIO()  # A "file" in memory
    picture.save(buffer, format="JPEG", quality=JPEG_QUALITY, subsampling=0)  # Save into it; subsampling=0 keeps color at full sharpness (by default JPEG halves it, which smears color across roof edges)
    return buffer.getvalue()  # The bytes

# ---------- One frame per slot ----------


def make_frame(slot, preferred, lat, lon, crs, grid, pool):
    """Find and download the frame for one slot. Returns (record describing it, JPEG bytes or None when missing)."""
    tried = []  # Every scene checked, for the record
    winner = None  # The chosen scene, once found
    this_year = date.today().year  # No point looking past this year
    for step in NEAREST:  # The slot year first, then the nearest years
        year = slot + step  # The year to try
        if year > this_year:  # In the future:
            continue  # skip it
        items = search_year(lat, lon, year)  # That year's scenes (already remembered for the slot year; searched now for a neighbour)
        winner, checked = pick(items, year, preferred, crs, grid, pool)  # The clearest scene that year, if any
        tried += checked  # Remember what was checked
        if winner is not None:  # Found a clear one:
            break  # stop looking
    if winner is None and tried:  # No clear scene in any of the five years, but there were scenes:
        winner = min(tried, key=lambda pair: pair[1])[0]  # use the least hidden one anyway, and the record says how hidden
    record = {"slot": slot, "checked": len(tried), "made": date.today().isoformat()}  # What we know so far, and when it was made
    if winner is None:  # Nothing at all:
        record["missing"] = True  # mark the slot as missing
        return record, None  # no picture
    share = dict((id(item), s) for item, s in tried)[id(winner)]  # The winner's hidden share (found again by matching the scene)
    taken = winner.properties["datetime"][:10]  # e.g. "1985-09-30"
    record.update(  # Record the winner:
        missing=False,  # we have a frame
        date=taken,  # the day it was taken
        year=int(taken[:4]),  # its year
        substituted=int(taken[:4]) != slot,  # True when it's from another year than the slot
        satellite=SATELLITES[winner.properties["platform"]],  # e.g. "Landsat 5"
        path_row=path_row(winner),  # e.g. "040/036"
        hidden=round(share, 3),  # the share of our square hidden by clouds or missing data
        scene_cloud=winner.properties["eo:cloud_cover"],  # the whole scene's cloud percentage, for comparison
        scene=winner.id,  # the scene's name in the catalog
    )  # End of the record
    return record, to_jpeg(true_colour(winner, crs, grid, pool))  # The record and the photo

# ---------- The cache ----------


def centre_of(lat, lon):
    """The square's centre for a place: rounded to 0.01 degrees, so nearby addresses share the same frames."""
    return round(lat, CENTRE_DECIMALS), round(lon, CENTRE_DECIMALS)  # e.g. (34.09, -117.44)


def place_dir(centre_lat, centre_lon):
    """The folder of one place's frames, e.g. backend/cache/longview/34.09_-117.44_32611. The projection's number is part of
    the name, so frames made on another zone's grid (before the zone fix of 2026-11-24) are never used again."""
    epsg = utm_crs(centre_lat, centre_lon).split(":")[1]  # e.g. "32611"
    return CACHE_DIR / f"{centre_lat:.{CENTRE_DECIMALS}f}_{centre_lon:.{CENTRE_DECIMALS}f}_{epsg}"  # Named after the rounded centre and the zone


def still_good(record):
    """True when a saved frame can be used as it is: always for old slots; for a slot whose years reach the present,
    only for REFRESH_DAYS after it was made (newer photos may have arrived since)."""
    if record["slot"] + max(NEAREST) < date.today().year:  # Every year this slot could use is over:
        return True  # it will never change
    age = (date.today() - date.fromisoformat(record["made"])).days  # How many days ago it was made
    return age <= REFRESH_DAYS  # Recent enough


def load_frame(folder, slot):
    """A saved frame as (record, JPEG bytes), or None when it isn't saved or is too old."""
    record_path = folder / f"{slot}.json"  # The record, e.g. ".../1985.json"
    if not record_path.exists():  # Never made:
        return None  # nothing saved
    record = json.loads(record_path.read_text(encoding="utf-8"))  # Read the record
    if not still_good(record):  # Too old to trust:
        return None  # make it again
    return record, (folder / f"{slot}.jpg").read_bytes()  # The record and the photo


def save_frame(folder, record, jpeg):
    """Save a frame: the photo first, then its record, each under a temporary name and then renamed in one go, so a
    half-written file can never be read. The record is written last, so it only exists when its photo does."""
    folder.mkdir(parents=True, exist_ok=True)  # Create the place's folder the first time
    for name, data in ((f'{record["slot"]}.jpg', jpeg), (f'{record["slot"]}.json', json.dumps(record).encode("utf-8"))):  # The photo, then the record
        temporary = folder / (name + ".tmp")  # A temporary name...
        temporary.write_bytes(data)  # ...to write the whole file under...
        temporary.replace(folder / name)  # ...then renamed in one go

# ---------- All frames of a place ----------


def corners_lonlat(crs, grid):
    """The square's four corners as [longitude, latitude]: top-left, top-right, bottom-right, bottom-left (MapLibre's order)."""
    left, top = grid * (0, 0)  # Column 0, row 0: the top-left corner, in meters
    right, bottom = grid * (SIZE_PX, SIZE_PX)  # Column 500, row 500: the bottom-right corner
    lons, lats = transform(crs, "EPSG:4326", [left, right, right, left], [top, top, bottom, bottom])  # Back to longitude/latitude
    return [[lo, la] for lo, la in zip(lons, lats)]  # Pair them up


def long_view_parts(lat, lon):
    """The long view of a place, piece by piece, as each piece is ready (a "generator": it hands out one piece at a time
    with "yield", so the app can show progress and the first photos while the rest are still being made).
    First piece: a dictionary with the square's centre and corners and the slots. Then one (record, JPEG bytes or None)
    pair per slot, in the order they're ready: saved frames at once, new ones as each is made (about 15-25 s for all nine).
    Each record has "cached": True when it came from the disk."""
    centre_lat, centre_lon = centre_of(lat, lon)  # The shared, rounded centre
    crs, grid = square_grid(centre_lat, centre_lon)  # Our 15 x 15 km grid around it
    yield {  # The first piece: what the frames will show
        "centre": [centre_lon, centre_lat],  # the square's centre as [longitude, latitude]
        "corners": corners_lonlat(crs, grid),  # its four corners as [longitude, latitude], to line things up with the photos
        "slots": SLOTS,  # the slots that will follow
    }  # End of the first piece
    folder = place_dir(centre_lat, centre_lon)  # Where its frames are saved
    to_make = []  # The slots still to make, filled in below
    for slot in SLOTS:  # Saved frames first: they're instant
        saved = load_frame(folder, slot)  # The saved frame (None where there isn't a usable one)
        if saved is None:  # Not saved, or too old:
            to_make.append(slot)  # make it below
        else:  # Saved and still good:
            record, jpeg = saved  # its record and photo
            yield {**record, "cached": True}, jpeg  # hand it out, marked as coming from the cache
    if not to_make:  # Everything was saved:
        return  # done
    with MAKING:  # Wait for our turn: only one place's photos are made at a time on this server (see MAKING)
        yield from make_missing(to_make, folder, centre_lat, centre_lon, crs, grid)  # Make them, handing each out as it's ready


def make_missing(to_make, folder, centre_lat, centre_lon, crs, grid):
    """Make the given slots' frames, saving each and handing it out as (record, JPEG bytes or None) when it's ready."""
    # All slots are worked on at the same time: each one mostly waits for the internet, so the waits overlap.
    # Two groups of helpers: one per slot (each finds its frame), and a shared group that reads the files. A slot
    # helper waits for file readers, never the other way round, so they can't get stuck waiting for each other.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool, ThreadPoolExecutor(max_workers=len(SLOTS)) as slot_pool:  # The file readers, and one helper per slot
        preferred = main_path_row(centre_lat, centre_lon, pool)  # The main path/row (searches every slot year, at the same time)
        jobs = [slot_pool.submit(make_frame, slot, preferred, centre_lat, centre_lon, crs, grid, pool) for slot in to_make]  # Start every slot's frame ("submit" hands back a "future": a result still to come)
        for job in as_completed(jobs):  # Each frame as soon as it's finished, whichever comes first
            record, jpeg = job.result()  # Its record and photo (an error while making it is passed on here)
            if jpeg is not None:  # A real photo (a missing slot isn't saved, so it's tried again next time):
                save_frame(folder, record, jpeg)  # save it for next time
            yield {**record, "cached": False}, jpeg  # hand it out, marked as just made


def saved_long_view(lat, lon):
    """The frames already saved for a place, without making any (for link previews, which mustn't wait 15 s).
    Returns the first piece of long_view_parts plus "frames": {slot: (record, JPEG bytes)} for the saved slots only."""
    centre_lat, centre_lon = centre_of(lat, lon)  # The shared, rounded centre
    crs, grid = square_grid(centre_lat, centre_lon)  # Its grid (for the corners)
    folder = place_dir(centre_lat, centre_lon)  # Where its frames are saved
    frames = {}  # Slot -> (record, JPEG bytes), filled in below
    for slot in SLOTS:  # Each slot
        saved = load_frame(folder, slot)  # Its saved frame, or None
        if saved is not None:  # Saved:
            frames[slot] = saved  # keep it
    return {"centre": [centre_lon, centre_lat], "corners": corners_lonlat(crs, grid), "slots": SLOTS, "frames": frames}  # Like long_view, but only what's saved


def long_view(lat, lon):
    """All nine frames for a place at once (the test script uses this). Returns the first piece of long_view_parts plus
    "frames": every slot's (record, JPEG bytes or None), in slot order."""
    parts = long_view_parts(lat, lon)  # The pieces, still to come
    head = next(parts)  # The first piece: centre, corners and slots
    frames = {record["slot"]: (record, jpeg) for record, jpeg in parts}  # Every frame, by slot (this waits until all are in)
    return {**head, "frames": [frames[slot] for slot in SLOTS]}  # The first piece plus the frames in slot order
