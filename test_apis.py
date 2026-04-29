from tunein_api import TuneInAPI
from radio_browser import RadioBrowser

try:
    print("Testing TuneIn...")
    t = TuneInAPI()
    res = t.search("jazz")
    print(f"TuneIn returned {len(res)} results.")
except Exception as e:
    print(f"TuneIn Error: {e}")

try:
    print("Testing RadioBrowser...")
    r = RadioBrowser()
    res = r.search_stations("jazz", limit=5)
    print(f"RadioBrowser returned {len(res)} results.")
except Exception as e:
    print(f"RadioBrowser Error: {e}")
