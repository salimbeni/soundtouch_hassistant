# SoundTouch App - Home Assistant Installation Guide

Du kannst diese App entweder manuell oder viel komfortabler direkt über **GitHub** als Add-on installieren.

## Methode 1: GitHub (Empfohlen)

Dies ist der beste Weg, da du Updates einfach über die Home Assistant Oberfläche installieren kannst.

1. **GitHub Repository erstellen**:
   Erstelle ein neues (öffentliches) Repository auf GitHub (z.B. `soundtouch-app`) und lade alle Dateien aus diesem Ordner dort hoch.

2. **Repository in Home Assistant hinzufügen**:
   - Gehe zu **Einstellungen** > **Add-ons** > **Add-on Store**.
   - Klicke oben rechts auf die drei Punkte (...) und wähle **Repositories**.
   - Füge die URL deines GitHub-Repositories hinzu (`https://github.com/salimbeni/soundtouch_hassistant`).
   - Klicke auf **Hinzufügen** und schließe das Fenster.

3. **Installieren**:
   - Suche im Add-on Store nach **SoundTouch App** (evtl. einmal die Seite neu laden).
   - Klicke auf **INSTALLIEREN**.

---

## Methode 2: Manuelle Installation (Lokal)

Nutze diese Methode, wenn du keinen GitHub-Account nutzen möchtest.

1. **Ordner erstellen**:
   Navigiere in deinem Home Assistant Dateisystem zum Ordner `/addons`. Erstelle dort einen neuen Unterordner namens `soundtouch_app`.

2. **Dateien kopieren**:
   Kopiere den **gesamten Inhalt** deines Projekts in diesen neuen Ordner `/addons/soundtouch_app/`.
   Stelle sicher, dass folgende Dateien dabei sind:
   - `app.py`
   - `soundtouch_manager.py`
   - `Dockerfile`
   - `config.yaml`
   - `requirements.txt`
   - `static/` (Ordner)
   - `templates/` (Ordner)

3. **Add-on Store aktualisieren**:
   - Gehe in Home Assistant zu **Einstellungen** > **Add-ons**.
   - Klicke unten rechts auf **Add-on Store**.
   - Klicke oben rechts auf die drei Punkte (...) und wähle **Check for updates** (Nach Updates suchen).

4. **Add-on installieren**:
   - Scrolle ganz nach unten zum Bereich **Local Add-ons**.
   - Dort sollte die **SoundTouch App** erscheinen. Klicke darauf.
   - Klicke auf **INSTALLIEREN**.

5. **Starten & Konfigurieren**:
   - Aktiviere nach der Installation die Optionen **Watchdog** und **In Seitenleiste anzeigen**.
   - Klicke auf **STARTEN**.
   - Nach wenigen Sekunden kannst du über den Button **BENUTZEROBERFLÄCHE ÖFFNEN** oder über den Reiter in der Seitenleiste auf die App zugreifen.

## Tipps
- Die App nutzt den `host` Netzwerkmodus, um deine Lautsprecher im Heimnetzwerk automatisch zu finden.
- Deine Favoriten werden sicher in Home Assistant gespeichert, auch wenn du das Add-on aktualisierst.
