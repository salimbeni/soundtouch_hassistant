/* ============================================
   SoundTouch Controller — App Logic
   ============================================ */

// --- Helpers ---
function getApiUrl(path) {
    const base = window.INGRESS_PATH || '';
    // Ensure path starts with / but base doesn't end with /
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return cleanBase + cleanPath;
}

// --- State ---
const state = {
    devices: [],
    selectedDeviceId: null,
    pollInterval: null,
    volumeDragging: false,
    currentView: 'devices', // 'player', 'devices', 'detail', 'presets', 'radio'
    presets: [],
    favorites: [],
    isLoadingStream: false,
    pendingStreamTitle: null,
    radioSource: 'tunein', // 'tunein' or 'radiobrowser'
};

// --- Play State Helper ---
function isDevicePlaying(device) {
    if (!device || !device.playing) return false;
    const s = String(device.playing).toUpperCase();
    return s === 'PLAY_STATE' || s === 'BUFFERING_STATE' ||
        s.includes('PLAY') && !s.includes('PAUSE') && !s.includes('STOP');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    // Trigger background scan
    fetch(getApiUrl('/api/scan'), { method: 'POST' }).catch(console.error);
    fetchDevices();
    fetchFavorites();
    state.pollInterval = setInterval(fetchDevices, 2000);
    initVolumeSlider();
    setupEventListeners();

    // Personalization
    handleIntro();
    initPersonalization();
});

// --- Personalization ---
function handleIntro() {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;

    // Show intro only once per session
    if (!sessionStorage.getItem('introShown')) {
        // Play animation
        setTimeout(() => {
            splash.classList.add('hidden');
            sessionStorage.setItem('introShown', 'true');
            // Check for wizard launch after intro
            checkWizardLaunch();
        }, 2500); // 2.5s total duration
    } else {
        // Hide immediately
        splash.style.display = 'none';
        splash.classList.add('hidden');
        checkWizardLaunch();
    }
}

function checkWizardLaunch() {
    // Launch wizard if not suppressed and user has a name (so they've done the basic setup)
    // We can use a session flag to only show it once per session if desired, OR show it on every fresh load.
    // User request: "beim starten , so wie eine geführter lauf gibt" -> implied every start?
    // Let's show it if we have a name, but maybe not if we just reloaded?
    // For now, let's show it if it's a new session.

    if (localStorage.getItem('soundtouch_username') && !sessionStorage.getItem('wizardShown')) {
        setTimeout(() => {
            startGuidedRun();
            sessionStorage.setItem('wizardShown', 'true');
        }, 500);
    }
}

function initPersonalization() {
    const name = localStorage.getItem('soundtouch_username');
    if (name) {
        updateGreeting(name);
    } else {
        // Show welcome modal after a slight delay if it's the first visit
        // But only if we are past the intro
        setTimeout(() => {
            if (!localStorage.getItem('soundtouch_username_skipped')) {
                const modal = document.getElementById('modal-welcome');
                if (modal) modal.classList.add('open');
            }
        }, 3000);
    }
}

function saveWelcomeName() {
    const input = document.getElementById('welcome-name-input');
    const name = input.value.trim();
    if (name) {
        localStorage.setItem('soundtouch_username', name);
        updateGreeting(name);
        closeModal('modal-welcome');
        showToast(`Hallo, ${name}!`);
        // Launch wizard after name setup
        setTimeout(startGuidedRun, 1000);
    }
}

// --- Guided Wizard ---
let wizardSelectedDevices = [];

function startGuidedRun() {
    const modal = document.getElementById('modal-wizard');
    if (modal) {
        modal.classList.add('open');
        renderWizardDevices();
        wizardGoToStep(1);
    }
}

function wizardGoToStep(step) {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    document.getElementById(`wizard-step-${step}`).classList.add('active');
}

function wizardNextStep() {
    // Logic for Step 1 -> 2
    // If multiple devices selected, create zone
    if (wizardSelectedDevices.length === 0) {
        showToast('Bitte wähle mindestens einen Lautsprecher', 'error');
        return;
    }

    if (wizardSelectedDevices.length > 1) {
        const masterId = wizardSelectedDevices[0];
        const members = wizardSelectedDevices.slice(1);
        apiCreateZone(masterId, members);
        state.selectedDeviceId = masterId; // Select master
    } else {
        state.selectedDeviceId = wizardSelectedDevices[0];
    }

    // Proceed to content selection
    renderWizardContent();
    wizardGoToStep(2);
}

function wizardPrevStep() {
    wizardGoToStep(1);
}

function renderWizardDevices() {
    const list = document.getElementById('wizard-device-list');
    if (!state.devices || state.devices.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px;">Keine Lautsprecher gefunden...</div>';
        return;
    }

    list.innerHTML = state.devices.map(d => {
        const isOffline = d.is_offline;
        return `
        <div class="wizard-device-card ${isOffline ? 'offline' : ''}" 
             onclick="${isOffline ? '' : `toggleWizardDevice('${d.id}', this)`}">
            <div class="wizard-checkbox"></div>
            <div class="device-info">
                <div class="device-name">${d.name}</div>
                <div class="device-status">${isOffline ? 'Offline' : (d.source || 'Bereit')}</div>
            </div>
        </div>`;
    }).join('');

    wizardSelectedDevices = [];
}

function toggleWizardDevice(id, el) {
    if (wizardSelectedDevices.includes(id)) {
        wizardSelectedDevices = wizardSelectedDevices.filter(x => x !== id);
        el.classList.remove('selected');
    } else {
        wizardSelectedDevices.push(id);
        el.classList.add('selected');
    }
}

