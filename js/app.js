/**
 * app.js — MoveBox main application logic
 */

// ── State ──────────────────────────────────────────────────────────────────
let boxes = JSON.parse(localStorage.getItem('mb_boxes') || '[]');
let moveName = localStorage.getItem('mb_movename') || '';
let scannerRunning = false;
let html5QrCode = null;
let currentBoxId = null;
let currentQRBoxId = null;
let nbPriority = 'normal';

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderBoxList();
  updateDriveUI();
  document.getElementById('move-name-input').value = moveName;
  wireEvents();
  // Auto-sync on load if already connected
  if (Drive.isConnected()) {
    setTimeout(() => runSync({ silent: true }), 1200);
  }
});

window.addEventListener('drive-connected', () => {
  updateDriveUI();
  setTimeout(() => runSync({ silent: false }), 800);
});
window.addEventListener('drive-disconnected', () => updateDriveUI());

// ── Persistence ────────────────────────────────────────────────────────────
let _syncDebounce = null;
function saveBoxes() {
  try {
    localStorage.setItem('mb_boxes', JSON.stringify(boxes));
    localStorage.setItem('mb_movename', moveName);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      alert('Storage full — photo could not be saved. Try deleting photos from other boxes to free space.');
    }
  }
  updateNavCount();
  // stamp last-write time on current box if editing
  if (currentBoxId) {
    const b = boxes.find(x => x.id === currentBoxId);
    if (b) b.updatedAt = Date.now();
  }
  // Debounced background sync after local changes
  if (Drive.isConnected()) {
    clearTimeout(_syncDebounce);
    _syncDebounce = setTimeout(() => runSync({ silent: true }), 3000);
  }
}

function updateNavCount() {
  const n = boxes.length;
  document.getElementById('box-count-nav').textContent = n + (n === 1 ? ' box' : ' boxes');
}

// ── Wire all events ────────────────────────────────────────────────────────
function wireEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.screen, t));
  });

  // New box
  document.getElementById('new-box-btn').addEventListener('click', openNewBoxSheet);
  document.getElementById('nb-cancel').addEventListener('click', () => closeSheet('new-box-sheet'));
  document.getElementById('nb-create').addEventListener('click', createBox);

  // Segmented control (priority)
  document.querySelectorAll('#nb-priority .seg').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#nb-priority .seg').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      nbPriority = s.dataset.val;
    });
  });

  // Scanner
  document.getElementById('scan-toggle-btn').addEventListener('click', toggleScanner);
  document.getElementById('manual-go-btn').addEventListener('click', () => {
    goToBoxById(document.getElementById('manual-scan-id').value);
  });
  document.getElementById('manual-scan-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToBoxById(e.target.value);
  });

  // QR buttons are wired dynamically in wireQRButtons() per box

  // Settings
  document.getElementById('save-move-btn').addEventListener('click', saveMoveSettings);
  document.getElementById('clear-all-btn').addEventListener('click', clearAll);

  // Close sheets on backdrop click
  document.querySelectorAll('.sheet-bg').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeSheet(el.id); });
  });
}

// ── Tab navigation ─────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  el.classList.add('active');
  if (name !== 'scan' && scannerRunning) stopScanner();
}

