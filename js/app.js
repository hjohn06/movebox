/**
 * app.js — MoveBox main application logic
 */

// ── State ──────────────────────────────────────────────────────────────────
let boxes    = JSON.parse(localStorage.getItem('mb_boxes') || '[]');
let moveName = localStorage.getItem('mb_movename') || '';
let scannerRunning = false;
let html5QrCode    = null;
let currentBoxId   = null;
let currentQRBoxId = null;
let nbPriority     = 'normal';

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
  localStorage.setItem('mb_boxes', JSON.stringify(boxes));
  localStorage.setItem('mb_movename', moveName);
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
  const list  = document.getElementById('box-list');
  const empty = document.getElementById('box-empty');
  updateNavCount();

  if (boxes.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = boxes.map(b => {
    const pCls   = b.priority === 'high' ? 'pill-green' : b.priority === 'fragile' ? 'pill-red' : 'pill-amber';
    const pLabel = b.priority === 'high' ? 'Open first' : b.priority === 'fragile' ? 'Fragile' : 'Normal';
    const nPh    = (b.photos || []).length;
    const aiTag  = b.aiIdentified ? '<span class="pill pill-blue">AI ✓</span>' : '';
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
  const id  = 'BOX-' + String(num).padStart(3, '0') + '-' + uid();
  const box = {
    id, num, name,
    room:     document.getElementById('nb-room').value,
    priority: nbPriority,
    notes:    document.getElementById('nb-notes').value.trim(),
    photos:   [],
    created:  Date.now(),
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
}

function renderBoxDetail(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;

  const pCls   = box.priority === 'high' ? 'pill-green' : box.priority === 'fragile' ? 'pill-red' : 'pill-amber';
  const pLabel = box.priority === 'high' ? '🟢 Open first' : box.priority === 'fragile' ? '🔴 Fragile' : 'Normal';
  const nPh    = (box.photos || []).length;

  const photosGrid = (box.photos || []).map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.data}" alt="Photo ${i+1}" loading="lazy" data-box="${boxId}" data-idx="${i}">
      <button class="photo-del" data-box="${boxId}" data-idx="${i}" title="Delete photo">×</button>
    </div>`).join('');

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
      <button class="btn btn-sm" id="add-photo-btn" data-box="${boxId}">+ Add photo</button>
    </div>

    <div class="photo-grid" id="photo-grid-${boxId}">
      ${photosGrid}
      <div class="photo-add" id="photo-add-cell" data-box="${boxId}" title="Add photo">+</div>
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
      <button class="btn btn-sm btn-danger" id="detail-del-btn" data-box="${boxId}">Delete box</button>
    </div>
    <p style="font-size:10px;color:var(--text3);margin-top:12px;font-family:monospace;">${boxId}</p>
  `;

  // Wire detail events
  document.getElementById('add-photo-btn')?.addEventListener('click', () => addPhoto(boxId));
  document.getElementById('photo-add-cell')?.addEventListener('click', () => addPhoto(boxId));
  document.getElementById('ai-identify-btn')?.addEventListener('click', () => runAIIdentify(boxId));
  document.getElementById('detail-qr-btn')?.addEventListener('click', () => { closeSheet('detail-sheet'); setTimeout(() => showQR(boxId), 300); });
  document.getElementById('detail-del-btn')?.addEventListener('click', () => deleteBox(boxId));

  document.querySelectorAll(`.photo-del[data-box="${boxId}"]`).forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deletePhoto(boxId, parseInt(btn.dataset.idx)); });
  });
  document.querySelectorAll(`[data-box="${boxId}"][data-idx]`).forEach(img => {
    if (img.tagName === 'IMG') img.addEventListener('click', () => viewPhoto(boxId, parseInt(img.dataset.idx)));
  });
}

