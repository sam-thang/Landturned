# Address search and place names, through Geoapify (geoapify.com), on behalf of every visitor.
#
# The browser asks our server, and our server asks Geoapify. That way:
# - the Geoapify key stays secret on the server (in the browser, anyone could copy it and use up our searches)
# - every visitor shares one memory on disk: a place searched once is answered at once for everyone after
# - the whole site keeps to Geoapify's free plan: at most 5 requests per second and 3,000 per day
#
# Geoapify's data comes from OpenStreetMap, so the site credits both (see the map credit in frontend/index.html).

import hashlib  # Built into Python; turns a question into a short fixed-length name for its memory file
import json  # Built into Python; reads and writes the saved answers
import os  # Built into Python; reads settings ("environment variables") such as the API key
import threading  # Built into Python; a "lock" so parallel requests take turns with the shared timer and counter
import time  # Built into Python; a clock for spacing out requests, and sleep() to wait
import urllib.error  # Built into Python; the errors urllib raises when a request fails
import urllib.parse  # Built into Python; builds the "?name=value" part of a web address safely
import urllib.request  # Built into Python; sends requests over the internet
from datetime import datetime, timezone  # Built into Python; today's date, for the daily count
from pathlib import Path  # Built into Python; a handy way to build file paths

from dotenv import load_dotenv  # python-dotenv: copies the settings in backend/.env into the environment

from app import settings  # Our own code: where saved answers live

BACKEND_DIR = Path(__file__).resolve().parents[1]  # The backend folder (this file is backend/app/geocoding.py)
load_dotenv(BACKEND_DIR / ".env")  # Read backend/.env, if it exists (it holds GEOAPIFY_API_KEY; git never uploads it)

GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode"  # Geoapify's geocoding service; "/search" and "/reverse" are added to it
MIN_GAP_S = 0.2  # The shortest time between two requests to Geoapify, in seconds: 0.2 s = 5 per second, the free plan's limit
MAX_WAIT_S = 3.0  # If a request would have to wait longer than this for its turn, answer "busy" instead of keeping the visitor waiting
DAILY_LIMIT = 2900  # Requests per day we allow ourselves: safely under the free plan's 3,000 (counted per UTC day, like Geoapify)
TIMEOUT_S = 10  # How long to wait for Geoapify's answer before giving up, in seconds
USER_AGENT = "Landturned/0.1 (land-change portfolio project)"  # How our server introduces itself in each request
CACHE_DIR = settings.CACHE_ROOT / "geocoding"  # backend/cache/geocoding (or on the server's disk, see settings.py): one small file per answered question (ignored by git, like the other caches)
USAGE_FILE = CACHE_DIR / "usage.json"  # Today's request count, kept on disk so a server restart doesn't reset it

_lock = threading.Lock()  # One lock for the shared timer and the counter below: requests handled at the same moment take turns using them
_next_allowed = 0.0  # When the next request to Geoapify may be sent, as a time.monotonic() clock reading (0 = right away)


class GeocodingBusy(Exception):
    """Too many searches at this moment: the visitor should try again in a moment."""


class GeocodingUnavailable(Exception):
    """Search can't be used right now (no key, today's allowance used up, or Geoapify not answering). The message says which."""


# The secret key from backend/.env (or from the server's settings). Raises GeocodingUnavailable if there is none.
def _api_key() -> str:
    key = os.environ.get("GEOAPIFY_API_KEY", "").strip()  # The key, or "" if it isn't set
    if not key:  # No key: we can't ask Geoapify
        raise GeocodingUnavailable("unavailable")  # The frontend shows its "search not available" message
    return key  # Hand it back


# The memory file for one question. The question text becomes a hash (a short code that's always the same for the same
# text), so any address, with any letters or symbols in it, gets a safe file name.
def _cache_path(question: str) -> Path:
    name = hashlib.sha256(question.encode("utf-8")).hexdigest()[:32]  # The first 32 characters of the question's hash
    return CACHE_DIR / f"{name}.json"  # e.g. backend/cache/geocoding/3f9a....json


# A saved answer, or None if this question hasn't been answered before
def _read_saved(question: str):
    path = _cache_path(question)  # Where its answer would be
    if not path.exists():  # Never asked
        return None  # Nothing saved
    return json.loads(path.read_text(encoding="utf-8"))["answer"]  # The saved answer (the file also keeps the question, for people reading the folder)


# Save an answer for next time
def _save(question: str, answer) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Make the folder if it isn't there yet
    path = _cache_path(question)  # Where the answer goes
    temporary = path.with_suffix(".tmp")  # Write to a temporary file first...
    temporary.write_text(json.dumps({"question": question, "answer": answer}), encoding="utf-8")  # ...the question and its answer...
    temporary.replace(path)  # ...then rename it in one go, so a half-written file can never be read