function renderWizardContent() {
    const list = document.getElementById('wizard-content-list');

    // We combine presets and favorites
    const device = getSelectedDevice();
    const presets = device ? (device.presets || []) : [];

    let html = '<div class="wizard-content-grid">';

    // Presets
    presets.forEach(p => {
        const hasArt = p.art && p.art.length > 0;
        const content = hasArt
            ? `<img src="${p.art}" class="wizard-item-img" alt="${p.name}">`
            : `<div class="wizard-item-icon">📻</div>`;

        html += `
        <div class="wizard-content-item-new" onclick="wizardPlayPreset(${p.id})">
            ${content}
            <div class="wizard-item-overlay">
                <div class="wizard-item-name">${p.name || 'Preset ' + p.id}</div>
            </div>
            <div class="wizard-item-badge">${p.id}</div>
        </div>`;
    });

    // Favorites
    state.favorites.forEach((f, idx) => {
        // Check for image or icon
        const hasArt = f.image && f.image.length > 0;
        const content = hasArt
            ? `<img src="${f.image}" class="wizard-item-img" alt="${f.name}">`
            : `<div class="wizard-item-icon">⭐</div>`;

        html += `
        <div class="wizard-content-item-new" onclick="wizardPlayFavorite('${f.url}', '${f.name}')">
            ${content}
            <div class="wizard-item-overlay">
                <div class="wizard-item-name">${f.name}</div>
            </div>
        </div>`;
    });

    html += '</div>';
    list.innerHTML = html;
}

function wizardPlayPreset(id) {
    const device = getSelectedDevice();
    if (device) {
        apiPlayPreset(device.id, id);
        closeModal('modal-wizard');
    }
}

function wizardPlayFavorite(url, name) {
    const device = getSelectedDevice();
    if (device) {
        apiPlayUrl(device.id, url, name);
        closeModal('modal-wizard');
    }
}

function updateGreeting(name) {
    const title = document.getElementById('top-bar-title');
    if (title) {
        // Time based greeting
        const hour = new Date().getHours();
        let greeting = 'Hallo';
        if (hour < 11) greeting = 'Guten Morgen';
        else if (hour < 18) greeting = 'Guten Tag';
        else greeting = 'Guten Abend';

        title.textContent = `${greeting}, ${name}`;
        title.style.textTransform = 'none'; // Overwrite uppercase style
    }
}

// Override closeSidebar to check for skip preference
const originalCloseModal = window.closeModal || function (id) {
    document.getElementById(id).classList.remove('open');
};

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'modal-welcome') {
        // If closed without saving, maybe mark as skipped to not annoy?
        // Let's just set a flag so it doesn't pop up every single refresh immediately
        if (!localStorage.getItem('soundtouch_username')) {
            localStorage.setItem('soundtouch_username_skipped', 'true');
        }
    }
}

// --- API Calls ---
async function fetchDevices() {
    try {
        const res = await fetch(getApiUrl('/api/devices'));
        state.devices = await res.json();
        renderDevices();
        // Don't overwrite the optimistic loading state with stale data
        if (!state.isLoadingStream) {
            updatePlayerView();
        }
        updateBottomBar();
    } catch (e) {
        console.error('Failed to fetch devices:', e);
    }
}

async function fetchFavorites() {
    try {
        const res = await fetch(getApiUrl('/api/favorites'));
        state.favorites = await res.json();
        renderFavorites();
    } catch (e) {
        console.error('Failed to fetch favorites:', e);
    }
}