// ── Box list ───────────────────────────────────────────────────────────────
function renderBoxList() {
  const list = document.getElementById('box-list');
  const empty = document.getElementById('box-empty');
  updateNavCount();

  if (boxes.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = boxes.map(b => {
    const pCls = b.priority === 'high' ? 'pill-green' : b.priority === 'fragile' ? 'pill-red' : 'pill-amber';
    const pLabel = b.priority === 'high' ? 'Open first' : b.priority === 'fragile' ? 'Fragile' : 'Normal';
    const nPh = (b.photos || []).length;
    const aiTag = b.aiIdentified ? '<span class="pill pill-blue">AI ✓</span>' : '';
    return `
      <div class="box-item" data-id="${b.id}">
        <div class="box-num">${b.num}</div>
        <div class="box-info">
          <div class="box-name">${escHtml(b.name)}</div>
          <div class="box-meta">${escHtml(b.room || 'No room')} · ${nPh} photo${nPh === 1 ? '' : 's'}</div>
        </div>
        <div class="box-tags">
          ${aiTag}
          <span class="pill ${pCls}">${pLabel}</span>
          <svg class="box-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="15" height="15"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.box-item').forEach(el => {
    el.addEventListener('click', () => openBoxDetail(el.dataset.id));
  });
}

// ── New box ────────────────────────────────────────────────────────────────
function openNewBoxSheet() {
  document.getElementById('nb-name').value = '';
  document.getElementById('nb-room').value = '';
  document.getElementById('nb-notes').value = '';
  nbPriority = 'normal';
  document.querySelectorAll('#nb-priority .seg').forEach(s => {
    s.classList.toggle('active', s.dataset.val === 'normal');
  });
  openSheet('new-box-sheet');
  setTimeout(() => document.getElementById('nb-name').focus(), 300);
}

function createBox() {
  const name = document.getElementById('nb-name').value.trim();
  if (!name) { document.getElementById('nb-name').focus(); return; }
  const num = boxes.length + 1;
  const id = 'BOX-' + String(num).padStart(3, '0') + '-' + uid();
  const box = {
    id, num, name,
    room: document.getElementById('nb-room').value,
    priority: nbPriority,
    notes: document.getElementById('nb-notes').value.trim(),
    photos: [],
    created: Date.now(),
    updatedAt: Date.now(),
    aiIdentified: false,
    aiSummary: ''
  };
  boxes.unshift(box);
  saveBoxes();
  renderBoxList();
  closeSheet('new-box-sheet');
  setTimeout(() => showQR(id), 350);
}

// ── Box detail ─────────────────────────────────────────────────────────────
function openBoxDetail(boxId) {
  currentBoxId = boxId;
  renderBoxDetail(boxId);
  openSheet('detail-sheet');
  loadDrivePhotos(boxId);
}

function renderBoxDetail(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;

  const pCls = box.priority === 'high' ? 'pill-green' : box.priority === 'fragile' ? 'pill-red' : 'pill-amber';
  const pLabel = box.priority === 'high' ? '🟢 Open first' : box.priority === 'fragile' ? '🔴 Fragile' : 'Normal';
  const nPh = (box.photos || []).length;

  const photosGrid = (box.photos || []).map((p, i) => photoThumbHtml(p, i, boxId)).join('');

  const driveStatus = Drive.isConnected()
    ? `<div class="status-bar connected" style="margin:0;pointer-events:none;"><div class="status-dot"></div><span>Photos sync to Google Drive</span></div>`
    : `<div class="status-bar disconnected" style="margin:0;pointer-events:none;cursor:default;"><div class="status-dot"></div><span style="color:var(--text3);">Connect Drive in Settings to sync</span></div>`;

  const aiBlock = box.aiSummary
    ? `<div class="ai-result-box"><div class="ai-label">AI identified contents</div>${escHtml(box.aiSummary)}</div>`
    : '';

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-header">
      <div class="detail-num">${box.num}</div>
      <div style="flex:1;min-width:0;">
        <div class="detail-title">${escHtml(box.name)}</div>
        <div class="detail-sub">
          <span>${escHtml(box.room || 'No room')}</span>
          <span class="pill ${pCls}">${pLabel}</span>
        </div>
      </div>
    </div>
    ${box.notes ? `<p style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.6;">${escHtml(box.notes)}</p>` : ''}

    <div class="divider"></div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <h3>Photos <span style="color:var(--text3);font-weight:400;font-size:12px;">${nPh}</span></h3>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm" id="add-photo-camera-btn" data-box="${boxId}" title="Take photo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <button class="btn btn-sm" id="add-photo-gallery-btn" data-box="${boxId}" title="Choose from library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
      </div>
    </div>

    <div class="photo-grid" id="photo-grid-${boxId}">
      ${photosGrid}
      ${photoAddCells(boxId)}
    </div>

    ${nPh > 0 ? `
    <button class="btn ai-identify-btn btn-full" id="ai-identify-btn" data-box="${boxId}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
      Identify contents with AI
    </button>` : ''}

    ${aiBlock}

    <div class="divider"></div>
    ${driveStatus}

    <div class="detail-actions">
      <button class="btn btn-sm" id="detail-qr-btn" data-box="${boxId}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M17 14v3h3M14 20h3"/></svg>
        QR Code
      </button>
      <button class="btn btn-sm" id="detail-edit-btn" data-box="${boxId}">Edit</button>
      <button class="btn btn-sm btn-danger" id="detail-del-btn" data-box="${boxId}">Delete box</button>
    </div>
    <p style="font-size:10px;color:var(--text3);margin-top:12px;font-family:monospace;">${boxId}</p>
  `;

  // Wire detail events
  document.getElementById('add-photo-camera-btn')?.addEventListener('click', () => addPhoto(boxId, true));
  document.getElementById('add-photo-gallery-btn')?.addEventListener('click', () => addPhoto(boxId, false));
  wirePhotoGrid(boxId);
  document.getElementById('ai-identify-btn')?.addEventListener('click', () => runAIIdentify(boxId));
  document.getElementById('detail-qr-btn')?.addEventListener('click', () => { closeSheet('detail-sheet'); setTimeout(() => showQR(boxId), 300); });
  document.getElementById('detail-edit-btn')?.addEventListener('click', () => renderBoxDetailEdit(boxId));
  document.getElementById('detail-del-btn')?.addEventListener('click', () => deleteBox(boxId));
}

function renderBoxDetailEdit(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;
  let editPriority = box.priority || 'normal';

  const roomOptions = ['', 'Kitchen', 'Living room', 'Master bedroom', 'Bedroom', 'Bathroom', 'Office', 'Garage', 'Basement', 'Storage', 'Other'];

  document.getElementById('detail-content').innerHTML = `
    <div class="sheet-title" style="margin-bottom:16px;">Edit Box</div>
    <div class="field"><label>Box name</label><input type="text" id="edit-name" value="${escHtml(box.name)}"></div>
    <div class="field">
      <label>Room</label>
      <select id="edit-room">
        ${roomOptions.map(r => `<option value="${r}"${r === box.room ? ' selected' : ''}>${r || '— Select room —'}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Priority</label>
      <div class="seg-control" id="edit-priority">
        <button class="seg${editPriority === 'normal' ? ' active' : ''}" data-val="normal">Normal</button>
        <button class="seg${editPriority === 'high' ? ' active' : ''}" data-val="high">Open first</button>
        <button class="seg${editPriority === 'fragile' ? ' active' : ''}" data-val="fragile">Fragile</button>
      </div>
    </div>
    <div class="field"><label>Notes</label><textarea id="edit-notes" rows="2">${escHtml(box.notes || '')}</textarea></div>
    <div class="sheet-actions" style="margin-top:16px;">
      <button class="btn btn-full" id="edit-cancel-btn">Cancel</button>
      <button class="btn btn-primary btn-full" id="edit-save-btn">Save</button>
    </div>
  `;

  document.querySelectorAll('#edit-priority .seg').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#edit-priority .seg').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      editPriority = s.dataset.val;
    });
  });

  document.getElementById('edit-cancel-btn').addEventListener('click', () => renderBoxDetail(boxId));
  document.getElementById('edit-save-btn').addEventListener('click', () => {
    const name = document.getElementById('edit-name').value.trim();
    if (!name) { document.getElementById('edit-name').focus(); return; }
    box.name = name;
    box.room = document.getElementById('edit-room').value;
    box.notes = document.getElementById('edit-notes').value.trim();
    box.priority = editPriority;
    box.updatedAt = Date.now();
    saveBoxes();
    renderBoxList();
    renderBoxDetail(boxId);
  });
}

// ── Photos ─────────────────────────────────────────────────────────────────
function compressImage(dataUrl, maxDim = 1200, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      cvs.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cvs.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

function addPhoto(boxId, useCamera = false) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  if (useCamera) input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const raw = await readFileAsDataURL(file);
    const data = await compressImage(raw);
    const box = boxes.find(b => b.id === boxId);
    if (!box) return;
    if (!box.photos) box.photos = [];
    const photo = { data, name: file.name, ts: Date.now(), driveLink: null };
    box.photos.push(photo);
    saveBoxes();
    renderBoxDetail(boxId);
    renderBoxList();

    if (Drive.isConnected()) {
      showToast('Uploading to Drive…');
      const result = await Drive.uploadPhoto(boxId, box.name, data, file.name);
      if (result) {
        const b2 = boxes.find(b => b.id === boxId);
        const ph = b2?.photos[b2.photos.length - 1];
        if (ph) {
          ph.driveLink = result.link;
          ph.driveFileId = result.fileId;
          ph.data = null;  // free localStorage — photo is safely on Drive
        }
        saveBoxes();
      }
      hideToast();
    }
  };
  input.click();
}

