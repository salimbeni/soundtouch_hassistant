/* ============================================
   SoundTouch Controller — App Logic (Bosman Style)
   ============================================ */

function getApiUrl(path) {
    const base = window.INGRESS_PATH || '';
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return cleanBase + cleanPath;
}

const state = {
    devices: [],
    selectedDeviceId: null,
    pollInterval: null,
    volumeDragging: false,
    currentView: 'startseite',
    favorites: [],
    isLoadingStream: false,
    pendingStreamTitle: null,
    radioSource: 'tunein'
};

function getSelectedDevice() {
    return state.devices.find(d => d.id === state.selectedDeviceId) || state.devices[0];
}

function isDevicePlaying(device) {
    if (!device || !device.playing) return false;
    const s = String(device.playing).toUpperCase();
    return s === 'PLAY_STATE' || s === 'BUFFERING_STATE' ||
        (s.includes('PLAY') && !s.includes('PAUSE') && !s.includes('STOP'));
}

document.addEventListener('DOMContentLoaded', () => {
    fetch(getApiUrl('/api/scan'), { method: 'POST' }).catch(console.error);
    fetchDevices();
    fetchFavorites();
    state.pollInterval = setInterval(fetchDevices, 2000);
    initVolumeSlider();
    
    // Fallback empty search
    searchRadio();
});

/* --- API --- */
async function fetchDevices() {
    try {
        const res = await fetch(getApiUrl('/api/devices'));
        state.devices = await res.json();
        
        // Auto-select first online device if none selected
        if (!state.selectedDeviceId && state.devices.length > 0) {
            const onlineDev = state.devices.find(d => !d.is_offline);
            state.selectedDeviceId = onlineDev ? onlineDev.id : state.devices[0].id;
        }
        
        updateUI();
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
    if (!deviceId) return;
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
        showToast(`Preset ${presetId} wird abgespielt`);
        setTimeout(fetchDevices, 1000);
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    }
}

async function apiPlayUrl(deviceId, url, title = 'Stream') {
    state.isLoadingStream = true;
    state.pendingStreamTitle = title;
    updatePlayerView();

    try {
        const res = await fetch(getApiUrl('/api/play'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, url, title })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`▶ ${title}`);
            setTimeout(fetchDevices, 1500);
        } else {
            showToast('Fehler: ' + data.message, 'error');
        }
    } catch (e) {
        showToast('Fehler: ' + e.message, 'error');
    } finally {
        state.isLoadingStream = false;
        updatePlayerView();
    }
}

/* --- UI Updates --- */
function updateUI() {
    const device = getSelectedDevice();
    if (device) {
        document.getElementById('active-device-name').textContent = device.name;
    }
    
    if (state.currentView === 'startseite') {
        renderPresets();
        updatePlayerView();
    }
    if (state.currentView === 'settings') {
        updateSettingsView();
    }
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    
    state.currentView = viewName;
    updateUI();
}

/* --- Device Selector Modal --- */
function openDeviceSelector() {
    const list = document.getElementById('device-list');
    list.innerHTML = state.devices.map(d => `
        <div class="sheet-item" onclick="selectDevice('${d.id}')">
            <div>
                <div style="font-weight: 600; margin-bottom: 2px;">${d.name}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary);">${d.is_offline ? 'Offline' : (d.source || 'Bereit')}</div>
            </div>
            ${state.selectedDeviceId === d.id ? '<div style="color:var(--accent);">✓</div>' : ''}
        </div>
    `).join('');
    
    document.getElementById('modal-device-selector').classList.add('open');
}

function selectDevice(id) {
    state.selectedDeviceId = id;
    closeModal('modal-device-selector');
    updateUI();
}

/* --- Presets --- */
let presetPressTimer = null;
let isLongPress = false;

function renderPresets() {
    const container = document.getElementById('preset-list');
    if (!container) return;

    const device = getSelectedDevice();
    const presets = device ? (device.presets || []) : [];

    container.innerHTML = [1, 2, 3, 4, 5, 6].map(i => {
        const p = presets.find(x => x.id === i);
        const name = p ? (p.name || `Preset ${i}`) : '';
        const hasContent = !!p;
        const deviceId = device ? device.id : null;

        let artHtml = '';
        if (p && p.art) {
            artHtml = `<img src="${p.art}" class="preset-art" alt="${name}">`;
        }

        const events = deviceId ? `
            onmousedown="handlePresetPressStart('${deviceId}', ${i}, this)" 
            onmouseup="handlePresetPressEnd('${deviceId}', ${i}, this)"
            onmouseleave="clearTimeout(presetPressTimer);"
            ontouchstart="handlePresetPressStart('${deviceId}', ${i}, this); event.preventDefault();"
            ontouchend="handlePresetPressEnd('${deviceId}', ${i}, this); event.preventDefault();"
        ` : '';

        return `
        <div class="preset-card" ${events}>
            ${artHtml}
            <div class="preset-number">${i}</div>
            ${hasContent ? `<div class="preset-name">${name}</div>` : ''}
        </div>`;
    }).join('');
}