async function apiControl(deviceId, action, value = null) {
    try {
        await fetch(getApiUrl('/api/control'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, action, value })
        });
        setTimeout(fetchDevices, 500);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiPlayPreset(deviceId, presetId) {
    try {
        await fetch(getApiUrl('/api/preset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, preset_id: presetId, action: 'play' })
        });
        setTimeout(fetchDevices, 1000);
        showToast(`Preset ${presetId} wird abgespielt`);
        switchView('player');
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiStorePreset(deviceId, presetId) {
    try {
        const res = await fetch(getApiUrl('/api/preset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, preset_id: presetId, action: 'store' })
        });
        const data = await res.json();
        showToast(data.message || `Preset ${presetId} gespeichert`);
        setTimeout(fetchDevices, 1000);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiCreateZone(masterId, memberIds) {
    try {
        await fetch(getApiUrl('/api/zone'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ master_id: masterId, members: memberIds })
        });
        showToast('Gruppe erstellt');
        setTimeout(fetchDevices, 2000);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiRemoveZone(masterId) {
    try {
        await fetch(getApiUrl('/api/zone'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ master_id: masterId, action: 'remove' })
        });
        showToast('Gruppe aufgelöst');
        setTimeout(fetchDevices, 1000);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiRemoveZoneMember(masterId, slaveId) {
    try {
        await fetch(getApiUrl('/api/zone/remove_member'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterId, slaveId })
        });
        showToast('Lautsprecher entfernt');
        setTimeout(fetchDevices, 1000);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiAddDevice(ip) {
    try {
        const res = await fetch(getApiUrl('/api/device/add'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Gerät hinzugefügt!');
            fetchDevices();
        } else {
            showToast('Fehler: ' + data.message, 'error');
        }
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiPlayUrl(deviceId, url, title = 'Stream') {
    // Set loading state and clear old track info immediately
    state.isLoadingStream = true;
    state.pendingStreamTitle = title;
    const dev = state.devices.find(d => d.id === deviceId);
    if (dev) {
        dev.now_playing = { track: null, artist: null, album: null, art: null };
        dev.playing = null;
    }
    updatePlayerView();

    try {
        const res = await fetch(getApiUrl('/api/play'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, url, title })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`▶ ${title}`, 'success');
            // Poll quickly to catch the device status change
            for (let i = 0; i < 5; i++) {
                await new Promise(r => setTimeout(r, 1500));
                await fetchDevices();
                const dev = state.devices.find(d => d.id === deviceId);
                if (dev && isDevicePlaying(dev)) break;
            }
        } else {
            showToast('Fehler: ' + (data.message || 'Unbekannt'), 'error');
        }
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    } finally {
        state.isLoadingStream = false;
        state.pendingStreamTitle = null;
        updatePlayerView();
    }
}

async function apiAddFavorite(name, url, image, guideId, type) {
    try {
        await fetch(getApiUrl('/api/favorites'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, image, guide_id: guideId, type })
        });
        fetchFavorites();
        showToast('Favorit gespeichert');
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiDeleteFavorite(index) {
    try {
        await fetch(getApiUrl('/api/favorites'), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
        });
        fetchFavorites();
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

// --- View Management ---
function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${viewName}`);
    if (view) view.classList.add('active');
    state.currentView = viewName;
    updateTabBar();
    updateTopBarTitle();
}

function updateTopBarTitle() {
    const titles = {
        player: '',
        devices: 'Lautsprecher',
        detail: '',
        presets: 'Presets & Favoriten',
        radio: ''
    };
    const el = document.getElementById('top-bar-title');
    if (el) el.textContent = titles[state.currentView] || '';
}

function updateTabBar() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === state.currentView);
    });
}


// --- Sidebar ---
function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    document.getElementById('sidebar').classList.toggle('open', state.sidebarOpen);
    document.getElementById('sidebar-overlay').classList.toggle('open', state.sidebarOpen);
}

function closeSidebar() {
    state.sidebarOpen = false;
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

// --- Render Devices ---
function renderDevices() {
    const container = document.getElementById('device-list');
    if (!container) return;

    if (state.devices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-text">Suche nach Lautsprechern...</div>
            </div>`;
        return;
    }

    // Auto-select first available device if none selected
    if (!state.selectedDeviceId && state.devices.length > 0) {
        // Prefer online devices
        const onlineDev = state.devices.find(d => !d.is_offline);
        state.selectedDeviceId = onlineDev ? onlineDev.id : state.devices[0].id;
    }

    const list = document.getElementById('device-list');
    list.innerHTML = state.devices.map(d => {
        const isSelected = state.selectedDeviceId === d.id;
        const isOffline = d.is_offline || false;
        const isPlaying = d.playing === 'PLAY_STATE';

        // Status Text Logic
        let nowPlayingText = 'Bereit';

        if (isOffline) {
            nowPlayingText = 'Offline';
        } else if (d.now_playing && d.now_playing.track) {
            const artist = d.now_playing.artist ? ` — ${d.now_playing.artist}` : '';
            nowPlayingText = `${d.now_playing.track}${artist}`;
        } else if (d.source === 'STANDBY') {
            nowPlayingText = 'Standby';
        } else if (d.source) {
            nowPlayingText = d.source; // e.g. "AUX", "BLUETOOTH"
        }

        // Zone Badge
        let badge = '';
        if (d.zone && d.zone.master === d.id) badge = '<span class="device-badge master">📡 Hauptgerät</span>';
        if (d.zone && d.zone.master !== d.id) badge = '<span class="device-badge slave">🔗 Verbunden</span>';

        return `
        <div class="device-card ${isSelected ? 'selected' : ''} ${isOffline ? 'offline' : ''}" 
             onclick="${isOffline ? '' : `selectDevice('${d.id}')`}">
             
            <div class="device-card-top">
                <div class="device-card-icon">
                    ${d.type && d.type.includes('10') ? '🔈' : '🔊'}
                </div>
                
                <div class="device-info">
                    <div class="device-name">
                        ${d.name} ${badge}
                    </div>
                    <div class="device-status">${nowPlayingText}</div>
                </div>

                ${isOffline ?
                `<button class="device-del-btn" onclick="deleteDevice('${d.ip}', event)" title="Entfernen">✕</button>` :
                `<div class="device-card-actions">
                        <button class="device-action-btn" onclick="event.stopPropagation(); openSettingsModal('${d.id}')" title="Einstellungen">⚙️</button>
                        <button class="device-action-btn" onclick="event.stopPropagation(); openMultiroomModal('${d.id}')" title="Multiroom / Gruppen">🔗</button>
                        <button class="device-action-btn" onclick="event.stopPropagation(); openSourceModal('${d.id}')" title="Quelle wählen">📡</button>
                        <button class="device-power-btn" onclick="event.stopPropagation(); togglePower('${d.id}')" title="An/Aus">⏻</button>
                    </div>`
            }
            </div>

            ${!isOffline ? `
            <div class="device-card-bottom">
                <div class="device-card-volume">
                    <div class="device-mini-slider">
                        <div class="device-mini-slider-fill" style="width: ${d.volume || 0}%"></div>
                    </div>
                    <div class="device-card-vol-label">Lautstärke ${d.volume || 0}%</div>
                </div>
                <div class="device-card-controls">
                    <button class="device-mini-btn" onclick="event.stopPropagation(); apiControl('${d.id}', 'prev')">⏮</button>
                    <button class="device-mini-btn" onclick="event.stopPropagation(); apiControl('${d.id}', '${isPlaying ? 'pause' : 'play'}')">
                        ${isPlaying ? '⏸' : '▶'}
                    </button>
                    <button class="device-mini-btn" onclick="event.stopPropagation(); apiControl('${d.id}', 'next')">⏭</button>
                </div>
            </div>` : ''}
        </div>`;
    }).join('');
}

// --- Specific Modal Logic ---

// Multiroom / Zone
let currentMultiroomMasterId = null;

function openMultiroomModal(deviceId) {
    currentMultiroomMasterId = deviceId;
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) return;

    document.getElementById('multiroom-master-name').textContent = device.name;
    const container = document.getElementById('multiroom-list');

    // Filter out the master itself and offline devices
    const others = state.devices.filter(d => d.id !== deviceId && !d.is_offline);

    container.innerHTML = others.map(d => {
        // Check if already a slave of this master
        const isSlave = d.zone && d.zone.master === deviceId && d.zone.master !== d.id;
        return `
        <label class="multiroom-item">
            <input type="checkbox" value="${d.id}" ${isSlave ? 'checked' : ''}>
            <span class="multiroom-name">${d.name}</span>
        </label>`;
    }).join('');

    document.getElementById('modal-multiroom').classList.add('open');
}

async function saveMultiroom() {
    if (!currentMultiroomMasterId) return;

    const checkboxes = document.querySelectorAll('#multiroom-list input[type="checkbox"]');
    const membersToAdd = [];
    const membersToRemove = [];

    checkboxes.forEach(cb => {
        if (cb.checked) membersToAdd.push(cb.value);
        else membersToRemove.push(cb.value); // Logic to remove needs API support or we just set the new zone
    });

    // Simple approach: Create zone with selected members
    // API `apiCreateZone` expects masterId and list of memberIds
    if (membersToAdd.length > 0) {
        await apiCreateZone(currentMultiroomMasterId, membersToAdd);
    } else {
        // If no members selected, maybe we want to dissolve the zone? 
        // For now, let's just remove the zone if it exists
        await apiRemoveZone(currentMultiroomMasterId);
    }

    closeModal('modal-multiroom');
}

// Source
let currentSourceDeviceId = null;

function openSourceModal(deviceId) {
    currentSourceDeviceId = deviceId;
    document.getElementById('modal-source').classList.add('open');
}

function selectSource(source) {
    if (!currentSourceDeviceId) return;
    // Map simplified source to API expected source if needed
    // Assuming API takes 'AUX', 'BLUETOOTH', etc.
    // We might need a specific API call for switching source. 
    // `apiPlayUrl` is for URLs. We probably need `apiSelectSource`.
    // I'll assume `apiControl(id, 'select_source', source)` works or implement it.
    // Looking at previous `app.js`, `apiControl` takes `action, value`.
    // Let's try action='source' value=source.
    apiControl(currentSourceDeviceId, 'source', source);
    showToast(`Quelle auf ${source} geändert`);
    closeModal('modal-source');
}

// Settings (Update existing openSettingsModal to accept ID)
function openSettingsModal(deviceId) {
    // If deviceId provided, use it. If not (legacy call?), ignore or use selected.
    const id = deviceId || (state.devices.find(d => d.id === state.selectedDeviceId)?.id);
    if (!id) return;

    currentSettingsDeviceId = id; // reuse existing var if possible, or define new
    // ... existing logic to populate modal ...
    // I need to reuse the existing `openSettingsModal` logic but make sure it uses the passed ID.
    // Since I'm replacing `renderDevices`, I have control.

    // Reuse existing logic but ensure we fetch for THIS device
    const device = state.devices.find(d => d.id === id);
    if (!device) return;

    document.getElementById('settings-name').value = device.name;
    document.getElementById('settings-ip').textContent = device.ip;
    document.getElementById('settings-id').textContent = device.id;
    document.getElementById('settings-type').textContent = device.type;

    document.getElementById('modal-settings').classList.add('open');
}

async function deleteDevice(ip, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Möchten Sie den Lautsprecher mit IP ${ip} wirklich entfernen?`)) return;

    try {
        const res = await fetch(getApiUrl('/api/device/forget'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: ip })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Lautsprecher entfernt');
            // Refresh logic to be added if not auto-refreshing
            fetchDevices();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Fehler beim Entfernen', 'error');
    }
}

// --- Select Device ---
function selectDevice(deviceId) {
    state.selectedDeviceId = deviceId;
    renderDevices();
    updatePlayerView();
    updateBottomBar();
    switchView('player');
}

// --- Player View ---
function updatePlayerView() {
    const device = getSelectedDevice();
    if (!device) return;

    const np = device.now_playing || {};
    const isPlaying = isDevicePlaying(device);

    // Art
    const artContainer = document.getElementById('player-art-container');
    if (artContainer) {
        if (np.art) {
            artContainer.innerHTML = `<img src="${np.art}" class="player-art" alt="Album Art">`;
            // Update background
            const bg = document.getElementById('player-bg');
            if (bg) bg.style.backgroundImage = `url(${np.art})`;
        } else {
            artContainer.innerHTML = `<div class="player-art-placeholder">🎵</div>`;
            const bg = document.getElementById('player-bg');
            if (bg) bg.style.backgroundImage = '';
        }
    }

    // Track info
    const trackEl = document.getElementById('player-track-name');
    const artistEl = document.getElementById('player-artist-name');
    if (trackEl) trackEl.textContent = np.track || 'Bereit zur Wiedergabe';
    if (artistEl) artistEl.textContent = np.artist || device.name;

    // Status
    const statusEl = document.getElementById('player-status');
    if (statusEl) {
        if (state.isLoadingStream) {
            statusEl.innerHTML = '<span class="loading-dot-pulse"></span> Wird geladen…';
        } else if (isPlaying) {
            statusEl.innerHTML = '<span class="live-badge">LIVE</span> Läuft gerade';
        } else if (np.track) {
            statusEl.textContent = 'Pausiert';
        } else {
            statusEl.textContent = 'Lautsprecher ist zur Wiedergabe bereit.';
        }
    }

    // If loading, show pending title optimistically
    if (state.isLoadingStream && state.pendingStreamTitle) {
        if (trackEl && !np.track) trackEl.textContent = state.pendingStreamTitle;
        if (artistEl && !np.artist) artistEl.textContent = 'Radio';
    }

    // Play/Pause button
    const playBtn = document.getElementById('player-play-btn');
    if (playBtn) {
        playBtn.innerHTML = isPlaying ? '⏸' : '▶';
        playBtn.classList.toggle('playing', isPlaying);
    }

    // Transport (Next/Prev) Visibility
    const prevBtn = document.getElementById('player-prev-btn');
    const nextBtn = document.getElementById('player-next-btn');
    // Sources that support skipping
    const skippableSources = ['SPOTIFY', 'BLUETOOTH', 'AIRPLAY', 'STORED_MUSIC'];
    const showTransport = device.source && skippableSources.includes(device.source);

    if (prevBtn) prevBtn.style.display = showTransport ? 'inline-block' : 'none';
    if (nextBtn) nextBtn.style.display = showTransport ? 'inline-block' : 'none';

    // Volume
    if (!state.volumeDragging) {
        updateVolumeSlider(device.volume);
    }

    // Mute Status
    updateMuteIcon(device.muted);

    // Group Volumes
    renderGroupVolumes(device);
}

function renderGroupVolumes(device) {
    const container = document.getElementById('player-group-volumes');
    if (!container) return;

    // Show only if this device is a Master of a zone
    const slaves = state.devices.filter(d => d.zone && d.zone.master === device.id && d.id !== device.id);

    if (slaves.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';

    // We show the Master (Current) + Slaves
    // Actually user wants "change volume for both", meaning main slider controls all relative?
    // SoundTouch Master volume usually scales all.
    // "unten dran anzeigen wenn ich nur eine ändere möchte" -> Show individual sliders below.

    const members = [device, ...slaves];

    container.innerHTML = members.map(m => `
        <div class="group-volume-item">
            <div class="group-volume-name">${m.name}</div>
            <button class="volume-btn" style="width:28px; height:28px; font-size:1rem;" onclick="changeMemberVolume('${m.id}', -5)">-</button>
            <div class="group-volume-track" onclick="event.stopPropagation()">
                <div class="group-volume-fill" id="grp-vol-fill-${m.id}" style="width: ${m.volume}%"></div>
            </div>
            <button class="volume-btn" style="width:28px; height:28px; font-size:1rem;" onclick="changeMemberVolume('${m.id}', 5)">+</button>
            <div class="group-volume-val" id="grp-vol-val-${m.id}">${m.volume}</div>
        </div>
    `).join('');
}

// --- Volume Slider ---
function initVolumeSlider() {
    const track = document.getElementById('volume-slider-track');
    if (!track) return;

    let isDragging = false;

    function setVolumeFromEvent(e) {
        const rect = track.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const vol = Math.round(ratio * 100);
        updateVolumeSlider(vol);
        return vol;
    }

    track.addEventListener('mousedown', (e) => {
        isDragging = true;
        state.volumeDragging = true;
        track.classList.add('dragging');
        setVolumeFromEvent(e);
    });

    track.addEventListener('touchstart', (e) => {
        isDragging = true;
        state.volumeDragging = true;
        track.classList.add('dragging');
        setVolumeFromEvent(e);
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) setVolumeFromEvent(e);
    });

    document.addEventListener('touchmove', (e) => {
        if (isDragging) setVolumeFromEvent(e);
    }, { passive: true });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            state.volumeDragging = false;
            track.classList.remove('dragging');
            commitVolume();
        }
    });

    document.addEventListener('touchend', () => {
        if (isDragging) {
            isDragging = false;
            state.volumeDragging = false;
            track.classList.remove('dragging');
            commitVolume();
        }
    });

    // Click on track
    track.addEventListener('click', (e) => {
        const vol = setVolumeFromEvent(e);
        commitVolumeValue(vol);
    });
}

function updateVolumeSlider(vol) {
    const fill = document.getElementById('volume-slider-fill');
    const label = document.getElementById('volume-value');
    if (fill) fill.style.width = vol + '%';
    if (label) label.textContent = vol;
}

function commitVolume() {
    const fill = document.getElementById('volume-slider-fill');
    if (!fill) return;
    const vol = Math.round(parseFloat(fill.style.width));
    commitVolumeValue(vol);
}

function commitVolumeValue(vol) {
    const device = getSelectedDevice();
    if (device) {
        // Optimistic update of local state to prevent jumpiness on next poll
        device.volume = vol;
        apiControl(device.id, 'volume', vol);
    }
}

function changeVolume(delta) {
    const device = getSelectedDevice();
    if (device) {
        let newVol = device.volume + delta;
        newVol = Math.max(0, Math.min(100, newVol));
        updateVolumeSlider(newVol);
        commitVolumeValue(newVol);
    }
}

function playerMuteToggle() {
    const device = getSelectedDevice();
    if (device) {
        // Optimistic update
        const newMuteState = !device.muted;
        updateMuteIcon(newMuteState);

        fetch(getApiUrl(`/api/device/${device.id}/mute`), { method: 'POST' })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    // Success
                } else {
                    // Revert on failure
                    updateMuteIcon(!newMuteState);
                    showToast('Fehler beim Muten', 'error');
                }
            });
    }
}

function updateMuteIcon(isMuted) {
    const icon = document.getElementById('player-volume-icon');
    if (icon) {
        if (isMuted) {
            icon.textContent = '🔇';
            icon.style.opacity = '0.7';
        } else {
            icon.textContent = '🔊';
            icon.style.opacity = '1';
        }
    }
}


function changeMemberVolume(id, delta) {
    const device = state.devices.find(d => d.id === id);
    if (device) {
        let newVol = device.volume + delta;
        newVol = Math.max(0, Math.min(100, newVol));
        apiControl(id, 'volume', newVol);
        // Optimistic update
        const fill = document.getElementById(`grp-vol-fill-${id}`);
        const val = document.getElementById(`grp-vol-val-${id}`);
        if (fill) fill.style.width = newVol + '%';
        if (val) val.textContent = newVol;
    }
}

// --- Bottom Bar ---
function updateBottomBar() {
    // Bottom bar removed — tab-bar is now used for navigation
}

// --- Detail View Removed ---

// --- Presets View ---
function showPresetsView() {
    renderPresets();
    renderFavorites();
    switchView('presets');
}

function renderPresets() {
    const container = document.getElementById('preset-list');
    if (!container) return;

    const device = getSelectedDevice();
    const presets = device ? (device.presets || []) : [];

    container.innerHTML = [1, 2, 3, 4, 5, 6].map(i => {
        const p = presets.find(x => x.id === i);
        const name = p ? (p.name || `Preset ${i}`) : 'Leer';
        const hasContent = !!p;
        const deviceId = device ? device.id : null;

        // Artwork logic - prioritized
        let thumbContent = '';
        if (p && p.art) {
            thumbContent = `<img src="${p.art}" class="preset-card-img" alt="${name}">`;
        } else {
            // Generic icon based on name or default
            thumbContent = `<div class="preset-card-icon">📻</div>`;
        }

        // Small number badge
        const numberBadge = `<div class="preset-card-badge">${i}</div>`;

        return `
        <div class="preset-card-new ${!hasContent ? 'empty' : ''}" 
             onclick="${hasContent && deviceId ? `apiPlayPreset('${deviceId}', ${i})` : ''}">
             ${hasContent ? thumbContent : '<div class="preset-card-icon" style="opacity:0.3">+</div>'}
             ${hasContent ? numberBadge : ''}
             <div class="preset-card-overlay">
                <div class="preset-card-name">${name}</div>
             </div>
        </div>`;
    }).join('');
}

function storeToPreset(presetId) {
    const device = getSelectedDevice();
    if (device) {
        apiStorePreset(device.id, presetId);
    }
}

// --- Favorites ---
function renderFavorites() {
    const container = document.getElementById('favorites-list-items');
    if (!container) return;

    if (state.favorites.length === 0) {
        container.innerHTML = `
        < div style = "text-align:center; color: var(--text-tertiary); padding: 20px; font-size: 0.85rem;" >
            Zum Speichern eines Favoriten tippen...
            </div > `;
        return;
    }

    container.innerHTML = state.favorites.map((fav, idx) => {
        const logoHtml = fav.image ?
            `<img src="${fav.image}" class="fav-logo" style="width:20px; height:20px; border-radius:3px; margin-right:8px; vertical-align:middle;">` :
            `<span class="fav-heart">♥</span>`;

        return `
        <div class="fav-item">
            ${logoHtml}
            <div class="fav-name">${fav.name}</div>
            <button class="fav-play-btn" onclick="playFavorite(${idx})" title="Abspielen">▶</button>
            <button class="fav-del-btn" onclick="deleteFavorite(${idx})" title="Löschen">✕</button>
        </div>
        `;
    }).join('');
}

function playFavorite(idx) {
    const fav = state.favorites[idx];
    const device = getSelectedDevice();

    if (!fav || !device) {
        if (!device) showToast('Bitte zuerst einen Lautsprecher wählen', 'error');
        return;
    }

    if (fav.type === 'tunein' && fav.guide_id) {
        playTuneInStation(fav.guide_id, fav.name);
    } else {
        // Fallback for old favorites or URL type
        const imageUrl = fav.image || '';
        playRadioStation(fav.url, fav.name, imageUrl);
    }
}
function deleteFavorite(idx) {
    apiDeleteFavorite(idx);
}

// --- Radio Search ---

function switchRadioSource(source) {
    state.radioSource = source;
    document.getElementById('tab-tunein').classList.toggle('active', source === 'tunein');
    document.getElementById('tab-radiobrowser').classList.toggle('active', source === 'radiobrowser');
    clearRadioSearch();
}

function handleRadioInput(event) {
    const input = document.getElementById('radio-search-input');
    const clearBtn = document.getElementById('radio-clear-btn');

    if (input && clearBtn) {
        clearBtn.style.display = input.value.length > 0 ? 'flex' : 'none';
    }

    if (event.key === 'Enter') {
        searchRadio();
    }
}

function clearRadioSearch() {
    const input = document.getElementById('radio-search-input');
    if (input) {
        input.value = '';
        input.focus();
        handleRadioInput({ key: '' });

        const container = document.getElementById('radio-results');
        if (container) {
            container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📻</div>
            <div class="empty-state-text">${state.radioSource === 'tunein' ? 'TuneIn Radio – Suche nach Sendern.' : 'Suche nach Radiosendern aus der ganzen Welt.'}</div>
            <div class="suggestion-chips" id="radio-chips">
                <span class="chip" onclick="searchRadio('Jazz')">Jazz</span>
                <span class="chip" onclick="searchRadio('News')">News</span>
                <span class="chip" onclick="searchRadio('Rock')">Rock</span>
                <span class="chip" onclick="searchRadio('SRF')">SRF</span>
                <span class="chip" onclick="searchRadio('SWR')">SWR</span>
            </div>
        </div>`;
        }
    }
}

async function searchRadio(queryOverride) {
    const input = document.getElementById('radio-search-input');
    const query = queryOverride || (input ? input.value : '');

    if (queryOverride && input) input.value = queryOverride;

    const container = document.getElementById('radio-results');
    if (container) {
        container.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
        </div>`;
    }

    try {
        if (state.radioSource === 'tunein') {
            const res = await fetch(getApiUrl(`/api/tunein/search?q=${encodeURIComponent(query)}`));
            const stations = await res.json();
            renderTuneInResults(stations);
        } else {
            const res = await fetch(getApiUrl(`/api/radio/search?q=${encodeURIComponent(query)}`));
            const stations = await res.json();
            renderRadioResults(stations);
        }
    } catch (e) {
        if (container) {
            container.innerHTML = `<div class="empty-state-text">Fehler bei der Suche: ${e.message}</div>`;
        }
    }
}

function renderRadioResults(stations) {
    const container = document.getElementById('radio-results');
    if (!container) return;

    if (stations.length === 0) {
        container.innerHTML = `<div class="empty-state-text">Keine Sender gefunden.</div>`;
        return;
    }

    container.innerHTML = stations.map(s => {
        const favicon = s.favicon || '';
        const bitrate = s.bitrate ? `<span class="radio-bitrate">${s.bitrate}k</span>` : '';
        const tags = s.tags ? s.tags.split(',').slice(0, 3).join(', ') : '';

        const imgHtml = favicon ?
            `<img src="${favicon}" class="radio-logo" onerror="this.src='/static/img/radio_placeholder.png'; this.onerror=null; this.style.opacity=0.5">` :
            `<div class="radio-logo-placeholder">📻</div>`;

        return `
        <div class="radio-item" onclick="playRadioStation('${s.url}', '${s.name.replace(/'/g, "&apos;")}', '${s.favicon || ''}')">
            <div class="radio-img-col">
                ${imgHtml}
            </div>
            <div class="radio-info-col">
                <div class="radio-name">${s.name}</div>
                <div class="radio-meta">${s.country || ''} ${tags ? '• ' + tags : ''} ${bitrate}</div>
            </div>
            <button class="radio-play-btn">▶</button>
            <button class="radio-fav-btn" onclick="event.stopPropagation(); openAddFavoriteModal('${s.name.replace(/'/g, "&apos;")}', '${s.url}')">♥</button>
        </div>
        `;
    }).join('');
}

function renderTuneInResults(stations) {
    const container = document.getElementById('radio-results');
    if (!container) return;

    if (stations.length === 0) {
        container.innerHTML = `<div class="empty-state-text">Keine Sender gefunden.</div>`;
        return;
    }

    container.innerHTML = stations.map(s => {
        const imgHtml = s.image ?
            `<img src="${s.image}" class="radio-logo" onerror="this.src='/static/img/radio_placeholder.png'; this.onerror=null; this.style.opacity=0.5">` :
            `<div class="radio-logo-placeholder">📻</div>`;
        const nowPlaying = s.now_playing ? `<div class="radio-meta">♪ ${s.now_playing}</div>` : '';
        const bitrate = s.bitrate ? `<span class="radio-bitrate">${s.bitrate}k</span>` : '';

        return `
        <div class="radio-item" onclick="playTuneInStation('${s.guide_id}', '${s.name.replace(/'/g, "&apos;")}')">
            <div class="radio-img-col">
                ${imgHtml}
            </div>
            <div class="radio-info-col">
                <div class="radio-name">${s.name} ${bitrate}</div>
                ${nowPlaying}
            </div>
            <button class="radio-play-btn">▶</button>
            <button class="radio-fav-btn" onclick="event.stopPropagation(); openAddFavoriteModal('${s.name.replace(/'/g, "&apos;")}', '', '${s.image || ''}', '${s.guide_id}', 'tunein')">♥</button>
        </div>
        `;
    }).join('');
}

function playRadioStation(url, name, textArt) {
    const device = getSelectedDevice();
    if (!device) {
        showToast('Bitte zuerst einen Lautsprecher wählen', 'error');
        return;
    }
    switchView('player');
    apiPlayUrl(device.id, url, name);
}

function playTuneInStation(guideId, name) {
    const device = getSelectedDevice();
    if (!device) {
        showToast('Bitte zuerst einen Lautsprecher wählen', 'error');
        return;
    }

    // Switch to player view immediately with loading state
    switchView('player');
    state.isLoadingStream = true;
    state.pendingStreamTitle = name;
    const dev = state.devices.find(d => d.id === device.id);
    if (dev) {
        dev.now_playing = { track: null, artist: null, album: null, art: null };
        dev.playing = null;
    }
    updatePlayerView();

    fetch(getApiUrl('/api/tunein/play'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: device.id, guide_id: guideId, name: name })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast(`Spielt: ${name} `, 'success');
                // Poll faster for 10 seconds to pick up the new track info
                let polls = 0;
                const fastPoll = setInterval(async () => {
                    await fetchDevices();
                    const d = state.devices.find(d => d.id === device.id);
                    if (d && isDevicePlaying(d)) {
                        state.isLoadingStream = false;
                        state.pendingStreamTitle = null;
                        updatePlayerView();
                        clearInterval(fastPoll);
                    }
                    polls++;
                    if (polls >= 7) {
                        state.isLoadingStream = false;
                        state.pendingStreamTitle = null;
                        updatePlayerView();
                        clearInterval(fastPoll);
                    }
                }, 1500);
            } else {
                showToast(data.message || 'Wiedergabe fehlgeschlagen', 'error');
                state.isLoadingStream = false;
                state.pendingStreamTitle = null;
                updatePlayerView();
            }
        })
        .catch(e => {
            showToast(`Fehler: ${e.message} `, 'error');
            state.isLoadingStream = false;
            state.pendingStreamTitle = null;
            updatePlayerView();
        });
}

// --- Modals ---
function openAddFavoriteModal(name, url, image, guideId, type) {
    if (name) document.getElementById('fav-name-input').value = name.replace(/&apos;/g, "'");
    else document.getElementById('fav-name-input').value = '';

    if (url) document.getElementById('fav-url-input').value = url;
    else document.getElementById('fav-url-input').value = '';

    // Set hidden fields
    document.getElementById('fav-image-input').value = image || '';
    document.getElementById('fav-guide-id-input').value = guideId || '';
    document.getElementById('fav-type-input').value = type || 'url';

    document.getElementById('modal-add-fav').classList.add('open');
}

// --- Settings Helper Functions ---

function populateSettingsModal(data) {
    // General
    document.getElementById('settings-name').value = data.info.name;
    document.getElementById('settings-ip').textContent = data.info.ip;
    document.getElementById('settings-id').textContent = data.info.id;
    document.getElementById('settings-type').textContent = data.info.type;

    // Audio
    const bassSlider = document.getElementById('range-bass');
    const trebleSlider = document.getElementById('range-treble');

    if (data.audio.bass_supported) {
        bassSlider.value = data.audio.bass;
        bassSlider.disabled = false;
        document.getElementById('val-bass').textContent = data.audio.bass;
    } else {
        bassSlider.value = 0;
        bassSlider.disabled = true;
        document.getElementById('val-bass').textContent = 'N/A';
    }

    if (data.audio.treble_supported) {
        trebleSlider.value = data.audio.treble;
        trebleSlider.disabled = false;
        document.getElementById('val-treble').textContent = data.audio.treble;
    } else {
        trebleSlider.value = 0;
        trebleSlider.disabled = true;
        document.getElementById('val-treble').textContent = 'N/A';
    }
}

function switchSettingsTab(tabName) {
    // Tabs
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));

    // Activate
    const btn = document.querySelector(`.settings - tab[onclick *= '${tabName}']`);
    if (btn) btn.classList.add('active');

    const pane = document.getElementById(`settings - tab - ${tabName} `);
    if (pane) pane.classList.add('active');
}

function updateRangeVal(type, val) {
    document.getElementById(`val - ${type} `).textContent = val;
}

function saveDeviceName() {
    const device = getSelectedDevice();
    const newName = document.getElementById('settings-name').value;
    if (!device || !newName) return;

    fetch(getApiUrl(`/api/device/${device.id}/settings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
    })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast('Name gespeichert');
                // Refresh device list to show new name
                fetchDevices();
            } else {
                showToast('Fehler: ' + res.results?.name?.message || 'Unbekannt', 'error');
            }
        })
        .catch(err => showToast('Fehler beim Speichern', 'error'));
}

