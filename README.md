# SoundTouch Controller — Premium Web App

Eine moderne, intuitive Weboberfläche zur Steuerung deiner Bose SoundTouch Lautsprecher. Diese App bietet ein erstklassiges Erlebnis mit personalisierten Features und einer optimierten Benutzeroberfläche.

## ✨ Features

- **Personalisiertes Erlebnis**: Individuelle Begrüßung und Gerätenamen pro Browser-Sitzung.
- **Geführter Start (Wizard)**: Ein smarter Einrichtungsassistent beim Starten der App, um Lautsprecher zu gruppieren und Musik mit einem Klick zu starten.
- **Redesigned Grid**: Optimierte 2x3 Ansicht für deine Presets und Favoriten mit Sender-Logos.
- **Multi-Room Audio**: Erstelle und verwalte Zonen (Gruppen) für synchronisierte Wiedergabe in mehreren Räumen.
- **Umfangreiche Musiksuche**: Integration von TuneIn und RadioBrowser für tausende Radiosender weltweit.
- **Dark Mode Design**: Ein hochwertiges, dunkles Design mit flüssigen Animationen und Glasmorphismus-Effekten.

## 🏠 Home Assistant Integration (Empfohlen)

Diese App ist vollständig für **Home Assistant** optimiert und kann als lokales Add-on installiert werden.

- **Ingress Support**: Nahtlose Einbindung direkt in die Home Assistant Seitenleiste.
- **Dauerhafter Speicher**: Favoriten und Einstellungen bleiben sicher in Home Assistant gespeichert.

👉 Siehe **[INSTALL_HA.md](INSTALL_HA.md)** für die kinderleichte Installationsanleitung via GitHub.

## 🛠 Lokale Installation (Entwickler)

Wenn du die App manuell auf einem Computer oder Raspberry Pi (ohne Home Assistant) ausführen möchtest:

1. **Abhängigkeiten installieren**:
   ```bash
   pip3 install -r requirements.txt
   ```

2. **App starten**:
   ```bash
   python3 app.py
   ```

3. **Öffnen**:
   Gehe in deinem Browser auf `http://localhost:5001` (oder die IP deines Geräts).

## 📝 Voraussetzungen

- Python 3.9+
- Bose SoundTouch Lautsprecher im selben Netzwerk.

## 💡 Tipps
- Die App findet deine Lautsprecher im Netzwerk automatisch (Discovery).
- Falls ein Gerät nicht gefunden wird, kannst du es manuell über die IP-Adresse hinzufügen.
- Du kannst eigene Stream-URLs (MP3, PLS, M3U) als Favoriten speichern.