// ── Photos ─────────────────────────────────────────────────────────────────
function addPhoto(boxId) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await readFileAsDataURL(file);
    const box  = boxes.find(b => b.id === boxId);
    if (!box) return;
    if (!box.photos) box.photos = [];
    const photo = { data, name: file.name, ts: Date.now(), driveLink: null };
    box.photos.push(photo);
    saveBoxes();
    renderBoxDetail(boxId);
    renderBoxList();

    if (Drive.isConnected()) {
      showToast('Uploading to Drive…');
      const link = await Drive.uploadPhoto(boxId, box.name, data, file.name);
      if (link) {
        const b2 = boxes.find(b => b.id === boxId);
        const ph = b2?.photos[b2.photos.length - 1];
        if (ph) ph.driveLink = link;
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
  box.photos.splice(idx, 1);
  saveBoxes();
  renderBoxDetail(boxId);
  renderBoxList();
}

function viewPhoto(boxId, idx) {
  const box = boxes.find(b => b.id === boxId);
  if (!box?.photos[idx]) return;
  const w = window.open();
  w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${box.photos[idx].data}" style="max-width:100%;max-height:100vh;object-fit:contain;"></body></html>`);
}

// ── AI Identify ────────────────────────────────────────────────────────────
async function runAIIdentify(boxId) {
  const box = boxes.find(b => b.id === boxId);
  if (!box || !box.photos?.length) return;

  showToast('Claude is scanning your photos…');
  const btn = document.getElementById('ai-identify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Identifying…'; }

  try {
    const summary = await AI.identifyContents(box.photos);
    box.aiSummary     = summary;
    box.aiIdentified  = true;
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
  const pad = 20;
  const ff  = '-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);

  // Dark header bar
  const headerH = 64;
  ctx.fillStyle = '#111111';
  roundRect(ctx, x + pad, y + pad, w - pad*2, headerH, 8);
  ctx.fill();

  // Box number label (amber)
  ctx.fillStyle = '#e8c547';
  ctx.font = `600 11px ${ff}`;
  ctx.textAlign = 'center';
  ctx.fillText(`BOX #${box.num}`, x + w/2, y + pad + 20);

  // Box name (white, large)
  ctx.fillStyle = '#ffffff';
  const nameSize = box.name.length > 18 ? 15 : box.name.length > 12 ? 17 : 20;
  ctx.font = `800 ${nameSize}px ${ff}`;
  ctx.fillText(truncate(box.name, 22), x + w/2, y + pad + 50);

  // QR code — centered
  const qrSize = Math.min(w - pad*4, 160);
  const qrX = x + (w - qrSize) / 2;
  const qrY = y + pad + headerH + 14;
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  // Thin divider
  const divY = qrY + qrSize + 12;
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + pad + 20, divY);
  ctx.lineTo(x + w - pad - 20, divY);
  ctx.stroke();

  // Room
  let infoY = divY + 18;
  if (box.room) {
    ctx.fillStyle = '#444444';
    ctx.font = `500 12px ${ff}`;
    ctx.fillText(box.room, x + w/2, infoY);
    infoY += 16;
  }

  // Priority badge
  if (box.priority === 'fragile' || box.priority === 'high') {
    const label  = box.priority === 'fragile' ? '⚠ FRAGILE' : '★ OPEN FIRST';
    const bgCol  = box.priority === 'fragile' ? '#ffeaea' : '#eaffea';
    const txCol  = box.priority === 'fragile' ? '#990000' : '#004400';
    const bw = ctx.measureText(label).width + 20;
    ctx.fillStyle = bgCol;
    roundRect(ctx, x + w/2 - bw/2, infoY - 12, bw, 20, 10);
    ctx.fill();
    ctx.fillStyle = txCol;
    ctx.font = `700 11px ${ff}`;
    ctx.fillText(label, x + w/2, infoY + 2);
    infoY += 22;
  }

  // Box ID
  ctx.fillStyle = '#bbbbbb';
  ctx.font = `400 8px monospace`;
  ctx.fillText(box.id, x + w/2, infoY + 6);

  // Move name (bottom)
  if (moveName) {
    ctx.fillStyle = '#cccccc';
    ctx.font = `400 9px ${ff}`;
    ctx.fillText(moveName, x + w/2, y + h - 10);
  }

  // Dashed divider line on right edge (for cutting)
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w, y + pad/2);
  ctx.lineTo(x + w, y + h - pad/2);
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
    setTimeout(() => {
      const img = wrap.querySelector('img') || wrap.querySelector('canvas');
      resolve(img);
    }, 200);
  });
}