function handlePresetPressStart(deviceId, presetId, element) {
    isLongPress = false;
    presetPressTimer = setTimeout(() => {
        isLongPress = true;
        showToast(`Speichere Preset ${presetId}...`);
        fetch(getApiUrl('/api/preset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, preset_id: presetId, action: 'store' })
        }).then(() => setTimeout(fetchDevices, 1000));
    }, 800);
}

function handlePresetPressEnd(deviceId, presetId, element) {
    clearTimeout(presetPressTimer);
    if (!isLongPress) {
        apiPlayPreset(deviceId, presetId);
    }
    isLongPress = false;
}

/* --- Favorites / Recent --- */
function renderFavorites() {
    const container = document.getElementById('favorites-list-items');
    if (!container) return;

    if (state.favorites.length === 0) {
        container.innerHTML = `<div style="font-size:0.85rem; color:var(--text-tertiary);">Keine Favoriten vorhanden.</div>`;
        return;
    }

    container.innerHTML = state.favorites.map((fav, idx) => {
        const img = fav.image ? `<img src="${fav.image}">` : `<div style="font-size:2rem; opacity:0.5;">⭐</div>`;
        return `
        <div class="recent-card" onclick="playFavorite(${idx})">
            <div class="recent-img-box">${img}</div>
            <div class="recent-title">${fav.name}</div>
        </div>
        `;
    }).join('');
}

function playFavorite(idx) {
    const fav = state.favorites[idx];
    const device = getSelectedDevice();
    if (!fav || !device) return;

    if (fav.type === 'tunein' && fav.guide_id) {
        // Tunein special handler if needed, or fallback to URL
        apiPlayUrl(device.id, '', fav.name); // Usually tunein needs custom endpoint, falling back to URL approach for now or adding TuneIn logic here.
    } else {
        apiPlayUrl(device.id, fav.url, fav.name);
    }
}

/* --- Player View --- */
function updatePlayerView() {
    const device = getSelectedDevice();
    if (!device) return;

    const np = device.now_playing || {};
    const isPlaying = isDevicePlaying(device);

    document.getElementById('player-track-name').textContent = state.isLoadingStream && state.pendingStreamTitle ? state.pendingStreamTitle : (np.track || device.source || 'Bereit');
    document.getElementById('player-artist-name').textContent = np.artist || (isPlaying ? 'Läuft' : '');

    const playBtn = document.getElementById('player-play-btn');
    if (playBtn) playBtn.innerHTML = isPlaying ? '⏸' : '▶';

    const skippable = ['SPOTIFY', 'BLUETOOTH', 'AIRPLAY', 'STORED_MUSIC'].includes(device.source);
    document.getElementById('player-prev-btn').style.display = skippable ? 'block' : 'none';
    document.getElementById('player-next-btn').style.display = skippable ? 'block' : 'none';

    if (!state.volumeDragging) {
        document.getElementById('volume-slider-fill').style.width = (device.volume || 0) + '%';
    }
    
    document.getElementById('player-volume-icon').textContent = device.muted ? '🔇' : '🔊';
}

function playerPlayPause() {
    const d = getSelectedDevice();
    if (d) apiControl(d.id, 'play_pause');
}

function playerMuteToggle() {
    const d = getSelectedDevice();
    if (d) apiControl(d.id, 'volume', d.volume > 0 ? 0 : 30); // Simple mute toggle
}

function togglePower() {
    const d = getSelectedDevice();
    if (d) {
        fetch(getApiUrl(`/api/device/${d.id}/power`), { method: 'POST' });
        showToast('Power Signal gesendet');
    }
}

/* --- Volume Slider --- */
function initVolumeSlider() {
    const track = document.getElementById('volume-slider-track');
    if (!track) return;

    let isDragging = false;

    function setVolume(e) {
        const rect = track.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const vol = Math.round(ratio * 100);
        document.getElementById('volume-slider-fill').style.width = vol + '%';
        return vol;
    }

    track.addEventListener('mousedown', (e) => { isDragging = true; state.volumeDragging = true; setVolume(e); });
    track.addEventListener('touchstart', (e) => { isDragging = true; state.volumeDragging = true; setVolume(e); }, { passive: true });
    
    document.addEventListener('mousemove', (e) => { if (isDragging) setVolume(e); });
    document.addEventListener('touchmove', (e) => { if (isDragging) setVolume(e); }, { passive: true });
    
    const stopDrag = () => {
        if (isDragging) {
            isDragging = false; state.volumeDragging = false;
            const vol = Math.round(parseFloat(document.getElementById('volume-slider-fill').style.width));
            const d = getSelectedDevice();
            if (d) apiControl(d.id, 'volume', vol);
        }
    };
    
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
}

/* --- Radio Search & Filters --- */
let searchTimeout = null;

function setRadioSource(source) {
    state.radioSource = source;
    document.getElementById('btn-src-tunein').classList.toggle('active', source === 'tunein');
    document.getElementById('btn-src-radiobrowser').classList.toggle('active', source === 'radiobrowser');
    searchRadio();
}

function openFilterModal() {
    document.getElementById('modal-filter').classList.add('open');
}

