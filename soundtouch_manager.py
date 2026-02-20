import json
import os
import threading
import time
import requests
from bosesoundtouchapi import SoundTouchDevice, SoundTouchClient, SoundTouchDiscovery, SoundTouchKeys
from bosesoundtouchapi.models import ContentItem, KeyStates

# Path to store favorites - Support Home Assistant persistent storage
DATA_DIR = "/data" if os.path.exists("/data") else "."
FAVORITES_FILE = os.path.join(DATA_DIR, "favorites.json")
KNOWN_DEVICES_FILE = os.path.join(DATA_DIR, "known_devices.json")

class CustomContentItem(ContentItem):
    """ContentItem subclass that injects mimeType into the XML request."""
    def __init__(self, mimeType=None, **kwargs):
        super().__init__(**kwargs)
        self._mimeType = mimeType

    def ToElement(self, isRequestBody=False):
        root = super().ToElement(isRequestBody)
        if self._mimeType:
            root.set('mimeType', self._mimeType)
        return root

class SoundTouchManager:
    def __init__(self):
        self.devices = {} # Mapping of DeviceID to SoundTouchClient object (not Device)
        self.favorites = self.load_favorites()
        self.lock = threading.Lock()
        self._stream_titles = {}  # Cache: device_id -> last played stream title
        
        # Pre-load known devices from file
        self.known_ips = self.load_known_devices()

    def load_known_devices(self):
        devices = []
        if os.path.exists(KNOWN_DEVICES_FILE):
            try:
                with open(KNOWN_DEVICES_FILE, 'r') as f:
                    data = json.load(f)
                    # Migration: Convert list of strings to list of dicts
                    if data and isinstance(data[0], str):
                         print("Migrating legacy device list...")
                         devices = [{"ip": ip, "name": "Unknown"} for ip in data]
                         self.save_known_devices(devices) # Save immediately in new format
                    else:
                        devices = data
                    
                    print(f"Loaded {len(devices)} known devices.")
                    return devices
            except Exception as e:
                print(f"Error loading known devices: {e}")
        
        # Default fallback if no file exists
        print("No known devices file found. Using defaults.")
        # Default objects
        defaults = [
            {"ip": "192.168.1.103", "name": "SoundTouch 103"},
            {"ip": "192.168.1.105", "name": "SoundTouch 105"},
            {"ip": "192.168.1.104", "name": "SoundTouch 104"}
        ]
        
        # Create the file immediately
        self.save_known_devices(defaults)
            
        return defaults

    def save_known_devices(self, devices=None):
        if devices is None:
            devices = self.known_ips
            
        try:
            with open(KNOWN_DEVICES_FILE, 'w') as f:
                json.dump(devices, f, indent=4)
        except Exception as e:
             print(f"Error saving known devices: {e}")

    def _update_known_device(self, ip, name):
        """Helper to update or add a device to the known list"""
        updated = False
        for dev in self.known_ips:
            if dev['ip'] == ip:
                if dev.get('name') != name:
                    dev['name'] = name
                    updated = True
                return # Already exists
        
        # If we get here, it's new
        self.known_ips.append({"ip": ip, "name": name})
        self.save_known_devices()

    def discover_devices(self):
        """
        Discovers SoundTouch devices on the network.
        Now uses parallel execution for known IPs to speed up startup.
        """
        # Manual add in parallel
        from concurrent.futures import ThreadPoolExecutor
        
        def try_add(device_info):
            ip = device_info.get('ip') if isinstance(device_info, dict) else device_info
            try:
                self.add_device(ip)
            except:
                pass

        # Use threads to check all IPs at once
        with ThreadPoolExecutor(max_workers=5) as executor:
            executor.map(try_add, self.known_ips)

        # Auto discovery (MDNS)
        try:
            print("Starting auto-discovery...")
            discovery = SoundTouchDiscovery(areDevicesVerified=True)
            time.sleep(1) 
            
            for device in discovery.VerifiedDevices.values():
                try:
                    if device.DeviceId not in self.devices:
                        client = SoundTouchClient(device)
                        with self.lock:
                            self.devices[device.DeviceId] = client
                        print(f"Auto-discovered: {device.DeviceName} ({device.Host})")
                        
                        # Update known list
                        self._update_known_device(device.Host, device.DeviceName)

                except Exception as e:
                    print(f"Error processing discovered device: {e}")
                    
        except Exception as e:
            print(f"Auto-discovery failed: {e}")

        return self.get_devices_status()

    def add_device(self, ip_address):
        """
        Manually adds a device by IP address.
        """
        try:
            device = SoundTouchDevice(ip_address)
            client = SoundTouchClient(device)
            # Verify connectivity by getting info
            if device.DeviceName:
                with self.lock:
                    self.devices[device.DeviceId] = client
                
                # Update known list
                self._update_known_device(ip_address, device.DeviceName)

                return {"success": True, "message": f"Added {device.DeviceName}", "device": self._serialize_client(client)}
        except Exception as e:
            print(f"Error adding device {ip_address}: {e}")
            return {"success": False, "message": str(e)}
        return {"success": False, "message": "Could not add device"}

    def get_devices_status(self):
        """
        Returns a list of devices and their current status, including offline known devices.
        """
        status_list = []
        active_ids = set()

        with self.lock:
            # 1. Add active devices
            for device_id, client in self.devices.items():
                try:
                    data = self._serialize_client(client)
                    status_list.append(data)
                    active_ids.add(client.Device.Host) # Use IP to match with known list
                except Exception:
                   pass
            
            # 2. Add offline known devices
            for known in self.known_ips:
                # known is now a dict {'ip': ..., 'name': ...}
                if isinstance(known, dict):
                    ip = known.get('ip')
                    name = known.get('name', 'Unknown')
                    if ip and ip not in active_ids:
                        # Try to check if it's actually alive by connecting directly
                        try:
                            # Quick check
                            test_client = SoundTouchDevice(ip)
                            status = test_client.status() # If this works, it's online!
                            
                            # Add as online device
                            status_list.append({
                                "id": test_client.config.deviceID,
                                "name": test_client.config.name,
                                "ip": ip,
                                "type": test_client.config.type,
                                "volume": 0, # Could fetch volume but keep it simple
                                "muted": False,
                                "playing": "STANDBY" if status.source == "STANDBY" else "PLAY_STATE",
                                "is_offline": False,
                                "now_playing": {
                                    # Basic info since we didn't do full fetch
                                    "track": "Bereit zur Wiedergabe", 
                                    "artist": status.source,
                                    "album": "",
                                    "art": None
                                },
                                "zone": None
                            })
                            active_ids.add(test_client.config.deviceID) # Mark as found 
                            continue # Skip adding as offline
                        except Exception:
                            # Really offline
                            pass

                        status_list.append({
                            "id": f"offline-{ip}", # specific ID for offline
                            "name": name,
                            "ip": ip,
                            "type": "Offline",
                            "volume": 0,
                            "muted": True,
                            "playing": "OFFLINE",
                            "is_offline": True,
                            "now_playing": {
                                "track": "Nicht erreichbar",
                                "artist": "",
                                "album": "",
                                "art": None
                            },
                            "zone": None
                        })
        
        return status_list

    def delete_known_device(self, ip):
        """Removes a device from the known list"""
        initial_len = len(self.known_ips)
        self.known_ips = [d for d in self.known_ips if (d.get('ip') if isinstance(d, dict) else d) != ip]
        
        if len(self.known_ips) < initial_len:
            self.save_known_devices()
            return {"success": True, "message": f"Removed {ip}"}
        return {"success": False, "message": "Device not found in known list"}

    def _serialize_client(self, client: SoundTouchClient):
        device = client.Device
        status = client.GetNowPlayingStatus() # Fetch latest status
        volume = client.GetVolume()
        zone = client.GetZoneStatus(refresh=True)
        
        # Fetch presets
        presets = []
        try:
             preset_list = client.GetPresetList()
             if preset_list:
                 for p in preset_list:
                     presets.append({
                         "id": p.PresetId,
                         "name": p.ContentItem.Name,
                         "source": p.ContentItem.Source,
                         "art": p.ContentItem.ContainerArt  # Extract artwork URL
                     })
        except Exception:
            pass
        
        track = status.Track
        artist = status.Artist
        album = status.Album
        image = status.ArtUrl
        if image == 'IMAGE_PRESENT':
            image = None
        
        # Fallback: use ContentItem fields when Track/Artist are not set (common with DLNA/UPNP)
        ci = status.ContentItem
        if not track and ci and ci.Name:
            track = ci.Name
        # Fallback: use cached stream title from play_url (DLNA streams have no name)
        if not track and device.DeviceId in self._stream_titles:
            track = self._stream_titles[device.DeviceId]
        if not artist and status.Source:
            artist = status.Source
        
        # Determine play status — DLNA/UPNP sometimes reports PlayStatus=None even when playing
        play_status = status.PlayStatus
        if not play_status and status.Source and status.Source not in ('STANDBY', 'INVALID_SOURCE'):
            # Device has an active source but no explicit play state — treat as playing
            if ci and ci.Location:
                play_status = 'PLAY_STATE'
        
        return {
            "id": device.DeviceId,
            "name": device.DeviceName,
            "ip": device.Host, 
            "type": device.DeviceType,
            "source": status.Source, # Added source field
            "volume": volume.Actual if volume else 0,
            "muted": volume.IsMuted if volume else False,
            "playing": play_status, 
            "now_playing": {
                "track": track,
                "artist": artist,
                "album": album,
                "art": image
            },
            "zone": self._get_zone_info(zone),
            "presets": presets
        }

    def _get_zone_info(self, zone):
        if zone and zone.MasterDeviceId:
           return {
               "master": zone.MasterDeviceId,
               "members": [m.DeviceId for m in zone.Members] # Members is a list of ZoneMember, need to check ZoneMember props
           }
        return None

    def play_url(self, device_id, url, title="Stream"):
        """Play a URL on a SoundTouch device using direct DLNA SOAP call."""
        
        with self.lock:
            client = self.devices.get(device_id)
            if not client:
                return {"success": False, "message": "Device not found"}
            
            host = client.Device.Host
            
            # Resolve redirects to get the final URL — might give us HTTP from HTTPS
            resolved_url = url
            try:
                resp = requests.get(url, stream=True, timeout=5, allow_redirects=True)
                resolved_url = resp.url
                resp.close()
                if resolved_url != url:
                    print(f"DEBUG: Resolved URL: {url} -> {resolved_url}")
            except Exception:
                pass  # Use original URL
            
            # If resolved URL is still HTTPS, try replacing with HTTP
            # Many radio streams are available on both protocols
            http_url = resolved_url
            if resolved_url.startswith("https://"):
                http_url = "http://" + resolved_url[len("https://"):]
                print(f"DEBUG: Trying HTTP fallback: {http_url}")
            
            # Strategy 1: Direct DLNA SOAP SetAVTransportURI  
            for try_url in ([http_url, resolved_url] if http_url != resolved_url else [resolved_url]):
                if not try_url.startswith("http://"):
                    continue  # DLNA only supports http://
                try:
                    dlna_port = 8091  # Standard SoundTouch DLNA port
                    soap_url = f"http://{host}:{dlna_port}/AVTransport/Control"
                    
                    # Escape XML special chars in URL
                    safe_url = try_url.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    
                    soap_body = f'''<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURIMetaData></CurrentURIMetaData>
      <CurrentURI>{safe_url}</CurrentURI>
    </u:SetAVTransportURI>
  </s:Body>
</s:Envelope>'''
                    
                    headers = {
                        "Content-Type": 'text/xml; charset="utf-8"',
                        "SOAPACTION": "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI",
                        "HOST": f"{host}:{dlna_port}",
                    }
                    
                    response = requests.post(soap_url, data=soap_body, headers=headers, timeout=5)
                    
                    if response.status_code == 200:
                        print(f"DEBUG: DLNA SOAP success with {try_url}")
                        self._stream_titles[device_id] = title
                        return {"success": True}
                    else:
                        print(f"DEBUG: DLNA SOAP failed ({response.status_code}) with {try_url}")
                except Exception as e:
                    print(f"DEBUG: DLNA SOAP error with {try_url}: {e}")
            
            # Strategy 2: TuneIn ContentItem (fallback for HTTPS-only streams)
            try:
                ci = ContentItem(
                    source="TUNEIN",
                    location=resolved_url,
                    name=title,
                    isPresetable=True
                )
                client.SelectContentItem(ci)
                return {"success": True}
            except Exception as e:
                print(f"DEBUG: TuneIn ContentItem failed: {e}")
            
            return {"success": False, "message": "Playback failed with all strategies"}

    def play_tunein(self, device_id, guide_id, name="Station"):
        """Play a TuneIn station natively on the SoundTouch device."""
        with self.lock:
            client = self.devices.get(device_id)
            if not client:
                return {"success": False, "message": "Device not found"}
            
            try:
                # Wake device if in standby
                status = client.GetNowPlayingStatus(True)
                if status.Source == 'STANDBY':
                    print(f"DEBUG: Device {device_id} in STANDBY, powering on...")
                    client.PowerOn()
                    time.sleep(3) # Give it good time to wake up
                
                ci = ContentItem(
                    source="TUNEIN",
                    typeValue="stationurl",
                    location=f"/v1/playback/station/{guide_id}",
                    sourceAccount="",
                    isPresetable=True,
                    name=name
                )

                # Retry loop to ensure command is accepted
                for attempt in range(1, 4):
                    print(f"DEBUG: Selecting ContentItem (attempt {attempt}): {name} ({guide_id})")
                    try:
                        client.SelectContentItem(ci)
                    except Exception as e:
                        print(f"DEBUG: SelectContentItem failed on attempt {attempt}: {e}")
                    
                    # Store title immediately
                    self._stream_titles[device_id] = name

                    # Wait a moment for device to process
                    time.sleep(1.5)
                    
                    # Verify if it worked
                    status = client.GetNowPlayingStatus(True)
                    print(f"DEBUG: Check status attempt {attempt}: Source={status.Source}, Track={status.ContentItem.Name if status.ContentItem else 'None'}")
                    
                    if status.Source == 'TUNEIN':
                        return {"success": True}
                    
                    if attempt < 3:
                        print("DEBUG: Source did not switch to TUNEIN, retrying...")
                        time.sleep(1)

                return {"success": False, "message": "Device did not switch to TuneIn after 3 attempts"}

            except Exception as e:
                print(f"DEBUG: TuneIn play error: {e}")
                return {"success": False, "message": f"TuneIn playback failed: {str(e)}"}

    def set_volume(self, device_id, level):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                client.SetVolumeLevel(int(level))
                time.sleep(1)
                return {"success": True}
        return {"success": False, "message": "Device not found"}
        
    def play_pause(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                client.Action(SoundTouchKeys.PLAY_PAUSE)
                return {"success": True}
        return {"success": False, "message": "Device not found"}
    
    def next_track(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                client.Action(SoundTouchKeys.NEXT_TRACK)
                return {"success": True}
        return {"success": False, "message": "Device not found"}
        
    def previous_track(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                client.Action(SoundTouchKeys.PREV_TRACK)
                return {"success": True}
        return {"success": False, "message": "Device not found"}

    def select_preset(self, device_id, preset_id, action='play'):
        # action: 'play' or 'store'
        if int(preset_id) < 1 or int(preset_id) > 6:
             return {"success": False, "message": "Preset must be 1-6"}

        with self.lock:
            client = self.devices.get(device_id)
            if client:
                if action == 'store':
                    # Use StorePreset API — works for all sources including UPNP/DLNA
                    try:
                        from bosesoundtouchapi.models import Preset
                        status = client.GetNowPlayingStatus()
                        if not status or not status.ContentItem:
                            return {"success": False, "message": "Nichts wird gerade abgespielt"}
                        ci = status.ContentItem
                        # Prioritize status.ArtUrl (Now Playing) over ci.ContainerArt
                        art_url = status.ArtUrl if status.ArtUrl and status.ArtUrl != 'IMAGE_PRESENT' else ci.ContainerArt
                        
                        preset = Preset(
                            presetId=int(preset_id),
                            source=ci.Source,
                            location=ci.Location,
                            sourceAccount=ci.SourceAccount,
                            isPresetable=True,
                            name=ci.Name or status.Track or "Stream",
                            containerArt=art_url
                        )
                        client.StorePreset(preset)
                        return {"success": True, "message": f"Preset {preset_id} gespeichert"}
                    except Exception as e:
                        return {"success": False, "message": f"Fehler: {str(e)}"}
                else:
                    # Play preset via key release
                    key_name = f"PRESET_{preset_id}"
                    try:
                        key = SoundTouchKeys[key_name]
                    except KeyError:
                        return {"success": False, "message": "Invalid preset key"}
                    client.Action(key, KeyStates.Release)
                    return {"success": True, "message": f"Playing Preset {preset_id}"}
        return {"success": False, "message": "Device not found"}

    def create_zone(self, master_id, member_ids):
        with self.lock:
            master_client = self.devices.get(master_id)
            if not master_client:
                 return {"success": False, "message": "Master device not found"}
            
            non_master_devices = []
            for m_id in member_ids:
                # We need SoundTouchDevice objects for creating zone
                slave_client = self.devices.get(m_id)
                if slave_client:
                    non_master_devices.append(slave_client.Device)
            
            if not non_master_devices:
                return {"success": False, "message": "No valid members found"}

            try:
                master_client.CreateZoneFromDevices(master_client.Device, non_master_devices)
                return {"success": True}
            except Exception as e:
                return {"success": False, "message": str(e)}

    def remove_zone(self, master_id):
         with self.lock:
            master_client = self.devices.get(master_id)
            if master_client:
                try:
                    # Get members before removing to stop them later
                    zone_status = master_client.GetZoneStatus(refresh=True)
                    members_to_stop = []
                    if zone_status and zone_status.Members:
                        for member in zone_status.Members:
                             members_to_stop.append(member.DeviceId)

                    print(f"Attempting to remove zone for master: {master_id}")
                    master_client.RemoveZone(delay=2) 
                    print("Zone removed successfully")
                    
                    # Explicitly stop former members
                    if members_to_stop:
                        print(f"Stopping members: {members_to_stop}")
                        time.sleep(1) # Wait a bit for zone removal to propagate
                        for m_id in members_to_stop:
                            if m_id == master_id:
                                continue
                            slave_client = self.devices.get(m_id)
                            if slave_client:
                                try:
                                    # Try to pause/stop the device
                                    slave_client.Action(SoundTouchKeys.MUTE) # Mute might be safer than PlayPause as we don't know state
                                    # User requested POWER OFF (Standby) when removing from group
                                    slave_client.Action(SoundTouchKeys.POWER)
                                except Exception as e:
                                    print(f"Could not stop slave {m_id}: {e}")

                    return {"success": True}
                except Exception as e:
                     print(f"Error removing zone: {e}")
                     return {"success": False, "message": str(e)}
         print(f"Master device not found: {master_id}")
         return {"success": False, "message": "Master device not found"}

    def remove_zone_slave(self, master_id, slave_id):
        with self.lock:
            master_client = self.devices.get(master_id)
            if not master_client:
                return {"success": False, "message": "Master device not found"}
            
            try:
                # Get current zone status
                zone = master_client.GetZoneStatus(refresh=True)
                if not zone or not zone.Members:
                    return {"success": False, "message": "No zone found"}
                
                # Filter out the slave to remove
                new_members = []
                slave_found = False
                for member in zone.Members:
                    if member.DeviceId == slave_id:
                        slave_found = True
                        continue # Skip this one
                    # Keep others (excluding master if it shows up in members list dependent on API, 
                    # but usually members list contains slaves. 
                    # SoundTouchAPI Zone.Members might include master? 
                    # CreateZone logic in client implies it inserts master if missing.
                    # Let's check if member.DeviceId is master?
                    if member.DeviceId == master_id:
                        continue # Master is implicit in CreateZone usually, or handled separately
                    new_members.append(member)
                
                if not slave_found:
                     print("Slave ID not found in current zone members.")
                     return {"success": False, "message": "Slave not found in zone"}

                # Stop the slave being removed
                print(f"Stopping slave {slave_id}...")
                slave_client = self.devices.get(slave_id)
                if slave_client:
                    try:
                        # User requested POWER OFF (Standby) when removing from group
                        slave_client.Action(SoundTouchKeys.POWER)
                    except Exception as e:
                        print(f"Error stopping slave: {e}")

                if not new_members:
                    # No slaves left, remove entire zone
                    print(f"No members left, destroying zone {master_id}")
                    master_client.RemoveZone()
                    return {"success": True, "message": "Zone dissolved"}
                else:
                    # Update zone with remaining members
                    print(f"Updating zone {master_id} with members {len(new_members)}")
                    from bosesoundtouchapi.models import Zone, ZoneMember
                    
                    # Construct Zone object
                    # We need ZoneMember objects. 
                    # The 'member' from GetZoneStatus is likely a ZoneMember or similar.
                    # Let's re-use IP and ID.
                    
                    z_members = []
                    for m in new_members:
                        # Ensure we have IP. GetZoneStatus might return it.
                        # ZoneMember property is IpAddress (case sensitive)
                        ip = m.IpAddress
                        if not ip:
                            # Fallback if IpAddress is missing (sometimes it is)
                            d = self.devices.get(m.DeviceId)
                            if d:
                                ip = d.Device.Host
                                
                        if ip:
                            z_members.append(ZoneMember(ip, m.DeviceId))
                        else:
                             print(f"Warning: Could not determine IP for member {m.DeviceId}, skipping re-add")
                        
                    if not z_members:
                        print("No valid members left to form a zone (IPs missing?), destroying zone.")
                        master_client.RemoveZone()
                        return {"success": True, "message": "Zone dissolved (no valid members)"}

                    if not z_members:
                        print("No valid members left to form a zone (IPs missing?), destroying zone.")
                        master_client.RemoveZone()
                        return {"success": True, "message": "Zone dissolved (no valid members)"}

                    print(f"Creating new zone with {len(z_members)} remaining slave members.")
                    # Workaround: Zone constructor might fail to add members if isinstance check fails or logic is buggy.
                    new_zone = Zone(master_id, master_client.Device.Host)
                    for m in z_members:
                         # Re-create ZoneMember to ensure it's clean (copy IP, ID, Role)
                         # properties represent the private fields, use them.
                         ip = m.IpAddress
                         if not ip:
                             d = self.devices.get(m.DeviceId)
                             if d: ip = d.Device.Host
                         
                         if ip:
                             # Pass role if available
                             role = m.DeviceRole if hasattr(m, 'DeviceRole') else None
                             zm = ZoneMember(ip, m.DeviceId, deviceRole=role)
                             new_zone.Members.append(zm)
                    
                    print(f"New Zone XML: {new_zone.ToXmlString()}")
                    master_client.CreateZone(new_zone)
                    print("CreateZone command sent successfully.")
                    
                    # Wait for devices to sync/update their status
                    print("Waiting for zone propagation...")
                    time.sleep(2)
                    
                    return {"success": True, "message": "Member removed"}

            except Exception as e:
                print(f"Error removing slave: {e}")
                return {"success": False, "message": str(e)}

    # --- Settings ---
    def get_device_settings(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if not client:
                return {"success": False, "message": "Device not found"}
            
            try:
                # Basic Info
                info = {
                    "name": client.Device.DeviceName,
                    "type": client.Device.DeviceType,
                    "id": client.Device.DeviceId,
                    "ip": client.Device.Host,
                    "mac": client.Device.MacAddress
                }

                # Audio Settings (Bass/Treble)
                # Note: Not all devices support this. SoundTouchAPI might raise error or return None.
                bass = 0
                treble = 0
                bass_cap = False
                treble_cap = False

                try:
                    # Check capabilities first if possible, or just try get
                    # The library might expose capabilities.
                    # Let's try getting level.
                    bass_obj = client.GetBassLevel()
                    if bass_obj:
                         bass = bass_obj.Actual
                         bass_cap = True
                    
                    treble_obj = client.GetTrebleLevel()
                    if treble_obj:
                         treble = treble_obj.Actual
                         treble_cap = True
                         
                except Exception:
                    # Likely not supported
                    pass

                return {
                    "success": True,
                    "info": info,
                    "audio": {
                        "bass": bass,
                        "treble": treble,
                        "bass_supported": bass_cap,
                        "treble_supported": treble_cap
                    }
                }
            except Exception as e:
                return {"success": False, "message": str(e)}

    def toggle_mute(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    client.Action(SoundTouchKeys.MUTE)
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}


    def set_bass(self, device_id, level):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    client.SetBassLevel(int(level))
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}

    def set_treble(self, device_id, level):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    client.SetTrebleLevel(int(level))
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}

    def select_source(self, device_id, source):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    # 'source' should be one of: AUX, BLUETOOTH, INTERNET_RADIO, SPOTIFY, AIRPLAY
                    # The library's SelectSource method typically takes the source string.
                    client.SelectSource(source)
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}

    def set_name(self, device_id, name):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    client.SetName(name)
                    # Update local cache immediately
                    client.Device.DeviceName = name
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}

    def reboot_device(self, device_id):
        with self.lock:
            client = self.devices.get(device_id)
            if client:
                try:
                    # Simulate power button hold or just power key?
                    # SoundTouchKeys.POWER is toggle.
                    # There isn't a direct "Reboot" command usually exposed easily.
                    # But we can try POWER key twice?
                    # actually the requested feature was "Neustart".
                    # Let's try to find a reboot way. 
                    # Providing "Standby" (Power toggle) is safer.
                    # client.Action(SoundTouchKeys.POWER)
                    
                    # Some devices support Reboot() method in library? No.
                    # We will implement Power Toggle for now as "Zwangs-Neustart" isn't standard api.
                    client.Action(SoundTouchKeys.POWER)
                    return {"success": True, "message": "Power signal sent"}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "Device not found"}

    # --- Favorites Handling ---
    def load_favorites(self):
        if os.path.exists(FAVORITES_FILE):
            try:
                with open(FAVORITES_FILE, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []

    def save_favorites(self):
        with open(FAVORITES_FILE, 'w') as f:
            json.dump(self.favorites, f, indent=4)

    def add_favorite(self, name, url, image=None, guide_id=None, type="url"):
        fav = {
            "name": name, 
            "url": url,
            "type": type
        }
        if image:
            fav["image"] = image
        if guide_id:
            fav["guide_id"] = guide_id
            
        self.favorites.append(fav)
        self.save_favorites()
        return {"success": True, "favorites": self.favorites}

    def remove_favorite(self, index):
        if 0 <= index < len(self.favorites):
            self.favorites.pop(index)
            self.save_favorites()
            return {"success": True, "favorites": self.favorites}
        return {"success": False, "message": "Invalid index"}

    def get_favorites_list(self):
        return self.favorites