// Build the full 4x6 canvas (2 copies side by side) for a box
async function buildLabelCanvas(box) {
  // 4x6 at 150dpi → 600 x 900px  (landscape: 6in wide × 4in tall)
  const DPI = 150;
  const W   = 6 * DPI;   // 900px
  const H   = 4 * DPI;   // 600px

  const canvas = document.getElementById('label-canvas');
  canvas.width  = W;
  canvas.height = H;

  // Scale for display (fit in sheet bottom drawer ~320px wide)
  const displayW = Math.min(320, window.innerWidth - 48);
  canvas.style.width  = displayW + 'px';
  canvas.style.height = Math.round(displayW * H / W) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);

  // Generate QR code image
  const qrImg = await generateQRCanvas(box.id, 200);

  // Draw two identical label halves
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  drawLabelOnCanvas(ctx, box, qrImg, 0,     0, W/2, H);
  drawLabelOnCanvas(ctx, box, qrImg, W/2,   0, W/2, H);

  return canvas;
}

async function showQR(boxId) {
  currentQRBoxId = boxId;
  const box = boxes.find(b => b.id === boxId);
  if (!box) return;

  document.getElementById('qr-sheet-title').textContent = `Box #${box.num} — Label`;

  // Show Drive save button only if connected
  const driveBtn = document.getElementById('qr-save-drive-btn');
  if (driveBtn) driveBtn.style.display = Drive.isConnected() ? 'flex' : 'none';

  openSheet('qr-sheet');

  // Build canvas after sheet opens
  setTimeout(async () => {
    document.getElementById('label-preview-wrap').innerHTML =
      '<canvas id="label-canvas"></canvas><p style="font-size:11px;color:var(--text3);margin-top:4px;">2 copies · 4×6 label</p>';
    await buildLabelCanvas(box);
    wireQRButtons(box);
  }, 100);
}

function wireQRButtons(box) {
  document.getElementById('qr-print-btn')?.addEventListener('click', () => printQR(box.id));
  document.getElementById('qr-save-png-btn')?.addEventListener('click', () => saveLabelPNG(box));
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

async function saveLabelToDrive(box) {
  const canvas = document.getElementById('label-canvas');
  if (!canvas || !Drive.isConnected()) return;
  showToast('Saving label to Drive…');
  const dataUrl  = canvas.toDataURL('image/png');
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
      } catch(e) {}
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
    () => {}
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
  html5QrCode?.stop().catch(() => {});
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
  const el  = document.getElementById('scan-result');
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
    const result = await Drive.syncDatabase(boxes, moveName);
    boxes    = result.merged;
    moveName = result.mergedMoveName || moveName;
    localStorage.setItem('mb_boxes',    JSON.stringify(boxes));
    localStorage.setItem('mb_movename', moveName);
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
  if (state === 'ok')      ind.classList.add('connected');
  if (state === 'syncing') ind.classList.add('syncing');
  if (state === 'error')   ind.classList.add('error');
}

function updateSyncStatus() {
  const el = document.getElementById('sync-last-time');
  if (!el) return;
  const t = Drive.lastSyncTime();
  el.textContent = t ? 'Last synced ' + formatRelTime(t) : 'Not yet synced';
}

function formatRelTime(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 10)  return 'just now';
  if (sec < 60)  return sec + 's ago';
  if (sec < 3600) return Math.round(sec/60) + 'm ago';
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
  boxes = []; saveBoxes(); renderBoxList();
}

function deleteBox(boxId) {
  if (!confirm('Delete this box and all its photos? This cannot be undone.')) return;
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
