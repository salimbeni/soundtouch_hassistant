import json
from tunein_api import TuneInAPI
from radio_browser import RadioBrowser

t = TuneInAPI()
r = RadioBrowser()
print("TuneIn:")
print(json.dumps(t.search("jazz")[0], indent=2))
print("RadioBrowser:")
print(json.dumps(r.search_stations("jazz", limit=1)[0], indent=2))