function deletePhoto(boxId, idx) {
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;
  const [removed] = box.photos.splice(idx, 1);
  if (removed?.ts) {
    if (!box.deletedPhotos) box.deletedPhotos = [];
    if (!box.deletedPhotos.includes(removed.ts)) box.deletedPhotos.push(removed.ts);
  }
  saveBoxes();
  renderBoxDetail(boxId);
  renderBoxList();
}

async function viewPhoto(boxId, idx) {
  const box = boxes.find(b => b.id === boxId);
  const photo = box?.photos[idx];
  if (!photo) return;

  let src = photo.data;
  if (!src && Drive.isConnected()) {
    const fileId = photo.driveFileId || extractDriveFileId(photo.driveLink);
    if (fileId) src = await Drive.fetchPhotoData(fileId);
  }
  if (!src) return;

  const w = window.open();
  w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${src}" style="max-width:100%;max-height:100vh;object-fit:contain;"></body></html>`);
}

function extractDriveFileId(link) {
  return link?.match(/\/d\/([^/?]+)/)?.[1] || null;
}

function photoThumbHtml(p, i, boxId) {
  if (p.data) {
    return `<div class="photo-thumb">
      <img src="${p.data}" alt="Photo ${i + 1}" loading="lazy" data-box="${boxId}" data-idx="${i}">
      <button class="photo-del" data-box="${boxId}" data-idx="${i}" title="Delete photo">×</button>
    </div>`;
  }
  return `<div class="photo-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--surface2);">
    ${p.driveLink ? `<a href="${p.driveLink}" target="_blank" style="display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--text3);text-decoration:none;font-size:10px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Drive</a>` : ''}
    <button class="photo-del" data-box="${boxId}" data-idx="${i}" title="Delete photo" style="position:absolute;top:3px;right:3px;">×</button>
  </div>`;
}

function photoAddCells(boxId) {
  return `
    <div class="photo-add" id="photo-add-camera" data-box="${boxId}" title="Take photo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
    </div>
    <div class="photo-add" id="photo-add-gallery" data-box="${boxId}" title="Choose from library">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </div>`;
}

function wirePhotoGrid(boxId) {
  document.getElementById('photo-add-camera')?.addEventListener('click', () => addPhoto(boxId, true));
  document.getElementById('photo-add-gallery')?.addEventListener('click', () => addPhoto(boxId, false));
  document.querySelectorAll(`.photo-del[data-box="${boxId}"]`).forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deletePhoto(boxId, parseInt(btn.dataset.idx)); });
  });
  document.querySelectorAll(`[data-box="${boxId}"][data-idx]`).forEach(img => {
    if (img.tagName === 'IMG') img.addEventListener('click', () => viewPhoto(boxId, parseInt(img.dataset.idx)));
  });
}

async function loadDrivePhotos(boxId) {
  if (!Drive.isConnected()) return;
  const box = boxes.find(b => b.id === boxId);
  if (!box?.photos?.length) return;

  const needLoad = box.photos.filter(p => !p.data && (p.driveFileId || p.driveLink));
  if (!needLoad.length) return;

  await Promise.all(needLoad.map(async (p) => {
    const fileId = p.driveFileId || extractDriveFileId(p.driveLink);
    if (!fileId) return;
    const data = await Drive.fetchPhotoData(fileId);
    if (data) p.data = data;  // in-memory only — not persisted to localStorage
  }));

  const grid = document.getElementById(`photo-grid-${boxId}`);
  if (!grid) return;
  grid.innerHTML = box.photos.map((p, i) => photoThumbHtml(p, i, boxId)).join('') + photoAddCells(boxId);
  wirePhotoGrid(boxId);
}

// ── AI Identify ────────────────────────────────────────────────────────────
async function runAIIdentify(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box || !box.photos?.length) return;

  showToast('Claude is scanning your photos…');
  const btn = document.getElementById('ai-identify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Identifying…'; }

  try {
    await loadDrivePhotos(boxId);
    const summary = await AI.identifyContents(box.photos.filter(p => p.data));
    box.aiSummary = summary;
    box.aiIdentified = true;
    saveBoxes();
    renderBoxDetail(boxId);
    renderBoxList();
  } catch (err) {
    console.error('[AI]', err);
    alert('AI identification failed. Check your API proxy setup.\n\n' + err.message);
  } finally {
    hideToast();
  }
}

// ── QR Code & Label ────────────────────────────────────────────────────────

// Renders one label half onto a canvas context
// cx,cy = top-left corner, w,h = label dimensions (pixels)
function drawLabelOnCanvas(ctx, box, qrCanvas, x, y, w, h) {
  // s = h/429 gives 40% bigger content vs the original h/600 reference
  const s = h / 429;
  const pad = Math.round(14 * s);
  const ff = '-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);

  // Header bar
  const headerH = Math.round(100 * s);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, Math.round(2 * s));
  roundRect(ctx, x + pad, y + pad, w - pad * 2, headerH, Math.round(8 * s));
  ctx.stroke();

  // Box ID (e.g. BOX-001-EBK7)
  ctx.fillStyle = '#000000';
  ctx.font = `600 ${Math.round(22 * s)}px ${ff}`;
  ctx.textAlign = 'center';
  ctx.fillText(box.id || `BOX-${String(box.num).padStart(3,'0')}`, x + w / 2, y + pad + Math.round(30 * s));

  // Box name
  const displayName = box.labelName || box.name;
  const baseSize = displayName.length > 18 ? 34 : displayName.length > 12 ? 40 : 48;
  ctx.font = `800 ${Math.round(baseSize * s)}px ${ff}`;
  ctx.fillText(truncate(displayName, 22), x + w / 2, y + pad + Math.round(82 * s));

  // QR code — centered, tighter gap to header to reclaim vertical space
  const qrSize = Math.min(w - pad * 4, Math.round(220 * s));
  const qrX = x + (w - qrSize) / 2;
  const qrY = y + pad + headerH + Math.round(8 * s);
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  // Thin divider
  const divY = qrY + qrSize + Math.round(8 * s);
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + pad + Math.round(16 * s), divY);
  ctx.lineTo(x + w - pad - Math.round(16 * s), divY);
  ctx.stroke();

  // Room
  let infoY = divY + Math.round(14 * s);
  if (box.room) {
    ctx.fillStyle = '#000000';
    ctx.font = `500 ${Math.round(30 * s)}px ${ff}`;
    ctx.fillText(box.room, x + w / 2, infoY);
    infoY += Math.round(32 * s);
  }

  // Priority badge
  if (box.priority === 'fragile' || box.priority === 'high') {
    const label = box.priority === 'fragile' ? '⚠ FRAGILE' : '★ OPEN FIRST';
    ctx.font = `700 ${Math.round(26 * s)}px ${ff}`;
    const bw = ctx.measureText(label).width + Math.round(24 * s);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + w / 2 - bw / 2, infoY - Math.round(14 * s), bw, Math.round(24 * s), Math.round(12 * s));
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + w / 2, infoY + Math.round(4 * s));
  }

  // Dashed cut line on right edge
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w, y + pad / 2);
  ctx.lineTo(x + w, y + h - pad / 2);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Generate a QR code canvas for a given string
function generateQRCanvas(text, size) {
  return new Promise((resolve) => {
    const wrap = document.getElementById('qr-render');
    wrap.innerHTML = '';
    new QRCode(wrap, {
      text, width: size, height: size,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    const check = setInterval(() => {
      const cvs = wrap.querySelector('canvas');
      if (cvs) { clearInterval(check); resolve(cvs); return; }
      const img = wrap.querySelector('img');
      if (img && img.complete && img.naturalWidth > 0) { clearInterval(check); resolve(img); return; }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      resolve(wrap.querySelector('canvas') || wrap.querySelector('img'));
    }, 3000);
  });
}

// Build the full canvas — 6 copies in a 2×3 grid (each label 3×2⅔ in at 150dpi)
async function buildLabelCanvas(box) {
  const DPI = 150;
  const cols = 2, rows = 3;
  const W = 6 * DPI;          // 900px — 6in wide
  const H = 8 * DPI;          // 1200px — 8in tall
  const lw = W / cols;        // 450px
  const lh = H / rows;        // 400px

  const canvas = document.getElementById('label-canvas');
  canvas.width = W;
  canvas.height = H;

  const displayW = Math.min(320, window.innerWidth - 48);
  canvas.style.width = displayW + 'px';
  canvas.style.height = Math.round(displayW * H / W) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);

  const qrImg = await generateQRCanvas(box.id, 300);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      drawLabelOnCanvas(ctx, box, qrImg, col * lw, row * lh, lw, lh);
    }
  }

  // Horizontal cut lines between rows
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 1;
  for (let row = 1; row < rows; row++) {
    ctx.beginPath();
    ctx.moveTo(20, row * lh);
    ctx.lineTo(W - 20, row * lh);
    ctx.stroke();
  }
  ctx.restore();

  return canvas;
}

async function buildSmallLabelCanvas(box) {
  const W = 375;  // 1.25in @ 300 DPI
  const H = 675;  // 2.25in @ 300 DPI

  const canvas = document.getElementById('label-canvas');
  canvas.width = W;
  canvas.height = H;
  const displayW = Math.min(140, window.innerWidth - 48);
  canvas.style.width = displayW + 'px';
  canvas.style.height = Math.round(displayW * H / W) + 'px';

  const ctx = canvas.getContext('2d');
  const ff = '-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  const pad = 18;
  let y = pad;

  // Box ID
  ctx.fillStyle = '#000000';
  ctx.font = `600 28px ${ff}`;
  y += 34;
  ctx.fillText(box.id || '', W / 2, y);
  y += 14;

  // Box name
  const displayName = box.labelName || box.name;
  const nameSize = displayName.length > 18 ? 36 : displayName.length > 12 ? 44 : 54;
  ctx.font = `800 ${nameSize}px ${ff}`;
  y += nameSize;
  ctx.fillText(truncate(displayName, 20), W / 2, y);
  y += 18;

  // QR code — nearly full width
  const qrSize = W - pad * 2;
  const qrImg = await generateQRCanvas(box.id, 400);
  ctx.drawImage(qrImg, pad, y, qrSize, qrSize);
  y += qrSize + 16;

  // Room
  if (box.room) {
    ctx.font = `500 30px ${ff}`;
    ctx.fillText(box.room, W / 2, y + 30);
    y += 46;
  }

  // Priority badge
  if (box.priority === 'fragile' || box.priority === 'high') {
    const pLabel = box.priority === 'fragile' ? '⚠ FRAGILE' : '★ OPEN FIRST';
    ctx.font = `700 28px ${ff}`;
    ctx.fillText(pLabel, W / 2, y + 30);
  }

  return canvas;
}

function getActiveLabelFormat() {
  return document.querySelector('#label-format-control .seg.active')?.dataset.val || '6up';
}

async function rebuildLabelCanvas(box) {
  const fmt = getActiveLabelFormat();
  const printLabel = document.getElementById('qr-print-label');
  if (printLabel) printLabel.textContent = fmt === 'small' ? 'Print Label (1.25×2.25")' : 'Print Label (4×6)';
  const caption = document.getElementById('label-canvas-caption');
  if (caption) caption.textContent = fmt === 'small' ? 'Single · 1.25×2.25"' : '6 copies · 2×3 grid';
  return fmt === 'small' ? buildSmallLabelCanvas(box) : buildLabelCanvas(box);
}

async function showQR(boxId) {
  currentQRBoxId = boxId;
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;

  document.getElementById('qr-sheet-title').textContent = `Box #${box.num} — Label`;

  // Show Drive save button only if connected
  const driveBtn = document.getElementById('qr-save-drive-btn');
  if (driveBtn) driveBtn.style.display = Drive.isConnected() ? 'flex' : 'none';

  // Populate label name input
  const nameInput = document.getElementById('qr-label-name-input');
  if (nameInput) {
    nameInput.value = box.labelName || box.name;
    let redrawTimer;
    nameInput.oninput = () => {
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(async () => {
        box.labelName = nameInput.value.trim() || box.name;
        saveBoxes();
        await rebuildLabelCanvas(box);
      }, 350);
    };
  }

  // Wire format selector
  document.querySelectorAll('#label-format-control .seg').forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll('#label-format-control .seg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await rebuildLabelCanvas(box);
    };
  });

  openSheet('qr-sheet');

  // Build canvas after sheet opens
  setTimeout(async () => {
    document.getElementById('label-preview-wrap').innerHTML =
      '<canvas id="label-canvas"></canvas><p id="label-canvas-caption" style="font-size:11px;color:var(--text3);margin-top:4px;"></p>';
    await rebuildLabelCanvas(box);
    wireQRButtons(box);
  }, 100);
}

