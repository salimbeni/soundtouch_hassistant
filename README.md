# SoundTouch Control App

A local web application to control Bose SoundTouch speakers. This app allows you to:
- Discover devices on your network.
- Play music from URLs.
- Group speakers into zones (multi-room audio).
- Save and manage favorite streams.

## Prerequisites
- Python 3
- Bose SoundTouch speakers on the same network.

## Installation

1.  Navigate to the project directory:
    ```bash
    cd "/Users/alessandrosalimbeni/Soundtouch App"
    ```

2.  Install dependencies:
    ```bash
    pip3 install -r requirements.txt
    ```

## Usage

1.  Start the application:
    ```bash
    python3 app.py
    ```

2.  Open your browser and go to:
    [http://localhost:5000](http://localhost:5000)

## Features

-   **Add Device**: If devices aren't auto-discovered, enter their IP address manually.
-   **Play URL**: Enter a stream URL (e.g., MP3 or PLS link) and select a device to play.
-   **Favorites**: Save your favorite stream URLs for quick access.
-   **Zones**: Click "Create Zone" on a speaker to group others with it. Use "Ungroup" on the master speaker to dissolve the zone.

## Notes
-   The app needs to run on a machine connected to the same WiFi/LAN as the speakers.
-   Ensure no firewall blocks port 5000 or the discovery protocols.
