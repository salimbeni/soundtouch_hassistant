import requests
import json

try:
    response = requests.get('http://localhost:5001/api/devices')
    if response.status_code == 200:
        data = response.json()
        print(json.dumps(data, indent=2))
    else:
        print(f"Error: {response.status_code}")
except Exception as e:
    print(f"Exception: {e}")
