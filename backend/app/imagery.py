# The satellite photo of our 2 x 2 km square for one year, made from Sentinel-2: the same satellite the land-cover
# maps were made from. It is drawn onto exactly the same 10 m pixel grid as the land-cover square, so every photo pixel
# sits on one land-cover pixel and the change colours line up with what the photo shows.

import functools  # Built into Python; lru_cache remembers answers so the same photo isn't made twice
import io  # Built into Python; lets us "save a file" into memory instead of onto the disk
import json  # Built into Python; reads and writes the saved photos as JSON text
from concurrent.futures import ThreadPoolExecutor  # Built into Python; runs several downloads at the same time
from pathlib import Path  # Built into Python; a handy way to build file paths

import numpy as np  # numpy: fast math on big grids of numbers
import rasterio  # Reads raster files, including just a small window of a big file
from affine import Affine  # The "transform" type (installed with rasterio); Affine.translation shifts a grid by whole pixels
from PIL import Image  # Pillow's Image: makes and saves pictures
from rasterio.enums import Resampling  # The ways of filling pixels when a raster is moved onto another grid
from rasterio.vrt import WarpedVRT  # A "virtual" raster: another raster seen through our grid, without saving a copy
from rasterio.warp import transform  # Converts coordinates from one projection to another

from app import change_image, landcover  # Our own code: data URLs (change_image) and the square's grid (landcover)

# ---------- Settings ----------

COLLECTION = "sentinel-2-l2a"  # Sentinel-2 images corrected to surface reflectance ("Level-2A"), on Planetary Computer
MAX_SCENE_CLOUD = 80  # Look at images up to 80% cloudy over their whole 110 km tile: our small square can still be clear
CANDIDATES = 6  # How many images to check over our square (summer and least cloudy first, so the best is nearly always among them)
# Finished photos are saved here, one small JSON file per place and year: a photo of 2017 never changes, so once made it
# can be reused, even after the server restarts. Generated data, not code: the folder is listed in .gitignore.
CACHE_DIR = Path(__file__).resolve().parents[1] / "cache" / "imagery"  # backend/cache/imagery
WORKERS = 6  # How many images to open at the same time. Most of the time is spent waiting for the internet, so the waits overlap
CLEAR_ENOUGH = 0.01  # An image is "clear" when clouds hide at most 1% of our square; among clear ones, summer wins
# The photo covers more than the analysed square, so the map has surroundings: the square's grid, extended by
# MARGIN pixels on every side. 200 pixels (2 km) on each side gives a 6 x 6 km photo, 600 x 600 pixels.
MARGIN = 200  # Extra pixels on each side
JPEG_QUALITY = 85  # Photo quality (0-100): 85 looks the same as the original at about a sixth of a PNG's size
# Sentinel-2's "scene classification" layer gives every pixel a class; these mean we can't see the ground there:
HIDDEN = [0, 3, 8, 9, 10]  # 0 no data, 3 cloud shadow, 8 cloud (medium), 9 cloud (high), 10 thin cirrus
TROPICS = 23.5  # Latitude of the tropics: closer to the equator there is no real winter, so any month will do
NORTH_SUMMER = {5, 6, 7, 8, 9}  # May to September: green, high sun, short shadows north of the tropics
SOUTH_SUMMER = {11, 12, 1, 2, 3}  # November to March: the same south of the tropics
# The colour stretch: which surface brightness ("reflectance", 0 to 1) is shown as white, and how the values in
# between are spread. A square-root curve (gamma 0.5) lifts the dark ground and keeps bright roofs from turning pure white.
WHITE = 0.45  # Reflectance shown as pure white (bright warehouse roofs reach about 0.4)
GAMMA = 0.5  # The curve: output = (reflectance / WHITE) ** GAMMA
# Since processing baseline 04.00 (images from 25 January 2022 on), the stored values carry an extra +1000.
# Without removing it, every image from 2022 on would look brighter than older ones: fake change.
OFFSET_BASELINE = "04.00"  # The first baseline with the offset
OFFSET = 1000  # The offset to remove


