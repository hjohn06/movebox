/**
 * drive.js — Google Drive OAuth2 + photo upload + database sync
 *
 * SETUP: Set GOOGLE_CLIENT_ID below to your OAuth 2.0 client ID from
 * https://console.cloud.google.com → APIs & Services → Credentials
 *
 * Required scopes: https://www.googleapis.com/auth/drive.file
 * Authorized redirect URIs: add your Netlify URL + /oauth-callback.html
 */

const Drive = (() => {
  // ── CONFIG ────────────────────────────────────────────────────────
  // const CLIENT_ID = window.GOOGLE_CLIENT_ID || '919532466209-l130b42mb6maolglrlupb7td3qpb0o0o.apps.googleusercontent.com';
  const CLIENT_ID = '919532466209-l130b42mb6maolglrlupb7td3qpb0o0o.apps.googleusercontent.com';

  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'MoveBox';
  const DB_FILENAME = 'movebox-db.json';
  const REDIRECT_URI = window.location.origin + '/movebox/oauth-callback.html';

  // ── State ─────────────────────────────────────────────────────────
  let accessToken = localStorage.getItem('mb_drive_token') || null;
  let tokenExpiry = parseInt(localStorage.getItem('mb_drive_expiry') || '0');
  let rootFolderId = localStorage.getItem('mb_drive_folder') || null;
  let dbFileId = localStorage.getItem('mb_drive_db_id') || null;
  let syncInFlight = false;

  // ── Public API ────────────────────────────────────────────────────
  function isConfigured() {
    return CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE' && CLIENT_ID.length > 10;
  }

  function isConnected() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  function connect() {
    if (!isConfigured()) {
      alert('Google Client ID not configured.\n\nOpen js/drive.js and set your CLIENT_ID.');
      return;
    }
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: SCOPES,
      prompt: 'select_account',
    });
    window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      '_blank', 'width=500,height=620'
    );

    window.addEventListener('message', function handler(e) {
      if (e.data && e.data.type === 'MB_OAUTH_TOKEN') {
        window.removeEventListener('message', handler);
        accessToken = e.data.access_token;
        tokenExpiry = Date.now() + e.data.expires_in * 1000;
        localStorage.setItem('mb_drive_token', accessToken);
        localStorage.setItem('mb_drive_expiry', tokenExpiry);
        rootFolderId = null;
        dbFileId = null;
        localStorage.removeItem('mb_drive_folder');
        localStorage.removeItem('mb_drive_db_id');
        window.dispatchEvent(new CustomEvent('drive-connected'));
      }
    });
  }

  function disconnect() {
    accessToken = null; tokenExpiry = 0;
    rootFolderId = null; dbFileId = null;
    ['mb_drive_token', 'mb_drive_expiry', 'mb_drive_folder', 'mb_drive_db_id',
      'mb_drive_last_sync'].forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent('drive-disconnected'));
  }

  function lastSyncTime() {
    const ts = parseInt(localStorage.getItem('mb_drive_last_sync') || '0');
    return ts ? new Date(ts) : null;
  }

  // ── Internal fetch helper ─────────────────────────────────────────
  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) }
    });
    if (res.status === 401) { disconnect(); throw new Error('Drive token expired — please reconnect.'); }
    return res;
  }

  // ── Folder helpers ────────────────────────────────────────────────
  async function findOrCreateFolder(name, parentId = null) {
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      + (parentId ? ` and '${parentId}' in parents` : '');
    const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    const data = await res.json();
    if (data.files?.length) return data.files[0].id;

    const body = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) body.parents = [parentId];
    const cr = await apiFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return (await cr.json()).id;
  }

  async function getRootFolder() {
    if (rootFolderId) return rootFolderId;
    rootFolderId = await findOrCreateFolder(FOLDER_NAME);
    localStorage.setItem('mb_drive_folder', rootFolderId);
    return rootFolderId;
  }

  // ── Database file helpers ─────────────────────────────────────────
  async function findDbFile(folderId) {
    const q = `name='${DB_FILENAME}' and '${folderId}' in parents and trashed=false`;
    const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)`);
    const data = await res.json();
    return data.files?.[0] || null;
  }

  async function readDbFile(fileId) {
    const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  }

  async function writeDbFile(folderId, fileId, payload) {
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    if (fileId) {
      // Update existing file
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: blob
      });
      return fileId;
    } else {
      // Create new file
      const meta = JSON.stringify({ name: DB_FILENAME, parents: [folderId], mimeType: 'application/json' });
      const form = new FormData();
      form.append('metadata', new Blob([meta], { type: 'application/json' }));
      form.append('file', blob);
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
      });
      const d = await res.json();
      return d.id;
    }
  }

  // ── Merge logic ───────────────────────────────────────────────────
  // Merge remote boxes into local. Strategy:
  //   - Union of all box IDs across both sides
  //   - For boxes that exist on both sides, keep whichever was modified more recently
  //   - Photos are merged by timestamp (union, deduped by ts)
  function mergeBoxes(local, remote) {
    const byId = {};

    // Index local
    for (const b of local) byId[b.id] = { ...b };

    // Merge remote
    for (const rb of remote) {
      const lb = byId[rb.id];
      if (!lb) {
        // Box only on remote — add it (strip photo data to save localStorage space if huge)
        byId[rb.id] = { ...rb };
      } else {
        // Both have it — merge photos, keep most-recent metadata
        const localNewer = (lb.updatedAt || lb.created || 0) >= (rb.updatedAt || rb.created || 0);
        const base = localNewer ? { ...lb } : { ...rb };

        // Photo union by timestamp
        const allPhotos = [...(lb.photos || []), ...(rb.photos || [])];
        const seenTs = new Set();
        base.photos = allPhotos.filter(p => {
          if (seenTs.has(p.ts)) return false;
          seenTs.add(p.ts);
          return true;
        }).sort((a, b) => a.ts - b.ts);

        byId[rb.id] = base;
      }
    }

    // Preserve original order (by box num), append new remote boxes at end
    const localIds = new Set(local.map(b => b.id));
    const result = local.map(b => byId[b.id]).filter(Boolean);
    for (const b of remote) {
      if (!localIds.has(b.id)) result.push(byId[b.id]);
    }
    return result;
  }

  // ── PUBLIC: Full sync ─────────────────────────────────────────────
  // Pulls remote DB, merges with local, pushes merged result back.
  // Returns { merged: Box[], newCount: number, updatedCount: number }
  async function syncDatabase(localBoxes, moveName) {
    if (!isConnected()) throw new Error('Not connected to Drive');
    if (syncInFlight) throw new Error('Sync already in progress');
    syncInFlight = true;

    try {
      const folderId = await getRootFolder();

      // Find or remember db file
      let fileId = dbFileId;
      if (!fileId) {
        const existing = await findDbFile(folderId);
        fileId = existing?.id || null;
        if (fileId) {
          dbFileId = fileId;
          localStorage.setItem('mb_drive_db_id', fileId);
        }
      }

      // Read remote
      let remoteBoxes = [];
      let remoteMoveName = moveName;
      if (fileId) {
        const remote = await readDbFile(fileId);
        if (remote) {
          remoteBoxes = remote.boxes || [];
          remoteMoveName = remote.moveName || moveName;
        }
      }

      // Merge
      const merged = mergeBoxes(localBoxes, remoteBoxes);
      const mergedMoveName = moveName || remoteMoveName;

      // Write back
      const payload = {
        version: 1,
        moveName: mergedMoveName,
        syncedAt: new Date().toISOString(),
        boxes: merged
      };
      const newFileId = await writeDbFile(folderId, fileId, payload);
      if (!fileId) {
        dbFileId = newFileId;
        localStorage.setItem('mb_drive_db_id', newFileId);
      }

      // Track sync time
      localStorage.setItem('mb_drive_last_sync', Date.now().toString());

      const newCount = merged.filter(m => !localBoxes.find(l => l.id === m.id)).length;
      const updatedCount = merged.filter(m => {
        const l = localBoxes.find(x => x.id === m.id);
        return l && (m.photos || []).length > (l.photos || []).length;
      }).length;

      return { merged, mergedMoveName, newCount, updatedCount };
    } finally {
      syncInFlight = false;
    }
  }

  // ── PUBLIC: Upload photo ──────────────────────────────────────────
  async function uploadPhoto(boxId, boxName, dataUrl, filename) {
    if (!isConnected()) return null;
    try {
      const folderId = await getRootFolder();
      const boxFolderId = await findOrCreateFolder(`${boxId} — ${boxName}`, folderId);

      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const bytes = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });

      const meta = JSON.stringify({ name: filename, parents: [boxFolderId] });
      const form = new FormData();
      form.append('metadata', new Blob([meta], { type: 'application/json' }));
      form.append('file', blob);

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
      );
      const d = await res.json();
      return d.webViewLink || null;
    } catch (e) {
      console.error('[Drive] Upload error:', e);
      return null;
    }
  }

  return { isConfigured, isConnected, connect, disconnect, uploadPhoto, syncDatabase, lastSyncTime };
})();