# Wait for our turn, so the whole site sends at most 5 requests per second. Each request books the next free slot
# (0.2 s after the previous one) and waits for it. If that slot is too far away, answer "busy" instead.
def _wait_for_turn() -> None:
    global _next_allowed  # We change the shared timer defined at the top of the file
    with _lock:  # One request at a time in here
        now = time.monotonic()  # The current clock reading, in seconds (a clock that never jumps, unlike the time of day)
        slot = max(now, _next_allowed)  # Our slot: now, or later if another request was sent less than 0.2 s ago
        if slot - now > MAX_WAIT_S:  # The queue is too long:
            raise GeocodingBusy("busy")  # Don't book a slot; the visitor is told to try again in a moment
        _next_allowed = slot + MIN_GAP_S  # Book it: the next request goes 0.2 s after ours
    time.sleep(slot - now)  # Wait for our slot outside the lock, so others can book theirs meanwhile (0 if it's now)


# Count one request against today's allowance. Raises GeocodingUnavailable when today's allowance is used up.
def _count_request() -> None:
    today = datetime.now(timezone.utc).date().isoformat()  # Today's date in UTC, e.g. "2026-11-23"
    with _lock:  # One request at a time in here
        usage = {"date": today, "count": 0}  # A fresh count, unless today's is saved
        if USAGE_FILE.exists():  # A count is saved:
            saved = json.loads(USAGE_FILE.read_text(encoding="utf-8"))  # Read it
            if saved.get("date") == today:  # It's today's:
                usage = saved  # Carry on counting from it (a new day starts again at 0)
        if usage["count"] >= DAILY_LIMIT:  # Allowance used up:
            raise GeocodingUnavailable("daily-limit")  # Search rests until tomorrow (UTC); saved answers still work
        usage["count"] += 1  # Count this request
        CACHE_DIR.mkdir(parents=True, exist_ok=True)  # Make the folder if it isn't there yet
        USAGE_FILE.write_text(json.dumps(usage), encoding="utf-8")  # Save the new count


# Ask Geoapify one question ("search" or "reverse" plus its settings) and hand back its JSON answer.
# "question" names it for the memory. Saved answers come back at once, without a request.
def _ask(question: str, endpoint: str, params: dict) -> dict:
    saved = _read_saved(question)  # Answered before?
    if saved is not None:  # Yes:
        return saved  # Reuse it: no waiting, no credit used
    key = _api_key()  # The secret key (stops here if there's none)
    _wait_for_turn()  # Keep the whole site to 5 requests per second
    _count_request()  # Keep the whole site under the daily allowance
    query = urllib.parse.urlencode({**params, "format": "json", "apiKey": key})  # The settings, plus "answer in JSON" and our key
    request = urllib.request.Request(f"{GEOAPIFY_URL}/{endpoint}?{query}", headers={"User-Agent": USER_AGENT})  # The request, introducing ourselves
    try:  # Try to ask...
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # Send it and wait for the answer
            answer = json.loads(response.read().decode("utf-8"))  # Turn the answer text into Python values
    except (urllib.error.URLError, TimeoutError, ValueError) as error:  # ...but Geoapify refused (e.g. a wrong key), didn't answer, or sent something unreadable:
        raise GeocodingUnavailable("unavailable") from error  # Search isn't working right now (nothing is saved, so it's asked again next time)
    _save(question, answer)  # Remember it for everyone
    return answer  # Hand it back


# Look up an address. Hands back {"lat", "lon", "name"} for the best match, or None if nothing was found.
# Example: search("Fontana, California") -> {"lat": 34.09, "lon": -117.43, "name": "Fontana, CA, United States of America"}
def search(text: str) -> dict | None:
    cleaned = " ".join(text.split())  # The text with extra spaces removed (inside too), so " Fontana  CA" and "Fontana CA" match
    question = f"search:{cleaned.lower()}"  # Its name in the memory, ignoring capitals
    answer = _ask(question, "search", {"text": cleaned, "limit": 1})  # Ask for the single best match
    results = answer.get("results", [])  # The list of matches (empty if nothing was found)
    if not results:  # Nothing found:
        return None  # The frontend says "Couldn't find that address"
    best = results[0]  # The best match
    return {"lat": best["lat"], "lon": best["lon"], "name": best.get("formatted", cleaned)}  # Its position and full name


# The town or city at a point, e.g. "Fontana", or None if there isn't one (open sea, desert, ice).
# The point is rounded to 3 decimals (about 100 m) for the memory: spots that close always get the same town.
def place_name(lat: float, lon: float) -> str | None:
    lat, lon = round(lat, 3), round(lon, 3)  # Round the point (also what we ask about, so the saved answer fits every spot it's used for)
    question = f"reverse:{lat},{lon}"  # Its name in the memory
    answer = _ask(question, "reverse", {"lat": lat, "lon": lon, "type": "city"})  # Ask for the city level (not the street address)
    results = answer.get("results", [])  # The matches (empty if there's no place here)
    if not results:  # Nothing here:
        return None  # The frontend falls back to coordinates
    return results[0].get("city")  # The settlement's name ("city" covers towns and villages too); None if only bigger areas were found