def summer_months(lat):
    """The months we prefer for a place, or None in the tropics (any month is fine there)."""
    if abs(lat) < TROPICS:  # Close to the equator:
        return None  # no season preference
    return NORTH_SUMMER if lat > 0 else SOUTH_SUMMER  # Northern or southern summer


def search(lon, lat, year, max_cloud):
    """All Sentinel-2 images of the point in one year that are less than max_cloud percent cloudy overall."""
    catalog = landcover.open_catalog()  # The Planetary Computer catalog (signed links)
    found = catalog.search(  # Ask the catalog:
        collections=[COLLECTION],  # Sentinel-2 Level-2A only,
        intersects={"type": "Point", "coordinates": [lon, lat]},  # covering our point,
        datetime=f"{year}-01-01/{year}-12-31",  # taken in this year,
        query={"eo:cloud_cover": {"lt": max_cloud}},  # and not too cloudy overall
    )  # End of the search
    return list(found.items())  # Every matching image ("item")


def off_season(item, lat):
    """True for an image taken outside the preferred months (always False in the tropics)."""
    summer = summer_months(lat)  # The preferred months (or None)
    month = int(item.properties["datetime"][5:7])  # The month it was taken (characters 6-7 of "2023-06-05T...")
    return summer is not None and month not in summer  # Outside summer, where seasons matter


def candidates(lon, lat, year):
    """The images worth checking over our square: summer ones first, then the least cloudy overall."""
    items = search(lon, lat, year, MAX_SCENE_CLOUD)  # Every image of the year that isn't mostly cloud
    return sorted(items, key=lambda item: (off_season(item, lat), item.properties["eo:cloud_cover"]))[:CANDIDATES]  # Summer first (False sorts before True), then least cloudy; keep the best few


def read_on_grid(href, crs, grid, size, resampling):
    """Read one band of an image, moved onto our square's grid (same projection, same 10 m pixels)."""
    with rasterio.open(href) as src, WarpedVRT(src, crs=crs, transform=grid, width=size, height=size, resampling=resampling) as vrt:  # See the image through our grid
        return vrt.read(1)  # Read just our 200 x 200 pixels of its first (only) band


def hidden_share(item, crs, grid, size):
    """The share of the analysed square (0 to 1) where clouds, their shadows, or missing data hide the ground.
    "grid" and "size" describe the whole photo (square plus margin); only its middle, the square itself, is judged."""
    scl = read_on_grid(item.assets["SCL"].href, crs, grid, size, Resampling.nearest)  # The scene classification (20 m pixels, so each covers four of ours)
    square = scl[MARGIN : size - MARGIN, MARGIN : size - MARGIN]  # Cut out the middle: the analysed square
    return float(np.isin(square, HIDDEN).mean())  # True where hidden; the mean of True/False is the share of True


def true_colour(item, crs, grid, size):
    """The image's red, green and blue bands as a 200 x 200 x 3 picture, with our own colour stretch."""
    offset = OFFSET if item.properties.get("s2:processing_baseline", "00.00") >= OFFSET_BASELINE else 0  # Remove the +1000 from newer images only
    bands = ["B04", "B03", "B02"]  # Sentinel-2's red, green and blue bands (all 10 m)
    with ThreadPoolExecutor(max_workers=3) as pool:  # Three helpers, so the three downloads happen at the same time
        raws = list(pool.map(lambda band: read_on_grid(item.assets[band].href, crs, grid, size, Resampling.bilinear), bands))  # Each band's stored values, in red, green, blue order
    channels = []  # Red, green, blue after the stretch, filled in below
    for raw in raws:  # Each band in turn
        reflectance = np.clip((raw.astype(float) - offset) / 10_000, 0, None)  # Stored values are reflectance x 10,000 (plus the offset); never below 0
        channels.append(np.clip(reflectance / WHITE, 0, 1) ** GAMMA)  # The stretch: 0 to WHITE becomes 0 to 1, along the square-root curve
    return (np.stack(channels, axis=-1) * 255).astype(np.uint8)  # Stack into rows x columns x 3, scaled to 0-255 whole numbers