function wireQRButtons(box) {
  document.getElementById('qr-print-btn')?.addEventListener('click', () => printQR(box.id));
  document.getElementById('qr-save-png-btn')?.addEventListener('click', () => saveLabelPNG(box));
  document.getElementById('qr-save-pdf-btn')?.addEventListener('click', () => saveLabelPDF(box));
  document.getElementById('qr-save-drive-btn')?.addEventListener('click', () => saveLabelToDrive(box));
  document.getElementById('qr-close-btn')?.addEventListener('click', () => closeSheet('qr-sheet'));
}

function saveLabelPNG(box) {
  const canvas = document.getElementById('label-canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = `movebox-label-${box.id}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function saveLabelPDF(box) {
  const canvas = document.getElementById('label-canvas');
  if (!canvas) return;
  if (!window.jspdf) { alert('PDF library not loaded yet. Please try again in a moment.'); return; }
  const { jsPDF } = window.jspdf;
  const [pw, ph] = getActiveLabelFormat() === 'small' ? [1.25, 2.25] : [6, 8];
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: [pw, ph] });
  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, 0, pw, ph);
  pdf.save(`movebox-label-${box.id}.pdf`);
}

async function saveLabelToDrive(box) {
  const canvas = document.getElementById('label-canvas');
  if (!canvas || !Drive.isConnected()) return;
  showToast('Saving label to Drive…');
  const dataUrl = canvas.toDataURL('image/png');
  const filename = `label-${box.id}.png`;
  await Drive.uploadPhoto(box.id, box.name, dataUrl, filename);
  hideToast();
  showToast('Label saved to Drive ✓');
  setTimeout(hideToast, 2000);
}

