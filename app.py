import threading
from flask import Flask, render_template, jsonify, request
from soundtouch_manager import SoundTouchManager
from radio_browser import RadioBrowser
from tunein_api import TuneInAPI

app = Flask(__name__)
manager = SoundTouchManager()
radio_api = RadioBrowser()
tunein_api = TuneInAPI()

# Home Assistant Ingress Support
@app.context_processor
def inject_ingress_path():
    return dict(ingress_path=request.headers.get('X-Ingress-Path', ''))

# Start discovery in background on launch - DISABLED to prevent hang
# Triggers manually via /api/scan or first visit
def start_discovery():
    try:
        print("Starting background discovery...")
        manager.discover_devices() # Now optimized with threads
        print("Discovery complete.")
    except Exception as e:
        print(f"Discovery error: {e}")

@app.route('/')
def index():
    return render_template('index.html')

# Static file serving override for Ingress if needed? 
# Flask usually handles this if relative paths are used in HTML.

@app.route('/api/scan', methods=['POST'])
def trigger_scan():
    # Start scan in background thread
    discovery_thread = threading.Thread(target=start_discovery)
    discovery_thread.daemon = True
    discovery_thread.start()
    return jsonify({"success": True, "message": "Scan started"})

@app.route('/api/devices')
def get_devices():
    # Return what we have immediately
    # Auto-trigger scan if empty but only once?
    # Better to let client trigger it.
    return jsonify(manager.get_devices_status())

@app.route('/api/device/add', methods=['POST'])
def add_device():
    data = request.json
    ip = data.get('ip')
    if ip:
        result = manager.add_device(ip)
        return jsonify(result)
    return jsonify({"success": False, "message": "IP address required"})

@app.route('/api/play', methods=['POST'])
def play_url():
    data = request.json
    device_id = data.get('device_id')
    url = data.get('url')
    title = data.get('title', 'Stream')
    result = manager.play_url(device_id, url, title)
    return jsonify(result)

@app.route('/api/control', methods=['POST'])
def control_device():
    data = request.json
    device_id = data.get('device_id')
    action = data.get('action')
    val = data.get('value')
    
    if action == 'play_pause':
        return jsonify(manager.play_pause(device_id))
    elif action == 'next':
        return jsonify(manager.next_track(device_id))
    elif action == 'prev':
        return jsonify(manager.previous_track(device_id))
    elif action == 'volume':
        return jsonify(manager.set_volume(device_id, val))
    elif action == 'source':
        return jsonify(manager.select_source(device_id, val))
        
    return jsonify({"success": False, "message": "Unknown action"})

@app.route('/api/preset', methods=['POST'])
def handle_preset():
    data = request.json
    device_id = data.get('device_id')
    preset_id = data.get('preset_id')
    action = data.get('action', 'play') # 'play' or 'store'
    
    return jsonify(manager.select_preset(device_id, preset_id, action))

@app.route('/api/zone', methods=['POST'])
def create_zone():
    data = request.json
    master_id = data.get('master_id')
    members = data.get('members', [])
    if data.get('action') == 'remove':
         return jsonify(manager.remove_zone(master_id))
         
    return jsonify(manager.create_zone(master_id, members))

@app.route('/api/zone/remove_member', methods=['POST'])
def remove_zone_member():
    data = request.json
    master_id = data.get('masterId')
    slave_id = data.get('slaveId')
    if not master_id or not slave_id:
        return jsonify({"success": False, "message": "Missing masterId or slaveId"}), 400
    return jsonify(manager.remove_zone_slave(master_id, slave_id))

@app.route('/api/favorites', methods=['GET', 'POST', 'DELETE'])
def favorites():
    if request.method == 'POST':
        data = request.json
        return jsonify(manager.add_favorite(
            data.get('name'), 
            data.get('url'), 
            image=data.get('image'),
            guide_id=data.get('guide_id'),
            type=data.get('type', 'url')
        ))
    elif request.method == 'DELETE':
        index = request.json.get('index')
        return jsonify(manager.remove_favorite(index))
    else:
        return jsonify(manager.get_favorites_list())

@app.route('/api/device/<device_id>/settings', methods=['GET', 'POST'])
def device_settings(device_id):
    if request.method == 'GET':
        return jsonify(manager.get_device_settings(device_id))
    else:
        # Update settings
        data = request.json
        results = {}
        
        if 'bass' in data:
            results['bass'] = manager.set_bass(device_id, data['bass'])
        
        if 'treble' in data:
            results['treble'] = manager.set_treble(device_id, data['treble'])
            
        if 'name' in data:
            results['name'] = manager.set_name(device_id, data['name'])
            
        return jsonify({"success": True, "results": results})

@app.route('/api/device/<device_id>/reboot', methods=['POST'])
def device_reboot(device_id):
    return jsonify(manager.reboot_device(device_id))

@app.route('/api/device/<device_id>/power', methods=['POST'])
def device_power(device_id):
    # reuse reboot_device which sends POWER key
    return jsonify(manager.reboot_device(device_id))

@app.route('/api/device/forget', methods=['POST'])
def forget_device():
    data = request.json
    ip = data.get('ip')
    return jsonify(manager.delete_known_device(ip))

@app.route('/api/device/<device_id>/mute', methods=['POST'])
def device_mute(device_id):
    return jsonify(manager.toggle_mute(device_id))

@app.route('/api/radio/search', methods=['GET'])
def radio_search():
    query = request.args.get('q')
    country = request.args.get('country')
    
    if not query and not country:
         # Default top stations if no query
         return jsonify(radio_api.get_top_stations(limit=20))
         
    if country and not query:
        return jsonify(radio_api.get_top_stations(country_code=country, limit=20))

    return jsonify(radio_api.search_stations(query))

# ---- TuneIn API endpoints ----

@app.route('/api/tunein/search', methods=['GET'])
def tunein_search():
    query = request.args.get('q', '')
    if not query:
        return jsonify(tunein_api.get_popular())
    return jsonify(tunein_api.search(query))

@app.route('/api/tunein/browse', methods=['GET'])
def tunein_browse():
    category = request.args.get('category', 'local')
    return jsonify(tunein_api.browse(category))

@app.route('/api/tunein/categories', methods=['GET'])
def tunein_categories():
    return jsonify(tunein_api.get_categories())

@app.route('/api/tunein/play', methods=['POST'])
def tunein_play():
    data = request.json
    device_id = data.get('device_id')
    guide_id = data.get('guide_id')
    name = data.get('name', 'Station')
    if not device_id or not guide_id:
        return jsonify({"success": False, "message": "Missing device_id or guide_id"})
    result = manager.play_tunein(device_id, guide_id, name)
    return jsonify(result)

import os

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)
