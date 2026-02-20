import requests
import json
import random

class RadioBrowser:
    """
    Client for the Radio Browser API (https://www.radio-browser.info/)
    """
    
    # List of available DNS-balanced servers to try in case one is down
    SERVERS = [
        "https://de1.api.radio-browser.info",
        "https://fr1.api.radio-browser.info",
        "https://at1.api.radio-browser.info",
        "https://nl1.api.radio-browser.info"
    ]

    def __init__(self):
        self.base_url = self.SERVERS[0] 
        # In a real robust app we might want to ping servers to find the fastest one on init
        # For now, we default to de1 as requested for EU focus

    def search_stations(self, query, limit=20):
        """
        Search for radio stations by name/tag.
        """
        endpoint = "/json/stations/search"
        
        params = {
            'name': query,
            'limit': limit,
            'order': 'clickcount', # Show popular stations first
            'reverse': 'true',
            'hidebroken': 'true' # Don't show broken streams
        }
        
        # Try primary server
        try:
            return self._do_request(self.base_url + endpoint, params)
        except Exception as e:
            print(f"Radio API error on primary: {e}")
            # Fallback (simple round robin or random pick could be added here)
            return []

    def _do_request(self, url, params):
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        # Transform to our app's simpler format
        results = []
        for station in data:
            results.append({
                "id": station.get("stationuuid"), # Unique ID
                "name": station.get("name", "Unknown Station"),
                "url": station.get("url_resolved"), # The actual stream URL
                "favicon": station.get("favicon") or None,
                "country": station.get("countrycode"),
                "tags": station.get("tags"),
                "bitrate": station.get("bitrate")
            })
        return results

    def get_top_stations(self, country_code=None, limit=20):
        """Get top stations possibly filtered by country"""
        # API supports /json/stations/topclick/{limit}
        # But to filter by country we might need search with empty name?
        # Actually /json/stations/search supports countrycode param
        
        params = {
            'limit': limit,
            'order': 'clickcount',
            'reverse': 'true',
            'hidebroken': 'true'
        }
        
        if country_code:
            params['countrycode'] = country_code
            
        return self._do_request(self.base_url + "/json/stations/search", params)