function printQR(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;

  // Build print-area with two label copies side by side
  const area = document.getElementById('print-area');
  area.innerHTML = '';

  // We need a QR code element for each label
  // Use a hidden page layout matching @media print CSS
  const page = document.createElement('div');
  page.className = 'plabel-page';

  [0, 1].forEach(i => {
    const label = document.createElement('div');
    label.className = 'plabel';
    const prioClass = box.priority === 'fragile' ? 'fragile' : box.priority === 'high' ? 'high' : '';
    const prioLabel = box.priority === 'fragile' ? '⚠ FRAGILE' : box.priority === 'high' ? '★ OPEN FIRST' : '';
    label.innerHTML = `
      <div class="plabel-header">
        <div class="plabel-boxnum">Box #${box.num}</div>
        <div class="plabel-name">${escHtml(box.name)}</div>
      </div>
      <div class="plabel-qr" id="pqr_${box.id}_${i}"></div>
      <div class="plabel-divider"></div>
      ${box.room ? `<div class="plabel-room">${escHtml(box.room)}</div>` : ''}
      ${prioLabel ? `<div class="plabel-prio ${prioClass}">${prioLabel}</div>` : ''}
      <div class="plabel-id">${box.id}</div>
      ${moveName ? `<div class="plabel-move">${escHtml(moveName)}</div>` : ''}
    `;
    page.appendChild(label);
  });

  area.appendChild(page);

  setTimeout(() => {
    [0, 1].forEach(i => {
      try {
        new QRCode(document.getElementById(`pqr_${box.id}_${i}`), {
          text: box.id, width: 130, height: 130,
          colorDark: '#000', colorLight: '#fff',
          correctLevel: QRCode.CorrectLevel.H
        });
      } catch (e) { }
    });
    setTimeout(() => window.print(), 700);
  }, 100);
}