def corners_lonlat(crs, grid, size):
    """The square's four corners as [longitude, latitude]: top-left, top-right, bottom-right, bottom-left (MapLibre's order)."""
    left, top = grid * (0, 0)  # Column 0, row 0: the top-left corner, in meters
    right, bottom = grid * (size, size)  # Column 200, row 200: the bottom-right corner
    lons, lats = transform(crs, "EPSG:4326", [left, right, right, left], [top, top, bottom, bottom])  # Back to longitude/latitude
    return [[lo, la] for lo, la in zip(lons, lats)]  # Pair them up


@functools.lru_cache(maxsize=64)  # Remember the last 64 answers in memory: the same place and year come back instantly
def square_photo(lat, lon, year):
    """The clearest summer Sentinel-2 photo of the square in one year, as a dictionary ready for the API.
    Looks in the disk cache first; makes (and saves) the photo only if it isn't there yet.
    Raises LookupError when there is no land-cover map or no usable image for the place and year."""
    path = CACHE_DIR / f"{lat:.5f}_{lon:.5f}_{year}_6km.json"  # This place and year's file, e.g. "33.97850_-117.59620_2017_6km.json"
    if path.exists():  # Made before:
        return json.loads(path.read_text(encoding="utf-8"))  # Read it back: no need to ask Planetary Computer at all
    answer = make_photo(lat, lon, year)  # Make it (raises LookupError if there's nothing to make)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Create the cache folder the first time
    temporary = path.with_suffix(".tmp")  # Write under a temporary name first...
    temporary.write_text(json.dumps(answer), encoding="utf-8")  # ...the whole answer...
    temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read
    return answer  # Hand back the photo


def make_photo(lat, lon, year):
    """Find, read and colour the photo (the slow part: about 6-10 seconds over the internet)."""
    with ThreadPoolExecutor(max_workers=2) as pool:  # Two helpers: the two catalog searches don't depend on each other, so they run at the same time
        maps_job = pool.submit(landcover.find_items_by_year, lon, lat)  # The land-cover maps for the point (any year gives the same grid)
        items_job = pool.submit(candidates, lon, lat, year)  # The Sentinel-2 images worth checking, summer first
        maps, items = maps_job.result(), items_job.result()  # Wait for both answers
    if not maps:  # No land-cover data here (e.g. far out at sea):
        raise LookupError("No land-cover data for this location.")  # Nothing to line the photo up with
    crs, square_grid, square_size = landcover.square_grid(next(iter(maps.values())), lon, lat)  # The square's projection, grid and size, from the first map
    grid = square_grid * Affine.translation(-MARGIN, -MARGIN)  # The same grid, with its corner moved MARGIN pixels up and left: same 10 m pixels, same alignment
    size = square_size + 2 * MARGIN  # 200 + 2 x 200 = 600 pixels across

    if not items:  # No image at all for this year:
        raise LookupError(f"No Sentinel-2 image for this location in {year}.")  # Say so
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:  # Several helpers, so the checks overlap instead of waiting in line
        shares = list(pool.map(lambda item: hidden_share(item, crs, grid, size), items))  # How much of our square each image hides, in the same order as items

    def choice(pair):  # How a (share, image) pair sorts: smaller comes first
        share, item = pair  # Take the pair apart
        return (share > CLEAR_ENOUGH, off_season(item, lat), share)  # Clear ones first, then summer ones, then the least hidden

    share, item = min(zip(shares, items), key=choice)  # The winner ("zip" pairs each share with its image)
    buffer = io.BytesIO()  # An empty "file" in memory
    Image.fromarray(true_colour(item, crs, grid, size)).save(buffer, format="JPEG", quality=JPEG_QUALITY)  # Make the picture and save it as a JPEG (made for photos: small, no visible loss)
    return {  # The answer:
        "year": year,  # The year asked for
        "date": item.properties["datetime"][:10],  # The day the image was taken, e.g. "2023-06-05"
        "hidden_percent": round(share * 100, 1),  # How much of the analysed square clouds or shadows hide, in percent
        "url": change_image.to_data_url(buffer.getvalue(), "image/jpeg"),  # The JPEG, written as a data URL
        "corners": corners_lonlat(crs, grid, size),  # Where the whole 6 x 6 km photo goes on the map
        "credit": f"Contains modified Copernicus Sentinel data ({year})",  # The credit line the Sentinel data terms ask for
    }  # End of the answer
