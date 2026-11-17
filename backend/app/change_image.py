# Turns the change grid (one change code per pixel) into a transparent, colored PNG picture for the map.

import base64  # Built into Python: writes binary data (like a PNG file) as plain text
import io  # Built into Python: lets us "save a file" into memory instead of onto the disk

import numpy as np  # numpy: fast math on big grids of numbers
from PIL import Image  # Pillow's Image: makes and saves pictures

from app import landcover  # Our land-cover code, for the change code numbers

# The color of each change code as [red, green, blue, alpha]; each value from 0 to 255.
# Alpha is see-through-ness: 0 = fully transparent, 255 = fully solid. The hex colors match style.css.
COLORS = np.zeros((6, 4), dtype=np.uint8)  # 6 rows (change codes 0-5) x 4 values, all starting as 0 = transparent
COLORS[landcover.CLEARED] = [0xFF, 0x5A, 0x4F, 255]  # Red #ff5a4f (--loss): green space cleared
COLORS[landcover.GAINED] = [0x4F, 0xD9, 0x8A, 255]  # Green #4fd98a (--gain): green space gained
COLORS[landcover.NEW_BUILT] = [0xFF, 0xA0, 0x1F, 255]  # Orange #ffa01f (--built): newly built
COLORS[landcover.NEW_WATER] = [0x3D, 0xB8, 0xF5, 255]  # Blue #3db8f5 (--water): new water
# NO_CHANGE (0) and UNKNOWN (5) stay transparent, so the satellite image shows through


def make_png(change):
    """Turn a change grid into PNG file data (bytes)."""
    rgba = COLORS[change]  # Lookup table again: each pixel's change code picks its row of 4 color values -> a 200 x 200 x 4 grid
    image = Image.fromarray(rgba)  # Make a picture from the grid; 4 values per pixel tells Pillow it's RGBA (Red, Green, Blue, Alpha)
    buffer = io.BytesIO()  # An empty "file" in memory
    image.save(buffer, format="PNG")  # Save the picture into it as a PNG (PNG keeps sharp edges and supports transparency)
    return buffer.getvalue()  # Hand back the PNG's raw bytes


def to_data_url(png_bytes):
    """Write PNG bytes as a data URL: a web address that contains the picture itself, as text."""
    text = base64.b64encode(png_bytes).decode("ascii")  # Base64 turns the bytes into letters, digits, + and /
    return f"data:image/png;base64,{text}"  # Browsers read this like an image link