// ── Scanner ────────────────────────────────────────────────────────────────
function toggleScanner() {
  scannerRunning ? stopScanner() : startScanner();
}

function startScanner() {
  const vp = document.getElementById('scanner-viewport');
  vp.innerHTML = '<div id="qr-reader"></div>';
  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 200, height: 200 } },
    (text) => { stopScanner(); handleScanResult(text); },
    () => { }
  ).then(() => {
    scannerRunning = true;
    document.getElementById('scan-toggle-btn').innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
      Stop Scanner`;
  }).catch(() => {
    vp.innerHTML = `<div class="scanner-placeholder"><span style="color:var(--danger);font-size:13px;">Camera access denied. Please allow camera access and try again.</span></div>`;
  });
}

function stopScanner() {
  html5QrCode?.stop().catch(() => { });
  html5QrCode = null;
  scannerRunning = false;
  document.getElementById('scanner-viewport').innerHTML = `
    <div class="scanner-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>
      <span>Tap Start to scan a box</span>
    </div>`;
  document.getElementById('scan-toggle-btn').innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/></svg>
    Start Scanner`;
}

function handleScanResult(text) {
  const box = boxes.find(b => b.id === text.trim().toUpperCase());
  const el = document.getElementById('scan-result');
  el.style.display = 'block';
  if (box) {
    el.style.borderColor = 'rgba(92,191,133,0.4)';
    el.innerHTML = `
      <p style="font-size:11px;color:var(--success);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">✓ Box found</p>
      <p style="font-weight:600;font-size:16px;margin-bottom:3px;">${escHtml(box.name)}</p>
      <p style="font-size:13px;color:var(--text2);">${escHtml(box.room || '')} · ${(box.photos || []).length} photo${box.photos?.length === 1 ? '' : 's'}</p>
      <button class="btn btn-primary btn-sm" id="scan-open-btn" style="margin-top:12px;" data-box="${box.id}">Open Box</button>`;
    document.getElementById('scan-open-btn').addEventListener('click', () => {
      switchTab('home', document.querySelector('.tab[data-screen="home"]'));
      setTimeout(() => openBoxDetail(box.id), 100);
    });
  } else {
    el.style.borderColor = 'rgba(224,96,96,0.3)';
    el.innerHTML = `
      <p style="font-size:11px;color:var(--danger);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Not found</p>
      <p style="font-size:13px;color:var(--text2);">No box with ID: <code>${escHtml(text)}</code></p>`;
  }
}

function goToBoxById(id) {
  if (!id?.trim()) return;
  handleScanResult(id.trim().toUpperCase());
}

// ── Drive Sync ────────────────────────────────────────────────────────────
async function runSync({ silent = false } = {}) {
  if (!Drive.isConnected()) return;
  if (!silent) showToast('Syncing with Google Drive…');
  setSyncIndicator('syncing');
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mb_deleted_boxes') || '{}');
    const result = await Drive.syncDatabase(boxes, moveName, localDeleted);
    boxes = result.merged;
    moveName = result.mergedMoveName || moveName;
    // Strip photo data for any photo already on Drive — free localStorage space
    boxes.forEach(box => {
      (box.photos || []).forEach(p => { if (p.driveLink && p.data) p.data = null; });
    });
    localStorage.setItem('mb_boxes', JSON.stringify(boxes));
    localStorage.setItem('mb_movename', moveName);
    if (result.mergedDeleted) {
      localStorage.setItem('mb_deleted_boxes', JSON.stringify(result.mergedDeleted));
    }
    document.getElementById('move-name-input').value = moveName;
    renderBoxList();
    updateSyncStatus();
    setSyncIndicator('ok');
    if (!silent) {
      const msg = result.newCount > 0
        ? `Synced — ${result.newCount} new box${result.newCount > 1 ? 'es' : ''} from Drive`
        : 'Synced with Google Drive';
      showToast(msg);
      setTimeout(hideToast, 2200);
    }
  } catch (err) {
    console.error('[Sync]', err);
    setSyncIndicator('error');
    if (!silent) {
      hideToast();
      alert('Sync failed: ' + err.message);
    }
  }
}

