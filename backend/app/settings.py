# Settings shared by the whole backend, worked out once here so every file follows the same rule.

import os  # Built into Python; reads settings ("environment variables") given to the server
from pathlib import Path  # Built into Python; a handy way to build file paths

BACKEND_DIR = Path(__file__).resolve().parents[1]  # The backend folder (this file is backend/app/settings.py)

# Where every saved answer lives: land-cover analyses, archive photo lookups, place names and the daily search count,
# grid-zone facts, and Sentinel-2 photos, each in its own folder or file inside it.
# On your computer, LANDTURN_CACHE_DIR isn't set, so it's backend/cache, as always. On the server (Render), it points at
# the permanent disk (e.g. /var/data/cache), because the server's normal files are wiped on every restart and deploy.
CACHE_ROOT = Path(os.environ.get("LANDTURN_CACHE_DIR") or BACKEND_DIR / "cache")  # The setting if given ("or" skips an empty one), else backend/cache
