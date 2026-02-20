from bosesoundtouchapi import SoundTouchDevice
import json

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
    print(f"Testing {name} ({ip})...")
    try:
        from bosesoundtouchapi import SoundTouchClient, SoundTouchDevice
        device = SoundTouchDevice(ip)
        client = SoundTouchClient(device)
        # Try to select AIRPLAY source
        print("  -> Attempting to select AIRPLAY...")
        client.SelectSource("AIRPLAY")
        print("  -> Success! Device accepted AIRPLAY source.")
    except Exception as e:
        print(f"  -> Failed: {e}")