function setSyncIndicator(state) {
  const ind = document.getElementById('drive-nav-indicator');
  if (!ind) return;
  ind.classList.remove('connected', 'syncing', 'error');
  if (state === 'ok') ind.classList.add('connected');
  if (state === 'syncing') ind.classList.add('syncing');
  if (state === 'error') ind.classList.add('error');
}

function updateSyncStatus() {
  const el = document.getElementById('sync-last-time');
  if (!el) return;
  const t = Drive.lastSyncTime();
  el.textContent = t ? 'Last synced ' + formatRelTime(t) : 'Not yet synced';
}

function formatRelTime(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.round(sec / 60) + 'm ago';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Drive UI ───────────────────────────────────────────────────────────────
function updateDriveUI() {
  const connected = Drive.isConnected();
  const configured = Drive.isConfigured();

  // Nav indicator
  const ind = document.getElementById('drive-nav-indicator');
  ind.classList.toggle('connected', connected);
  ind.title = connected ? 'Google Drive connected' : 'Google Drive not connected';

  // Home banner
  const banner = document.getElementById('drive-banner');
  if (connected) {
    const lastSync = Drive.lastSyncTime();
    const lastSyncStr = lastSync ? 'Last synced ' + formatRelTime(lastSync) : 'Tap to sync now';
    banner.innerHTML = `<div class="status-bar connected" id="drive-sync-banner" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="status-dot"></div>
        <span id="sync-last-time">${lastSyncStr}</span>
      </div>
      <button class="btn btn-sm" id="manual-sync-btn" style="padding:4px 10px;font-size:12px;">Sync now</button>
    </div>`;
    document.getElementById('manual-sync-btn')?.addEventListener('click', () => runSync({ silent: false }));
  } else if (!configured) {
    banner.innerHTML = `<div class="status-bar disconnected" style="cursor:default;"><div class="status-dot"></div><span style="color:var(--text3);">Google Drive not configured — see Settings</span></div>`;
  } else {
    banner.innerHTML = `<div class="status-bar disconnected" id="drive-connect-shortcut"><div class="status-dot"></div><span style="color:var(--text2);">Connect Google Drive to sync boxes ↗</span></div>`;
    document.getElementById('drive-connect-shortcut')?.addEventListener('click', () => {
      switchTab('settings', document.querySelector('.tab[data-screen="settings"]'));
    });
  }

  // Settings panel
  const panel = document.getElementById('drive-settings-panel');
  if (!panel) return;
  if (!configured) {
    panel.innerHTML = `
      <div class="drive-connect-block">
        <p>Set your Google OAuth Client ID in <code>js/drive.js</code> (or via <code>window.GOOGLE_CLIENT_ID</code>) to enable Drive sync.</p>
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="btn btn-sm" style="text-decoration:none;">Open Google Cloud Console ↗</a>
      </div>`;
  } else if (connected) {
    const lastSync = Drive.lastSyncTime();
    const lastSyncStr = lastSync ? lastSync.toLocaleString() : 'Never';
    panel.innerHTML = `
      <div class="drive-connected-block">
        <div class="folder-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          MoveBox/movebox-db.json
        </div>
        <p>Box data and photos sync across all devices via Google Drive. Any device connected to the same Drive account sees all boxes.</p>
        <div style="background:var(--surface2);border-radius:var(--rm);padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--text2);">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span>Last synced</span><span style="color:var(--text);">${lastSyncStr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span>Boxes</span><span style="color:var(--text);">${boxes.length}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-primary" id="drive-sync-now-btn" style="flex:1;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>
            Sync now
          </button>
          <button class="btn btn-sm btn-danger" id="drive-disconnect-btn">Disconnect</button>
        </div>
      </div>`;
    document.getElementById('drive-disconnect-btn').addEventListener('click', () => { Drive.disconnect(); updateDriveUI(); });
    document.getElementById('drive-sync-now-btn').addEventListener('click', () => runSync({ silent: false }));
  } else {
    panel.innerHTML = `
      <div class="drive-connect-block">
        <p>Store box photos in Google Drive, organized by box in a <strong>MoveBox/</strong> folder. Photos upload automatically when you take them.</p>
        <button class="btn btn-primary btn-sm" id="drive-connect-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          Connect Google Drive
        </button>
      </div>`;
    document.getElementById('drive-connect-btn').addEventListener('click', () => Drive.connect());
  }
}

// ── Settings ───────────────────────────────────────────────────────────────
function saveMoveSettings() {
  moveName = document.getElementById('move-name-input').value;
  localStorage.setItem('mb_movename', moveName);
  const btn = document.getElementById('save-move-btn');
  btn.textContent = 'Saved ✓'; btn.disabled = true;
  setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1800);
}

function clearAll() {
  if (!confirm('Delete ALL boxes and photos? This cannot be undone.')) return;
  const deleted = JSON.parse(localStorage.getItem('mb_deleted_boxes') || '{}');
  const now = Date.now();
  boxes.forEach(b => { deleted[b.id] = now; });
  localStorage.setItem('mb_deleted_boxes', JSON.stringify(deleted));
  boxes = []; saveBoxes(); renderBoxList();
}

function deleteBox(boxId) {
  if (!confirm('Delete this box and all its photos? This cannot be undone.')) return;
  const deleted = JSON.parse(localStorage.getItem('mb_deleted_boxes') || '{}');
  deleted[boxId] = Date.now();
  localStorage.setItem('mb_deleted_boxes', JSON.stringify(deleted));
  boxes = boxes.filter(b => b.id !== boxId);
  saveBoxes(); renderBoxList(); closeSheet('detail-sheet');
}

// ── Sheet helpers ──────────────────────────────────────────────────────────
function openSheet(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('ai-toast');
  document.getElementById('ai-toast-text').textContent = msg;
  t.style.display = 'block';
}
function hideToast() {
  document.getElementById('ai-toast').style.display = 'none';
}

// ── Utilities ──────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
