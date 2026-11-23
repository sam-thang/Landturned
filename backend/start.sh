#!/usr/bin/env sh
# Starts the Landturned server in production (Render runs this from the backend folder). Locally, use
# "uv run uvicorn app.main:app --port 8000" as usual; this script is for the server.

set -e  # Stop at the first command that fails, instead of carrying on half-started

# GDAL (the raster library) keeps recently read map data in memory. Its default limit is 5% of the computer's memory,
# and in a cloud container it may count the whole host machine, not our 512 MB. 64 MB is plenty for our small reads
# (measured: about 240 MB in total with 4 analyses at once). A value set in Render's dashboard wins over this one.
export GDAL_CACHEMAX="${GDAL_CACHEMAX:-64}"

# Believe Render's front door when it says the visitor came over https, so the server's own redirects (like /how -> /how/)
# keep visitors on https. "*" = trust it from any address (Render's front door is the only way in). Given as a setting, not
# on the command line: on Windows, a lone * on the command line gets expanded into the folder's file names.
export FORWARDED_ALLOW_IPS="*"

# Start the server ("exec" hands over to it, so Render's stop signal reaches it directly):
# --host 0.0.0.0        listen on every network address, so Render's front door can reach it
# --port "$PORT"        the port Render chooses and passes in (8000 if run without it)
# --workers 1           exactly one server process: the search queue, the daily search count and the shared archive
#                       lookups live inside it, so two processes would each think they had the whole allowance
# --proxy-headers       read the front door's notes about the visitor (allowed from the addresses in FORWARDED_ALLOW_IPS)
exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --proxy-headers
