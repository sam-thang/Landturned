# The Landturn backend: a small web API built with FastAPI.

from typing import Annotated  # Lets us attach extra rules to a function input (like "must be between -90 and 90")

# Bring in FastAPI, the library that turns Python functions into web addresses,
# HTTPException (for sending back an error answer) and Query (rules for ?name=value inputs in the address)
from fastapi import FastAPI, HTTPException, Query

from app import change_image, landcover  # Our own code: the change picture and the land-cover data

# Create the app. The title is shown on FastAPI's automatic documentation page (at /docs).
app = FastAPI(title="Landturn backend")


# The line starting with "@" is a "decorator": it tells FastAPI to run the function below
# whenever someone asks for the address /api/health with a GET request (a normal "please give me" request).
@app.get("/api/health")
def health() -> dict:  # "-> dict" notes that this function hands back a dictionary (named values)
    return {"status": "ok"}  # Answer with a small dictionary; FastAPI turns it into JSON: {"status": "ok"}


# The change between the first and latest year, for the 2 x 2 km square around a point.
# Example: /api/change?lat=33.96&lon=-117.55
# This is a plain "def" (not "async def"), so FastAPI runs it in a separate worker thread:
# while it waits a few seconds for the map data, the server can still answer other requests.
@app.get("/api/change")
def change(
    lat: Annotated[float, Query(ge=-90, le=90, description="Latitude in degrees")],  # A number from -90 to 90 (ge = greater or equal, le = less or equal); FastAPI rejects anything else with a clear error
    lon: Annotated[float, Query(ge=-180, le=180, description="Longitude in degrees")],  # A number from -180 to 180
) -> dict:  # Hands back a dictionary, which FastAPI turns into JSON
    items_by_year = landcover.find_items_by_year(lon, lat)  # Find all available land-cover maps for this point
    if not items_by_year:  # No maps found (e.g. far out at sea)?
        raise HTTPException(status_code=404, detail="No land-cover data for this location.")  # Answer with error 404 ("not found") and a message
    years = list(items_by_year)  # The available years, oldest first
    first, latest = years[0], years[-1]  # Compare the oldest with the newest

    data_before, _ = landcover.read_square(items_by_year[first], lon, lat)  # Read the first year's square ("_" = we don't need its corners)
    data_after, corners = landcover.read_square(items_by_year[latest], lon, lat)  # Read the latest year's square, and keep its corners
    before = landcover.to_categories(data_before)  # Translate into our six categories
    after = landcover.to_categories(data_after)  # Same for the latest year
    change_grid = landcover.compare(before, after)  # One change code per pixel

    return {  # The answer, which FastAPI turns into JSON:
        "location": {"lat": lat, "lon": lon},  # The point we were asked about
        "years": {"from": first, "to": latest, "available": years},  # Which years we compared, and all years there are (for the timeline later)
        "stats_ha": landcover.summarize(before, after, change_grid),  # The stats, in hectares
        "image": {  # The change picture for the map:
            "url": change_image.to_data_url(change_image.make_png(change_grid)),  # The PNG, written as a data URL
            "corners": corners,  # Its four corners as [longitude, latitude]: top-left, top-right, bottom-right, bottom-left
        },  # End of the image
        "source": "Impact Observatory annual land cover, 10 m (Microsoft Planetary Computer)",  # Where the data comes from, for the title block
    }  # End of the answer
