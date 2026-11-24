# Warm-up script: make and save the long view's Landsat photos for every hotspot in advance, so the places most visitors
# click open their long view instantly. It is not part of the app. Run it from the backend folder:
#   uv run python -m scripts.warm_longview                          (fills this computer's cache, backend/cache/longview)
#   uv run python -m scripts.warm_longview https://landturned.com   (asks the live site, which fills its own disk)
# The second form asks the site exactly as a visitor's browser does, so it needs no access to the server itself.
# Run it again whenever frontend/src/places.js changes. Places already saved come back in about a second.

import json  # Built into Python; reads each line of the site's answer
import sys  # Built into Python; sys.argv is the list of words typed on the command line
import time  # Built into Python; time.perf_counter measures how long things take
import urllib.parse  # Built into Python; builds the "?lat=...&lon=..." part of a web address safely
import urllib.request  # Built into Python; asks a web address for its answer
from concurrent.futures import ThreadPoolExecutor  # Built into Python; works on a few places at the same time

from app import longview  # Our own code: the long view (used when warming this computer's cache)
from scripts.warm_wayback import read_places  # The hotspot list from places.js (the same reader the other warm-up uses)

PARALLEL = 3  # How many places at once: quicker than one by one, gentler on the server (512 MB) and Planetary Computer than all at once
TIMEOUT_S = 180  # The longest to wait for one place's answer (a new place takes about 15-25 s)


def warm_here(lat, lon):
    """Make (or read back) one place's photos on this computer. Returns (photos found, how many came from the cache)."""
    answer = longview.long_view(lat, lon)  # All nine frames (see app/longview.py)
    found = sum(1 for _, jpeg in answer["frames"] if jpeg is not None)  # Years with a photo
    cached = sum(1 for record, _ in answer["frames"] if record["cached"])  # Years already saved before
    return found, cached  # The two counts


def warm_site(base, lat, lon):
    """Ask a live site for one place's long view, reading its answer line by line. Returns (photos found, from its cache)."""
    query = urllib.parse.urlencode({"lat": lat, "lon": lon})  # e.g. "lat=30.015&lon=31.71"
    request = urllib.request.Request(f"{base}/api/longview?{query}", headers={"User-Agent": "landturned-warm-up"})  # The request, with a plain name for the script
    found = cached = 0  # Counts, filled in below
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # Send it and open the answer
        for line in response:  # Each line as it arrives (one per piece)
            piece = json.loads(line)  # Read it
            if piece["type"] == "error":  # The site failed halfway:
                raise RuntimeError(piece["detail"])  # pass the reason on
            if piece["type"] == "frame":  # A year:
                found += piece["image"] is not None  # Count it if it has a photo (True counts as 1)
                cached += piece["cached"]  # ...and if it came from the site's cache
    return found, cached  # The two counts


def warm(place, base):
    """Warm one place. Returns a line for the table."""
    pid, _name, lat, lon = place  # Take the place apart
    start = time.perf_counter()  # Note the start time
    try:  # Try to warm it...
        found, cached = warm_site(base, lat, lon) if base else warm_here(lat, lon)  # On the site, or on this computer
    except Exception as error:  # ...but report a failure instead of stopping the whole run
        return f"{pid:<15} FAILED: {error}"  # The table row
    return f"{pid:<15} {time.perf_counter() - start:5.1f} s   {found} of {len(longview.SLOTS)} photos, {cached} already saved"  # The table row


def main():
    """Warm every hotspot, a few at a time, and print a table."""
    base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else None  # The site's address, if one was typed (without a trailing "/")
    places = read_places()  # The hotspots
    where = base or "this computer"  # For the message
    print(f"Warming the long view for {len(places)} hotspots on {where}, {PARALLEL} at a time...")  # Say what's happening
    start = time.perf_counter()  # Note the start time
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:  # A few helpers
        for line in pool.map(lambda place: warm(place, base), places):  # Each place's result, in list order
            print(line)  # Print it as soon as it's ready
    print(f"Done in {time.perf_counter() - start:.0f} s.")  # The total time


if __name__ == "__main__":  # Only run main() when this file is run directly
    main()  # Start