function applyFilters() {
    closeModal('modal-filter');
    
    const countryVal = document.getElementById('filter-country').value;
    const langVal = document.getElementById('filter-language').value;
    
    let labels = [];
    if (countryVal) labels.push(countryVal);
    if (langVal) {
        const langText = document.getElementById('filter-language').options[document.getElementById('filter-language').selectedIndex].text;
        labels.push(langText);
    }
    
    document.getElementById('active-filters-label').textContent = labels.length > 0 ? labels.join(' · ') : 'Alle Filter';
    
    searchRadio();
}

function handleRadioInput(event) {
    const val = event.target.value;
    document.getElementById('radio-clear-btn').style.display = val ? 'block' : 'none';
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchRadio();
    }, 500);
}

function clearRadioSearch() {
    document.getElementById('radio-search-input').value = '';
    document.getElementById('radio-clear-btn').style.display = 'none';
    searchRadio();
}

async function searchRadio() {
    const query = document.getElementById('radio-search-input').value;
    const country = document.getElementById('filter-country') ? document.getElementById('filter-country').value : '';
    const language = document.getElementById('filter-language') ? document.getElementById('filter-language').value : '';
    
    const container = document.getElementById('radio-results');
    
    let endpoint = state.radioSource === 'radiobrowser' ? '/api/radio/search' : '/api/tunein/search';
    let params = new URLSearchParams();
    
    if (query) params.append('q', query);
    if (country) params.append('country', country);
    if (language) params.append('language', language);
    
    let url = getApiUrl(endpoint) + '?' + params.toString();

    if (!query && !country && !language && state.radioSource === 'tunein') {
        // Special case: empty everything on TuneIn defaults to popular
    } else {
        container.innerHTML = `<div class="empty-state">Lade...</div>`;
    }
    
    try {
        const res = await fetch(url);
        const stations = await res.json();
        renderRadioResults(stations);
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Fehler bei der Suche.</div>`;
    }
}

function renderRadioResults(stations) {
    const container = document.getElementById('radio-results');
    if (stations.length === 0) {
        container.innerHTML = `<div class="empty-state">Keine Sender gefunden.</div>`;
        return;
    }

    container.innerHTML = stations.map(s => {
        const img = s.image ? `<img src="${s.image}">` : `<div style="font-size:1.5rem">📻</div>`;
        return `
        <div class="radio-item" onclick="apiPlayUrl(getSelectedDevice()?.id, '', '${s.name.replace(/'/g, "&apos;")}')">
            <div class="radio-img-col">${img}</div>
            <div class="radio-info-col">
                <div class="radio-name">${s.name}</div>
                <div class="radio-meta">${s.now_playing || 'Internetradio'}</div>
            </div>
            <button class="radio-play-btn">▶</button>
        </div>
        `;
    }).join('');
}

/* --- Settings View --- */
function updateSettingsView() {
    const device = getSelectedDevice();
    if (!device) return;
    
    // We would fetch settings here ideally, but for now we rely on cached or quick UI updates
    fetch(getApiUrl(`/api/device/${device.id}/settings`))
        .then(r => r.json())
        .then(res => {
            if (res.audio) {
                document.getElementById('range-bass').value = res.audio.bass || 0;
                document.getElementById('val-bass').textContent = res.audio.bass || 0;
                document.getElementById('range-treble').value = res.audio.treble || 0;
                document.getElementById('val-treble').textContent = res.audio.treble || 0;
            }
        });
}

function updateRangeVal(type, val) {
    document.getElementById(`val-${type}`).textContent = val;
}

function saveAudioSettings() {
    const device = getSelectedDevice();
    if (!device) return;
    const bass = document.getElementById('range-bass').value;
    const treble = document.getElementById('range-treble').value;

    fetch(getApiUrl(`/api/device/${device.id}/settings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bass: parseInt(bass), treble: parseInt(treble) })
    }).then(() => showToast('Audio gespeichert'));
}

function rebootDevice() {
    const d = getSelectedDevice();
    if (d && confirm('Lautsprecher wirklich neu starten?')) {
        fetch(getApiUrl(`/api/device/${d.id}/reboot`), { method: 'POST' });
        showToast('Neustart-Signal gesendet');
    }
}

function forgetDevice() {
    const d = getSelectedDevice();
    if (d && confirm('Lautsprecher wirklich aus der App entfernen?')) {
        fetch(getApiUrl(`/api/device/forget`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: d.ip })
        }).then(() => {
            showToast('Lautsprecher entfernt');
            fetchDevices();
        });
    }
}

/* --- Modals & Toasts --- */
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

function openAddDeviceModal() {
    document.getElementById('modal-add-device').classList.add('open');
}

function submitAddDevice() {
    const ip = document.getElementById('add-device-ip').value;
    if (!ip) return;
    fetch(getApiUrl('/api/device/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip })
    }).then(r => r.json()).then(res => {
        if (res.success) {
            showToast('Hinzugefügt');
            fetchDevices();
            closeModal('modal-add-device');
        } else {
            showToast(res.message, 'error');
        }
    });
}

let toastTimer;
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
