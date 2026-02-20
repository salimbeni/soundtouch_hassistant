from bosesoundtouchapi import SoundTouchClient
from bosesoundtouchapi import SoundTouchDevice
import time

ips = ["192.168.1.103", "192.168.1.104", "192.168.1.105"]

for ip in ips:
    print(f"\n--- Checking IP: {ip} ---")
    try:
        auth = SoundTouchDevice(ip, 8090)
        client = SoundTouchClient(auth)
        
        # Get Device Info to confirm identity
        print(f"Device Name: {client.Device.DeviceName}")
        print(f"Device ID: {client.Device.DeviceId}")
        
        print("Getting Now Playing status...")
        status = client.GetNowPlayingStatus()
        print(f"Source: {status.Source}")
        print(f"ContentItem: {status.ContentItem}")
        if status.ContentItem:
            print(f"  Location: {status.ContentItem.Location}")
            print(f"  SourceAccount: {status.ContentItem.SourceAccount}")
            print(f"  TypeName: {status.ContentItem.TypeValue}") # Corrected from TypeName to TypeValue based on previous inspect
            print(f"  IsPresetable: {status.ContentItem.IsPresetable}")
            print(f"  ContainerArt: {status.ContentItem.ContainerArt}")
            
    except Exception as e:
        print(f"Error checking {ip}: {e}")
