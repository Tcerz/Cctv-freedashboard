let currentGroupId = 'all';
let groupsCache = [];
let camerasCache = [];
const hlsInstances = {}; // cameraId -> Hls instance
const touchIntervals = {}; // cameraId -> interval id

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request gagal: ${res.status}`);
  }
  return res.json();
}

async function loadGroups() {
  groupsCache = await api('/groups');
  const list = document.getElementById('groupList');
  list.innerHTML = `<div class="group-item ${currentGroupId === 'all' ? 'active' : ''}" data-id="all" onclick="selectGroup('all')">
      <span>📁 Semua Kamera</span>
    </div>`;
  groupsCache.forEach(g => {
    const div = document.createElement('div');
    div.className = `group-item ${String(currentGroupId) === String(g.id) ? 'active' : ''}`;
    div.onclick = () => selectGroup(g.id);
    div.innerHTML = `
      <span>📁 ${escapeHtml(g.name)}</span>
      <span class="group-count">${g.camera_count}
        <span class="group-delete" onclick="event.stopPropagation(); deleteGroup(${g.id})">✕</span>
      </span>`;
    list.appendChild(div);
  });
}

async function selectGroup(id) {
  currentGroupId = id;
  const title = id === 'all' ? 'Semua Kamera' : (groupsCache.find(g => String(g.id) === String(id))?.name || '');
  document.getElementById('currentGroupTitle').textContent = title;
  await loadGroups();
  await loadCameras();
}

async function loadCameras() {
  await stopAllPlayers(); // matikan stream folder sebelumnya sebelum load folder baru
  const query = currentGroupId === 'all' ? '' : `?group_id=${currentGroupId}`;
  camerasCache = await api(`/cameras${query}`);
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  if (camerasCache.length === 0) {
    grid.innerHTML = `<p style="opacity:0.6">Belum ada kamera di group ini. Klik "+ Tambah Kamera" untuk mulai.</p>`;
    return;
  }
  camerasCache.forEach(cam => {
    const tile = document.createElement('div');
    tile.className = 'cam-tile';
    tile.id = `tile-${cam.id}`;
    tile.innerHTML = `
      <div class="cam-label">
        <span>${escapeHtml(cam.name)}</span>
        <span class="cam-status loading" id="status-${cam.id}">Menghubungkan...</span>
      </div>
      <video id="video-${cam.id}" muted playsinline autoplay></video>
      <div class="cam-actions">
        <button onclick="editCamera(${cam.id})">Edit</button>
        <button onclick="removeCamera(${cam.id})">Hapus</button>
      </div>
    `;
    grid.appendChild(tile);
    startPlayer(cam.id);
  });
}

async function startPlayer(camId) {
  const statusEl = document.getElementById(`status-${camId}`);
  try {
    const { playlist } = await api(`/cameras/${camId}/stream/start`, { method: 'POST' });
    const video = document.getElementById(`video-${camId}`);
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ maxLiveSyncPlaybackRate: 1 });
      hls.loadSource(playlist);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        if (statusEl) { statusEl.textContent = 'LIVE'; statusEl.className = 'cam-status live'; }
      });
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal && statusEl) {
          statusEl.textContent = 'Error';
          statusEl.className = 'cam-status error';
        }
      });
      hlsInstances[camId] = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlist;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
        if (statusEl) { statusEl.textContent = 'LIVE'; statusEl.className = 'cam-status live'; }
      });
    }

    // Jaga stream tetap hidup selama tile terlihat
    touchIntervals[camId] = setInterval(() => {
      api(`/cameras/${camId}/stream/touch`, { method: 'POST' }).catch(() => {});
    }, 20000);
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Gagal konek'; statusEl.className = 'cam-status error'; }
    console.error(`Kamera ${camId} gagal start:`, err);
  }
}

async function stopAllPlayers() {
  // Hentikan player di sisi browser
  Object.keys(hlsInstances).forEach(id => {
    hlsInstances[id].destroy();
    delete hlsInstances[id];
  });
  Object.keys(touchIntervals).forEach(id => {
    clearInterval(touchIntervals[id]);
    delete touchIntervals[id];
  });

  // Minta backend menghentikan proses ffmpeg untuk kamera folder yang baru saja ditinggalkan,
  // supaya folder yang tidak dibuka tidak terus memakai CPU/bandwidth.
  const idsToStop = camerasCache.map(c => c.id);
  await Promise.all(
    idsToStop.map(id => api(`/cameras/${id}/stream/stop`, { method: 'POST' }).catch(() => {}))
  );
}

// ---------- Group modal ----------
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.getElementById('btnAddGroup').onclick = () => {
  document.getElementById('groupNameInput').value = '';
  openModal('modalGroup');
};

async function submitGroup() {
  const name = document.getElementById('groupNameInput').value.trim();
  if (!name) return alert('Nama depot wajib diisi');
  await api('/groups', { method: 'POST', body: JSON.stringify({ name }) });
  closeModal('modalGroup');
  await loadGroups();
}

async function deleteGroup(id) {
  if (!confirm('Hapus depot ini beserta semua kameranya?')) return;
  await api(`/groups/${id}`, { method: 'DELETE' });
  if (String(currentGroupId) === String(id)) currentGroupId = 'all';
  await selectGroup(currentGroupId);
}

// ---------- Camera modal ----------
document.getElementById('btnAddCamera').onclick = () => {
  if (currentGroupId === 'all' && groupsCache.length === 0) {
    alert('Buat group depot terlebih dahulu sebelum menambah kamera.');
    return;
  }
  document.getElementById('cameraModalTitle').textContent = 'Tambah Kamera';
  document.getElementById('cameraIdInput').value = '';
  document.getElementById('camName').value = '';
  document.getElementById('camIp').value = '';
  document.getElementById('camPort').value = '554';
  document.getElementById('camUser').value = '';
  document.getElementById('camPass').value = '';
  document.getElementById('camBrand').value = 'Hikvision';
  document.getElementById('camStreamType').value = 'sub';
  applyBrandPreset();
  openModal('modalCamera');
};

// Preset path RTSP per merk, dipisah main stream (resolusi tinggi) dan sub stream (ringan, cocok untuk grid)
const RTSP_PRESETS = {
  'Hikvision':    { main: '/Streaming/Channels/101', sub: '/Streaming/Channels/102' },
  'Dahua':        { main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1' },
  'CP Plus':      { main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1' },
  'Uniview':      { main: '/media/video1', sub: '/media/video2' },
  'ONVIF Generic':{ main: '/onvif1', sub: '/onvif2' },
  'Custom':       { main: '', sub: '' }
};

function applyBrandPreset() {
  const brand = document.getElementById('camBrand').value;
  const streamType = document.getElementById('camStreamType').value;
  const preset = RTSP_PRESETS[brand] || RTSP_PRESETS['Custom'];
  document.getElementById('camPath').value = preset[streamType];
}

async function editCamera(id) {
  const cam = camerasCache.find(c => c.id === id);
  if (!cam) return;
  document.getElementById('cameraModalTitle').textContent = 'Edit Kamera';
  document.getElementById('cameraIdInput').value = cam.id;
  document.getElementById('camName').value = cam.name;
  document.getElementById('camIp').value = cam.ip;
  document.getElementById('camPort').value = cam.port;
  document.getElementById('camUser').value = cam.username;
  document.getElementById('camPass').value = ''; // password tidak dikirim balik, isi ulang jika ganti
  document.getElementById('camBrand').value = cam.brand_label || 'Custom';
  document.getElementById('camPath').value = cam.rtsp_path;
  openModal('modalCamera');
}

async function submitCamera() {
  const id = document.getElementById('cameraIdInput').value;
  const payload = {
    group_id: currentGroupId === 'all' ? groupsCache[0]?.id : currentGroupId,
    name: document.getElementById('camName').value.trim(),
    ip: document.getElementById('camIp').value.trim(),
    port: parseInt(document.getElementById('camPort').value || '554', 10),
    username: document.getElementById('camUser').value.trim(),
    password: document.getElementById('camPass').value,
    rtsp_path: document.getElementById('camPath').value.trim(),
    brand_label: document.getElementById('camBrand').value
  };
  if (!payload.name || !payload.ip || !payload.username || (!id && !payload.password)) {
    return alert('Nama, IP, username, dan password wajib diisi');
  }
  if (id) {
    if (!payload.password) delete payload.password; // biarkan password lama jika kosong
    await api(`/cameras/${id}`, { method: 'PUT', body: JSON.stringify({ ...camerasCache.find(c => c.id == id), ...payload }) });
  } else {
    await api('/cameras', { method: 'POST', body: JSON.stringify(payload) });
  }
  closeModal('modalCamera');
  await loadCameras();
}

async function removeCamera(id) {
  if (!confirm('Hapus kamera ini?')) return;
  await api(`/cameras/${id}`, { method: 'DELETE' });
  await loadCameras();
}

document.getElementById('gridSize').onchange = (e) => {
  document.getElementById('grid').className = `grid grid-${e.target.value}`;
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Matikan semua stream yang sedang aktif kalau tab/browser ditutup
window.addEventListener('beforeunload', () => {
  camerasCache.forEach(cam => {
    navigator.sendBeacon(`/api/cameras/${cam.id}/stream/stop`, new Blob([], { type: 'application/json' }));
  });
});

// init
loadGroups().then(loadCameras);
