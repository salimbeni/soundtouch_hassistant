import requests
import json
import xml.etree.ElementTree as ET

KNOWN_DEVICES_FILE = "known_devices.json"

try:
    with open(KNOWN_DEVICES_FILE, 'r') as f:
        devices = json.load(f)
except FileNotFoundError:
    print("No known devices found.")
    devices = []

for d in devices:
    ip = d['ip']
    name = d['name']
    print(f"Checking {name} ({ip})...")
    try:
        url = f"http://{ip}:8090/capabilities"
        resp = requests.get(url, timeout=2)
        if resp.status_code == 200:
            root = ET.fromstring(resp.text)
            airplay = False
            for cap in root.findall(".//cap"):
                if cap.get("id") == "AIRPLAY":
                    airplay = True
                    break
            if airplay:
                print(f"  -> AIRPLAY SUPPORTED ✅")
            else:
                print(f"  -> AIRPLAY NOT supported ❌")
        else:
            print(f"  -> Error: {resp.status_code}")
    except Exception as e:
        print(f"  -> Error connecting: {e}")
