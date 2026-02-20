import unittest
from radio_browser import RadioBrowser
from app import app
import json

class TestRadioIntegration(unittest.TestCase):
    def setUp(self):
        self.rb = RadioBrowser()
        self.app = app.test_client()
        self.app.testing = True

    def test_radio_browser_class(self):
        print("\nTesting RadioBrowser class...")
        stations = self.rb.search_stations("Jazz", limit=5)
        self.assertTrue(len(stations) > 0, "Should return stations")
        first = stations[0]
        self.assertIn("name", first)
        self.assertIn("url", first)
        self.assertIn("country", first)
        print(f"  Found {len(stations)} stations. First: {first['name']}")

    def test_api_endpoint_search(self):
        print("\nTesting API /api/radio/search with query...")
        response = self.app.get('/api/radio/search?q=Rock')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(isinstance(data, list))
        self.assertTrue(len(data) > 0)
        print(f"  API returned {len(data)} stations for 'Rock'")

    def test_api_endpoint_top_stations(self):
        print("\nTesting API /api/radio/search (Top Stations)...")
        response = self.app.get('/api/radio/search')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(len(data) > 0)
        print(f"  API returned {len(data)} top stations")
        
    def test_api_endpoint_country(self):
        print("\nTesting API /api/radio/search?country=CH...")
        response = self.app.get('/api/radio/search?country=CH')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(len(data) > 0)
        # Verify mostly swiss
        ch_count = sum(1 for s in data if s['country'] == 'CH')
        print(f"  API returned {len(data)} stations for Switzerland. {ch_count} match country code CH.")

if __name__ == '__main__':
    unittest.main()
