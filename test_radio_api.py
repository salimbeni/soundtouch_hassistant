import requests
import json

def search_radio(query):
    # Radio Browser API endpoint (using de1 mirror as user asked for EU focus implies likely EU location, but DNS lb exists)
    url = "https://de1.api.radio-browser.info/json/stations/search"
    params = {
        'name': query,
        'limit': 5,
        'order': 'clickcount',
        'reverse': 'true'
    }
    try:
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        stations = response.json()
        print(json.dumps(stations, indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    search_radio("jazz")
