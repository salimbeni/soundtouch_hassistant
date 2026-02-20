import requests

class TuneInAPI:
    """
    Client for the TuneIn OPML API (opml.radiotime.com).
    Provides search, browse, and station resolution for SoundTouch devices.
    """

    BASE_URL = "https://opml.radiotime.com"

    def search(self, query, limit=20):
        """Search TuneIn for radio stations."""
        try:
            r = requests.get(f"{self.BASE_URL}/Search.ashx", params={
                'query': query,
                'render': 'json',
                'formats': 'mp3,aac',
            }, timeout=5)
            r.raise_for_status()
            data = r.json()

            results = []
            for item in data.get('body', []):
                if item.get('item') != 'station':
                    continue
                results.append(self._parse_station(item))
                if len(results) >= limit:
                    break
            return results
        except Exception as e:
            print(f"TuneIn search error: {e}")
            return []

    def browse(self, category='local', limit=30):
        """
        Browse TuneIn by category.
        Categories: local, music, talk, sports, location, language, podcast
        """
        try:
            # First get the category URL
            r = requests.get(f"{self.BASE_URL}/Browse.ashx", params={
                'render': 'json',
                'formats': 'mp3,aac',
            }, timeout=5)
            r.raise_for_status()
            categories = r.json().get('body', [])

            # Find the requested category
            cat_url = None
            for cat in categories:
                if cat.get('key') == category:
                    cat_url = cat.get('URL')
                    break

            if not cat_url:
                return []

            # Fetch category contents
            r2 = requests.get(cat_url, params={
                'render': 'json',
                'formats': 'mp3,aac',
            }, timeout=5)
            r2.raise_for_status()
            data = r2.json()

            results = []
            for section in data.get('body', []):
                # Some categories have nested children
                children = section.get('children', [section])
                for item in children:
                    if item.get('item') == 'station' and item.get('type') == 'audio':
                        results.append(self._parse_station(item))
                        if len(results) >= limit:
                            return results
            return results
        except Exception as e:
            print(f"TuneIn browse error: {e}")
            return []

    def get_popular(self, limit=20):
        """Get popular/trending stations."""
        try:
            r = requests.get(f"{self.BASE_URL}/Browse.ashx", params={
                'c': 'trending',
                'render': 'json',
                'formats': 'mp3,aac',
            }, timeout=5)
            r.raise_for_status()
            data = r.json()

            results = []
            for section in data.get('body', []):
                children = section.get('children', [section])
                for item in children:
                    if item.get('item') == 'station' and item.get('type') == 'audio':
                        results.append(self._parse_station(item))
                        if len(results) >= limit:
                            return results
            return results
        except Exception as e:
            print(f"TuneIn popular error: {e}")
            return []

    def get_categories(self):
        """Get available browse categories."""
        try:
            r = requests.get(f"{self.BASE_URL}/Browse.ashx", params={
                'render': 'json',
            }, timeout=5)
            r.raise_for_status()
            data = r.json()

            return [
                {"key": item.get("key"), "name": item.get("text")}
                for item in data.get("body", [])
                if item.get("key")
            ]
        except Exception as e:
            print(f"TuneIn categories error: {e}")
            return []

    def _parse_station(self, item):
        """Parse a TuneIn station item into our standardized format."""
        guide_id = item.get('guide_id', '')
        return {
            "id": guide_id,
            "name": item.get('text', 'Unknown'),
            "guide_id": guide_id,
            "image": item.get('image'),
            "now_playing": item.get('playing') or item.get('subtext'),
            "bitrate": item.get('bitrate'),
            "reliability": item.get('reliability'),
            "source": "tunein"
        }