function saveAudioSettings() {
    const device = getSelectedDevice();
    const bass = document.getElementById('range-bass').value;
    const treble = document.getElementById('range-treble').value;

    if (!device) return;

    fetch(getApiUrl(`/api/device/${device.id}/settings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bass: parseInt(bass),
            treble: parseInt(treble)
        })
    })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast('Audio-Einstellungen gespeichert');
            } else {
                showToast('Fehler beim Speichern', 'error');
            }
        });
}

function rebootDevice() {
    const device = getSelectedDevice();
    if (!device) return;

    if (!confirm('Möchtest du den Lautsprecher wirklich neu starten?')) return;

    fetch(getApiUrl(`/api/device/${device.id}/reboot`), { method: 'POST' })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast('Neustart-Signal gesendet');
                closeModal('modal-settings');
            } else {
                showToast('Fehler: ' + res.message, 'error');
            }
        });
}

function togglePower() {
    const device = getSelectedDevice();
    if (!device) return;

    // No confirm needed for simple power toggle
    fetch(getApiUrl(`/api/device/${device.id}/power`), { method: 'POST' })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast('Ein/Aus Signal gesendet');
            } else {
                showToast('Fehler: ' + res.message, 'error');
            }
        })
        .catch(err => showToast('Kommunikationsfehler', 'error'));
}

function closeAddFavoriteModal() {
    document.getElementById('modal-add-fav').classList.remove('open');
}

function submitAddFavorite() {
    const name = document.getElementById('fav-name-input').value.trim();
    const url = document.getElementById('fav-url-input').value.trim();
    const image = document.getElementById('fav-image-input').value;
    const guideId = document.getElementById('fav-guide-id-input').value;
    const type = document.getElementById('fav-type-input').value;

    if (!name || (!url && type === 'url')) {
        showToast('Name und URL benötigt', 'error');
        return;
    }

    // For TuneIn, URL might be empty, but guideId is required
    if (type === 'tunein' && !guideId) {
        showToast('TuneIn ID fehlt', 'error');
        return;
    }

    apiAddFavorite(name, url, image, guideId, type);

    // Clear fields
    document.getElementById('fav-name-input').value = '';
    document.getElementById('fav-url-input').value = '';
    document.getElementById('fav-image-input').value = '';
    document.getElementById('fav-guide-id-input').value = '';
    document.getElementById('fav-type-input').value = 'url';

    closeAddFavoriteModal();
}

function openZoneModal(masterId) {
    const device = state.devices.find(d => d.id === masterId);
    if (!device) return;

    document.getElementById('zone-modal-master-name').textContent = device.name;
    const checkboxContainer = document.getElementById('zone-modal-checkboxes');

    const available = state.devices.filter(d => d.id !== masterId && (!d.zone));

    if (available.length === 0) {
        checkboxContainer.innerHTML = '<div style="text-align:center; color:var(--text-tertiary); padding: 20px;">Keine verfügbaren Lautsprecher</div>';
    } else {
        checkboxContainer.innerHTML = available.map(d => `
            <div class="modal-checkbox-item">
                <input type="checkbox" class="zone-cb" value="${d.id}" id="zone-cb-${d.id}">
                <label for="zone-cb-${d.id}">${d.name}</label>
            </div>
        `).join('');
    }

    document.getElementById('modal-zone').classList.add('open');
    document.getElementById('modal-zone').dataset.masterId = masterId;
}

function closeZoneModal() {
    document.getElementById('modal-zone').classList.remove('open');
}

function submitZone() {
    const modal = document.getElementById('modal-zone');
    const masterId = modal.dataset.masterId;
    const checked = document.querySelectorAll('.zone-cb:checked');
    const memberIds = Array.from(checked).map(cb => cb.value);

    if (memberIds.length === 0) {
        showToast('Bitte mindestens einen Lautsprecher wählen', 'error');
        return;
    }

    apiCreateZone(masterId, memberIds);
    closeZoneModal();
}

function openPlayUrlModal() {
    document.getElementById('modal-play-url').classList.add('open');
}

function closePlayUrlModal() {
    document.getElementById('modal-play-url').classList.remove('open');
}

function submitPlayUrl() {
    const url = document.getElementById('play-url-input').value.trim();
    const title = document.getElementById('play-url-title').value.trim() || 'Stream';
    if (!url) {
        showToast('URL benötigt', 'error');
        return;
    }
    const device = getSelectedDevice();
    if (device) {
        apiPlayUrl(device.id, url, title);
        closePlayUrlModal();
        document.getElementById('play-url-input').value = '';
        document.getElementById('play-url-title').value = '';
    } else {
        showToast('Bitte zuerst einen Lautsprecher wählen', 'error');
    }
}

// --- Add Device ---
function submitAddDevice() {
    const input = document.getElementById('add-device-ip');
    const ip = input.value.trim();
    if (!ip) return;
    apiAddDevice(ip);
    input.value = '';
}

// --- Helpers ---
function getSelectedDevice() {
    return state.devices.find(d => d.id === state.selectedDeviceId) || null;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// --- Event Listeners ---
function setupEventListeners() {
    // Sidebar overlay click
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // Modal overlay clicks
    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m) m.classList.remove('open');
        });
    });

    // Page dots
    document.querySelectorAll('.page-dot').forEach(dot => {
        dot.addEventListener('click', () => switchView(dot.dataset.view));
    });

    // Detail volume slider
    const detailVolTrack = document.getElementById('detail-vol-track');
    if (detailVolTrack) {
        detailVolTrack.addEventListener('click', (e) => {
            const rect = detailVolTrack.getBoundingClientRect();
            let ratio = (e.clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            const vol = Math.round(ratio * 100);
            const device = getSelectedDevice();
            if (device) {
                apiControl(device.id, 'volume', vol);
                const fill = document.getElementById('detail-vol-fill');
                const label = document.getElementById('detail-vol-label');
                if (fill) fill.style.width = vol + '%';
                if (label) label.textContent = vol + '%';
            }
        });
    }
}

// --- Swipe / Drag Navigation ---
const swipeNav = { startX: 0, startY: 0, active: false };

function handleSwipeEnd(endX, endY) {
    if (state.volumeDragging || state.sidebarOpen) return;
    const deltaX = endX - swipeNav.startX;
    const deltaY = endY - swipeNav.startY;

    if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        const views = ['player', 'devices', 'detail', 'presets'];
        const idx = views.indexOf(state.currentView);

        if (deltaX < 0 && idx < views.length - 1) {
            switchView(views[idx + 1]);
        } else if (deltaX > 0 && idx > 0) {
            switchView(views[idx - 1]);
        }
    }
}

// Touch events (mobile)
document.addEventListener('touchstart', (e) => {
    swipeNav.startX = e.touches[0].clientX;
    swipeNav.startY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
    handleSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
}, { passive: true });

// Mouse drag events (desktop)
document.addEventListener('mousedown', (e) => {
    // Ignore clicks on buttons, inputs, sliders
    if (e.target.closest('button, input, .volume-slider-track, .modal-overlay, .sidebar, .device-card-controls')) return;
    swipeNav.startX = e.clientX;
    swipeNav.startY = e.clientY;
    swipeNav.active = true;
});

document.addEventListener('mousemove', (e) => {
    if (swipeNav.active) {
        // Add a visual cursor hint while dragging
        document.body.style.cursor = 'grabbing';
    }
});

document.addEventListener('mouseup', (e) => {
    if (swipeNav.active) {
        swipeNav.active = false;
        document.body.style.cursor = '';
        handleSwipeEnd(e.clientX, e.clientY);
    }
});
