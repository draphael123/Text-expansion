/**
 * SnapText Web Dashboard
 * Manages macros via Firebase REST API from the landing page
 */

// ── Firebase Configuration ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  projectId: 'snaptext-d1b3f',
  apiKey: 'AIzaSyBHyvKlLYZARXAKwG6Uk1_XGP4a7Gwp3k',
  authDomain: 'snaptext-d1b3f.firebaseapp.com'
};

const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const FIREBASE_FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ── State ──────────────────────────────────────────────────────────────
let macros = [];
let currentFolder = null;
let editingMacroId = null;
let renamingFolder = null;
let lastSyncTime = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Storage helpers (localStorage instead of chrome.storage) ───────────
function getStoredSession() {
  try {
    const data = localStorage.getItem('snaptext_session');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function setStoredSession(session) {
  if (session) {
    localStorage.setItem('snaptext_session', JSON.stringify(session));
  } else {
    localStorage.removeItem('snaptext_session');
  }
}

function getStoredMacros() {
  try {
    const data = localStorage.getItem('snaptext_macros');
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function setStoredMacros(macrosList) {
  localStorage.setItem('snaptext_macros', JSON.stringify(macrosList));
}

function getStoredSettings() {
  try {
    const data = localStorage.getItem('snaptext_settings');
    return data ? JSON.parse(data) : { triggerChar: ';', syncEnabled: false, blockedDomains: [] };
  } catch { return { triggerChar: ';', syncEnabled: false, blockedDomains: [] }; }
}

function setStoredSettings(settings) {
  localStorage.setItem('snaptext_settings', JSON.stringify(settings));
}

// ── Firebase Auth REST API ─────────────────────────────────────────────
async function firebaseSignUp(email, password) {
  try {
    const response = await fetch(`${FIREBASE_AUTH_URL}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error?.message || 'Sign up failed' };
    }

    const data = await response.json();
    const session = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      localId: data.localId,
      email: data.email,
      expiresAt: Date.now() + (data.expiresIn * 1000)
    };

    setStoredSession(session);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function firebaseSignIn(email, password) {
  try {
    const response = await fetch(`${FIREBASE_AUTH_URL}/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error?.message || 'Sign in failed' };
    }

    const data = await response.json();
    const session = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      localId: data.localId,
      email: data.email,
      expiresAt: Date.now() + (data.expiresIn * 1000)
    };

    setStoredSession(session);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function firebaseRefreshToken(refreshToken) {
  try {
    const response = await fetch(FIREBASE_SECURE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&key=${FIREBASE_CONFIG.apiKey}`
    });

    if (!response.ok) {
      return { success: false, error: 'Token refresh failed' };
    }

    const data = await response.json();
    const oldSession = getStoredSession();
    const session = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      localId: data.user_id,
      email: oldSession?.email,
      expiresAt: Date.now() + (data.expires_in * 1000)
    };

    setStoredSession(session);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function firebaseSignOut() {
  setStoredSession(null);
  return { success: true };
}

async function getValidSession() {
  const session = getStoredSession();
  if (!session) return null;

  // Check if token is expired or about to expire (within 1 minute)
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
    if (session.refreshToken) {
      const result = await firebaseRefreshToken(session.refreshToken);
      if (result.success) {
        return result.session;
      }
    }
    setStoredSession(null);
    return null;
  }

  return session;
}

// ── Firestore Value Conversion ─────────────────────────────────────────
function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreDoc(value) } };
  }
  return { stringValue: String(value) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function fromFirestoreValue(value) {
  if (value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue).getTime();
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (value.mapValue !== undefined) {
    return fromFirestoreDoc(value.mapValue.fields || {});
  }
  return null;
}

function fromFirestoreDoc(fields) {
  const obj = {};
  for (const [key, value] of Object.entries(fields)) {
    obj[key] = fromFirestoreValue(value);
  }
  return obj;
}

// ── Firestore REST API ─────────────────────────────────────────────────
async function firestoreGet(collection, docId, idToken) {
  try {
    const response = await fetch(`${FIREBASE_FIRESTORE_URL}/${collection}/${docId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) return null;

    const doc = await response.json();
    return { id: doc.name.split('/').pop(), ...fromFirestoreDoc(doc.fields || {}) };
  } catch (error) {
    console.error('Firestore GET error:', error);
    return null;
  }
}

async function firestoreQuery(collection, filters, idToken) {
  try {
    const structuredQuery = {
      from: [{ collectionId: collection }],
      where: { compositeFilter: { op: 'AND', filters } }
    };

    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    const response = await fetch(`${FIREBASE_FIRESTORE_URL}:runQuery`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) return [];

    const text = await response.text();
    if (!text) return [];

    const docs = [];
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const result = JSON.parse(line);
          if (result.document) {
            docs.push({
              id: result.document.name.split('/').pop(),
              ...fromFirestoreDoc(result.document.fields || {})
            });
          }
        } catch (e) { /* Skip malformed lines */ }
      }
    }
    return docs;
  } catch (error) {
    console.error('Firestore Query error:', error);
    return [];
  }
}

async function firestoreSet(collection, docId, data, idToken) {
  try {
    const docPath = docId ? `${collection}/${docId}` : collection;
    const response = await fetch(`${FIREBASE_FIRESTORE_URL}/${docPath}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: toFirestoreDoc(data) })
    });

    if (!response.ok) return null;
    const doc = await response.json();
    return { id: doc.name.split('/').pop(), ...fromFirestoreDoc(doc.fields || {}) };
  } catch (error) {
    console.error('Firestore SET error:', error);
    return null;
  }
}

async function firestoreDelete(collection, docId, idToken) {
  try {
    const response = await fetch(`${FIREBASE_FIRESTORE_URL}/${collection}/${docId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  } catch (error) {
    console.error('Firestore DELETE error:', error);
    return false;
  }
}

// ── Sync with Firestore ────────────────────────────────────────────────
async function syncMacrosFromCloud() {
  const session = await getValidSession();
  if (!session) return { success: false, error: 'Not signed in' };

  const filters = [{
    fieldFilter: {
      field: { fieldPath: 'user_id' },
      op: 'EQUAL',
      value: { stringValue: session.localId }
    }
  }];

  const cloudMacros = await firestoreQuery('macros', filters, session.idToken);

  // Convert cloud format to local format
  const converted = cloudMacros.map(m => ({
    id: m.id,
    trigger: m.trigger,
    body: m.body,
    folder: m.folder || 'General',
    enabled: m.enabled !== false,
    useCount: m.useCount || 0,
    createdAt: m.created_at || Date.now(),
    updatedAt: m.updated_at || Date.now()
  }));

  macros = converted;
  setStoredMacros(macros);
  lastSyncTime = Date.now();

  return { success: true, count: macros.length };
}

async function pushMacroToCloud(macro) {
  const session = await getValidSession();
  if (!session) return false;

  const cloudMacro = {
    id: macro.id,
    user_id: session.localId,
    trigger: macro.trigger,
    body: macro.body,
    folder: macro.folder || 'General',
    enabled: macro.enabled !== false,
    created_at: macro.createdAt || Date.now(),
    updated_at: macro.updatedAt || Date.now()
  };

  return await firestoreSet('macros', macro.id, cloudMacro, session.idToken);
}

async function deleteMacroFromCloud(macroId) {
  const session = await getValidSession();
  if (!session) return false;
  return await firestoreDelete('macros', macroId, session.idToken);
}

// ── Cloud Sharing ──────────────────────────────────────────────────────
function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function publishToCloud(title, description, macrosList, isPublic) {
  const session = await getValidSession();
  if (!session) return { success: false, error: 'Sign in to share via cloud' };

  const shareCode = generateShortCode();
  const docId = 'share-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const payload = {
    share_code: shareCode,
    author_id: session.localId,
    author_name: session.email?.split('@')[0] || 'Anonymous',
    title,
    description: description || '',
    macros: macrosList.map(m => ({
      trigger: m.trigger,
      body: m.body,
      folder: m.folder || 'General'
    })),
    is_public: isPublic,
    download_count: 0,
    created_at: Date.now(),
    updated_at: Date.now()
  };

  const result = await firestoreSet('shared_snippets', docId, payload, session.idToken);
  if (result) {
    return { success: true, shareCode, id: docId };
  }
  return { success: false, error: 'Failed to publish' };
}

async function importFromCloud(shareCode) {
  const session = await getValidSession();

  const filters = [{
    fieldFilter: {
      field: { fieldPath: 'share_code' },
      op: 'EQUAL',
      value: { stringValue: shareCode }
    }
  }];

  const data = await firestoreQuery('shared_snippets', filters, session?.idToken || '');
  if (!data || data.length === 0) {
    return { success: false, error: 'Share code not found' };
  }

  const shared = data[0];
  const imported = (shared.macros || []).map(m => ({
    id: 'cloud-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    trigger: m.trigger,
    body: m.body,
    folder: m.folder || 'Imported',
    enabled: true,
    useCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }));

  macros = [...macros, ...imported];
  setStoredMacros(macros);

  // Push to cloud if signed in
  if (session) {
    for (const m of imported) {
      await pushMacroToCloud(m);
    }
  }

  return { success: true, count: imported.length, title: shared.title, author: shared.author_name };
}

async function browsePublicShares() {
  const filters = [{
    fieldFilter: {
      field: { fieldPath: 'is_public' },
      op: 'EQUAL',
      value: { booleanValue: true }
    }
  }];

  return await firestoreQuery('shared_snippets', filters, '');
}

async function getMyShares() {
  const session = await getValidSession();
  if (!session) return [];

  const filters = [{
    fieldFilter: {
      field: { fieldPath: 'author_id' },
      op: 'EQUAL',
      value: { stringValue: session.localId }
    }
  }];

  return await firestoreQuery('shared_snippets', filters, session.idToken);
}

async function deleteShare(shareId) {
  const session = await getValidSession();
  if (!session) return { success: false };
  const result = await firestoreDelete('shared_snippets', shareId, session.idToken);
  return { success: result };
}

// ── UI Rendering ───────────────────────────────────────────────────────
function esc(s) {
  return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
}

function getAllFolders() {
  const fromMacros = macros.map(m => m.folder || 'General');
  return [...new Set(fromMacros)].sort();
}

function renderAll() {
  renderFolders();
  renderMacroTable();
  updateStats();
}

function renderFolders() {
  const folders = getAllFolders();
  const fl = $('#wd-folder-list');
  if (!fl) return;

  fl.innerHTML = folders.map(f => {
    const count = macros.filter(m => (m.folder || 'General') === f).length;
    const active = currentFolder === f ? 'active' : '';
    return `<div class="wd-sidebar-item ${active}" data-folder="${esc(f)}">
      <span class="wd-folder-icon">&#128193;</span> ${esc(f)}
      <span class="wd-count">${count}</span>
      <span class="wd-folder-actions">
        <button class="wd-folder-action-btn" data-rename="${esc(f)}" title="Rename">&#9998;</button>
        ${f !== 'General' ? `<button class="wd-folder-action-btn danger" data-delfolder="${esc(f)}" title="Delete">&#128465;</button>` : ''}
      </span>
    </div>`;
  }).join('');

  // Folder click handlers
  fl.querySelectorAll('.wd-sidebar-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.wd-folder-action-btn')) return;
      currentFolder = el.dataset.folder;
      $$('.wd-sidebar-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      $('#wd-view-title').textContent = currentFolder;
      showWdView('macros');
      renderMacroTable();
    });
  });

  // Rename handlers
  fl.querySelectorAll('[data-rename]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openWdFolderModal(el.dataset.rename);
    });
  });

  // Delete handlers
  fl.querySelectorAll('[data-delfolder]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = el.dataset.delfolder;
      if (!confirm(`Delete folder "${name}"? Macros will be moved to General.`)) return;

      // Move macros to General
      macros = macros.map(m => {
        if ((m.folder || 'General') === name) {
          return { ...m, folder: 'General', updatedAt: Date.now() };
        }
        return m;
      });
      setStoredMacros(macros);

      // Sync to cloud
      const session = await getValidSession();
      if (session) {
        for (const m of macros.filter(m => m.folder === 'General')) {
          await pushMacroToCloud(m);
        }
      }

      currentFolder = null;
      $('#wd-view-title').textContent = 'All Macros';
      renderAll();
    });
  });

  $('#wd-count-all').textContent = macros.length;
}

function renderMacroTable() {
  const q = ($('#wd-search')?.value || '').toLowerCase();
  let filtered = macros;
  if (currentFolder) filtered = filtered.filter(m => (m.folder || 'General') === currentFolder);
  if (q) filtered = filtered.filter(m =>
    m.trigger.toLowerCase().includes(q) ||
    m.body.toLowerCase().includes(q) ||
    (m.folder || '').toLowerCase().includes(q)
  );

  const wrap = $('#wd-macro-table-wrap');
  if (!wrap) return;

  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="wd-empty"><div class="wd-empty-icon">&#9889;</div><p>No macros found.</p><button class="wd-btn wd-btn-primary" id="wd-btn-empty-new">+ New Macro</button></div>`;
    const emptyBtn = $('#wd-btn-empty-new');
    if (emptyBtn) emptyBtn.addEventListener('click', () => openWdMacroModal());
    return;
  }

  filtered.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));

  wrap.innerHTML = `
    <table class="wd-macro-table">
      <thead><tr><th>Trigger</th><th>Body</th><th>Folder</th><th>Used</th><th>On</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(m => `
        <tr>
          <td class="wd-trigger-cell">;${esc(m.trigger)}</td>
          <td class="wd-body-cell" title="${esc(m.body)}">${esc(m.body)}</td>
          <td><span class="wd-folder-badge">${esc(m.folder || 'General')}</span></td>
          <td><span class="wd-use-count">${m.useCount || 0}x</span></td>
          <td><label class="wd-toggle-switch"><input type="checkbox" ${m.enabled !== false ? 'checked' : ''} data-toggle="${m.id}" /><span class="wd-toggle-slider"></span></label></td>
          <td><div class="wd-actions-cell"><button class="wd-btn wd-btn-sm" data-edit="${m.id}">Edit</button></div></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  // Toggle handlers
  wrap.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('change', async () => {
      const macro = macros.find(m => m.id === el.dataset.toggle);
      if (macro) {
        macro.enabled = el.checked;
        macro.updatedAt = Date.now();
        setStoredMacros(macros);
        await pushMacroToCloud(macro);
      }
    });
  });

  // Edit handlers
  wrap.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => openWdMacroModal(el.dataset.edit));
  });
}

function updateStats() {
  const statTotal = $('#wd-stat-total');
  if (statTotal) statTotal.textContent = macros.length;

  const syncStatus = $('#wd-sync-status');
  if (syncStatus && lastSyncTime) {
    const ago = Math.round((Date.now() - lastSyncTime) / 60000);
    syncStatus.textContent = ago < 1 ? 'Just now' : `${ago}m ago`;
  }
}

// ── Macro Modal ────────────────────────────────────────────────────────
function openWdMacroModal(id) {
  editingMacroId = id || null;
  const modal = $('#wd-modal-macro');
  const triggerError = $('#wd-trigger-error');

  if (triggerError) triggerError.classList.remove('visible');

  if (id) {
    const m = macros.find(x => x.id === id);
    if (!m) return;
    $('#wd-modal-title').textContent = 'Edit Macro';
    $('#wd-macro-trigger').value = m.trigger;
    $('#wd-macro-body').value = m.body;
    $('#wd-macro-folder').value = m.folder || '';
    $('#wd-modal-delete').style.display = 'inline-flex';
    updateWdPreview();
  } else {
    $('#wd-modal-title').textContent = 'New Macro';
    $('#wd-macro-trigger').value = '';
    $('#wd-macro-body').value = '';
    $('#wd-macro-folder').value = currentFolder || '';
    $('#wd-modal-delete').style.display = 'none';
    $('#wd-macro-preview').textContent = 'Type in the body above to see a preview...';
  }

  modal.classList.add('visible');
  setTimeout(() => $('#wd-macro-trigger').focus(), 100);
}

function closeWdMacroModal() {
  $('#wd-modal-macro').classList.remove('visible');
  editingMacroId = null;
}

function updateWdPreview() {
  const body = $('#wd-macro-body').value;
  const preview = $('#wd-macro-preview');
  if (!body) {
    preview.textContent = 'Type in the body above to see a preview...';
    return;
  }
  let text = body
    // Text wrappers
    .replace(/\{\{uppercase\}\}([\s\S]*?)\{\{\/uppercase\}\}/gi, (_, inner) => inner.toUpperCase())
    .replace(/\{\{lowercase\}\}([\s\S]*?)\{\{\/lowercase\}\}/gi, (_, inner) => inner.toLowerCase())
    // Simple variables
    .replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{time\}\}/gi, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    // Relative dates
    .replace(/\{\{date([+-])(\d+)\}\}/gi, (_, op, days) => {
      const d = new Date();
      d.setDate(d.getDate() + (op === '+' ? parseInt(days, 10) : -parseInt(days, 10)));
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    })
    // Random selection (show first option in preview)
    .replace(/\{\{random:([^}]+)\}\}/gi, (_, items) => {
      const options = items.split(',').map(s => s.trim()).filter(s => s);
      return options.length > 0 ? `[random: ${options[0]}]` : '[random]';
    })
    // Math expressions
    .replace(/\{\{calc:([^}]+)\}\}/gi, (_, expr) => {
      if (!/^[\d\s+\-*/().]+$/.test(expr)) return '[invalid calc]';
      try { return Function('"use strict"; return (' + expr + ')')(); } catch { return '[calc error]'; }
    })
    // Select dropdown (show options in preview)
    .replace(/\{\{select:([^}]+)\}\}/gi, (_, items) => {
      const options = items.split(',').map(s => s.trim()).filter(s => s);
      return options.length > 0 ? `[select: ${options.join('/')}]` : '[select]';
    })
    .replace(/\{\{clipboard\}\}/gi, '[clipboard]')
    .replace(/\{\{cursor\}\}/gi, '|')
    .replace(/\{\{input:([^}]+)\}\}/gi, '[$1]')
    .replace(/\{\{macro:([^}]+)\}\}/gi, (_, name) => {
      const ref = macros.find(m => m.trigger.toLowerCase() === name.toLowerCase());
      return ref ? `[${ref.body.substring(0, 30)}...]` : `[macro:${name}]`;
    });
  preview.textContent = text;
}

function checkWdDuplicate() {
  const trigger = $('#wd-macro-trigger').value.trim().replace(/^;/, '').toLowerCase();
  const existing = macros.find(m => m.trigger.toLowerCase() === trigger && m.id !== editingMacroId);
  const errorEl = $('#wd-trigger-error');
  if (existing) {
    errorEl.classList.add('visible');
    return true;
  }
  errorEl.classList.remove('visible');
  return false;
}

async function saveWdMacro() {
  const trigger = $('#wd-macro-trigger').value.trim().replace(/^;/, '');
  const body = $('#wd-macro-body').value;
  const folder = $('#wd-macro-folder').value.trim() || 'General';

  if (!trigger || !body) {
    alert('Trigger and body are required.');
    return;
  }
  if (checkWdDuplicate()) {
    alert('A macro with this trigger already exists.');
    return;
  }

  let macro;
  if (editingMacroId) {
    macro = macros.find(x => x.id === editingMacroId);
    if (macro) {
      macro.trigger = trigger;
      macro.body = body;
      macro.folder = folder;
      macro.updatedAt = Date.now();
    }
  } else {
    macro = {
      id: 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      trigger,
      body,
      folder,
      enabled: true,
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    macros.push(macro);
  }

  setStoredMacros(macros);
  await pushMacroToCloud(macro);

  closeWdMacroModal();
  renderAll();
  populateWdShareFolders();
}

async function deleteWdMacro() {
  if (!editingMacroId || !confirm('Delete this macro?')) return;

  await deleteMacroFromCloud(editingMacroId);
  macros = macros.filter(m => m.id !== editingMacroId);
  setStoredMacros(macros);

  closeWdMacroModal();
  renderAll();
}

// ── Folder Modal ───────────────────────────────────────────────────────
function openWdFolderModal(renameFrom) {
  renamingFolder = renameFrom || null;
  const errorEl = $('#wd-folder-error');
  if (errorEl) errorEl.classList.remove('visible');

  if (renameFrom) {
    $('#wd-folder-modal-title').textContent = 'Rename Folder';
    $('#wd-folder-name-input').value = renameFrom;
    $('#wd-folder-modal-save').textContent = 'Rename';
  } else {
    $('#wd-folder-modal-title').textContent = 'New Folder';
    $('#wd-folder-name-input').value = '';
    $('#wd-folder-modal-save').textContent = 'Create';
  }

  $('#wd-modal-folder').classList.add('visible');
  setTimeout(() => $('#wd-folder-name-input').focus(), 100);
}

function closeWdFolderModal() {
  $('#wd-modal-folder').classList.remove('visible');
  renamingFolder = null;
}

async function saveWdFolderAction() {
  const name = $('#wd-folder-name-input').value.trim();
  if (!name) return;

  if (renamingFolder) {
    if (name === renamingFolder) return closeWdFolderModal();

    // Rename folder in all macros
    macros = macros.map(m => {
      if ((m.folder || 'General') === renamingFolder) {
        return { ...m, folder: name, updatedAt: Date.now() };
      }
      return m;
    });
    setStoredMacros(macros);

    // Sync renamed macros to cloud
    const session = await getValidSession();
    if (session) {
      for (const m of macros.filter(m => m.folder === name)) {
        await pushMacroToCloud(m);
      }
    }

    if (currentFolder === renamingFolder) currentFolder = name;
  } else {
    // Check if folder exists
    const existing = getAllFolders().find(f => f.toLowerCase() === name.toLowerCase());
    if (existing) {
      const errorEl = $('#wd-folder-error');
      if (errorEl) {
        errorEl.textContent = 'This folder already exists.';
        errorEl.classList.add('visible');
      }
      return;
    }
  }

  closeWdFolderModal();
  renderAll();
  populateWdShareFolders();
}

// ── View Switching ─────────────────────────────────────────────────────
function showWdView(view) {
  ['macros', 'share', 'settings', 'account'].forEach(v => {
    const el = $(`#wd-view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });

  const statsRow = $('#wd-stats-row');
  if (statsRow) statsRow.style.display = view === 'macros' ? '' : 'none';
}

function showWdShareTab(tab) {
  ['publish', 'import', 'explore', 'my-shares'].forEach(t => {
    const el = $(`#wd-stab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  $$('.wd-share-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab));

  if (tab === 'explore') loadWdExplore();
  if (tab === 'my-shares') loadWdMyShares();
}

// ── Share & Explore ────────────────────────────────────────────────────
function populateWdShareFolders() {
  const folders = getAllFolders();
  const sel = $('#wd-share-folder-select');
  if (!sel) return;
  sel.innerHTML = '<option value="__all__">All Macros</option>' +
    folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
}

async function wdPublishToCloud() {
  const folder = $('#wd-share-folder-select').value;
  const title = $('#wd-share-title').value.trim();
  if (!title) return alert('Give your snippet pack a title.');

  const toShare = folder === '__all__' ? macros : macros.filter(m => (m.folder || 'General') === folder);
  if (toShare.length === 0) return alert('No macros to share.');

  const description = $('#wd-share-desc').value.trim();
  const isPublic = $('#wd-share-public').checked;

  const result = await publishToCloud(title, description, toShare, isPublic);
  const box = $('#wd-publish-result');

  if (result.success) {
    box.innerHTML = `
      <div class="wd-success-box">
        <div class="wd-success-title">Published!</div>
        <div class="wd-share-code-display">
          ${result.shareCode}
          <button class="wd-copy-btn" id="wd-btn-copy-share-code">Copy</button>
        </div>
        <div class="wd-success-hint">Share this code with anyone. They can import in the Import tab.</div>
      </div>`;
    const copyBtn = $('#wd-btn-copy-share-code');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(result.shareCode);
        copyBtn.textContent = 'Copied!';
      });
    }
  } else {
    box.innerHTML = `<div class="wd-error-text">${result.error || 'Failed to publish. Are you signed in?'}</div>`;
  }
  box.style.display = 'block';
}

async function wdImportFromCloud() {
  const code = $('#wd-cloud-import-code').value.trim();
  if (!code) return alert('Enter a share code.');

  const result = await importFromCloud(code);
  const box = $('#wd-import-result');

  if (result.success) {
    renderAll();
    populateWdShareFolders();
    const authorPart = result.author ? ` by ${result.author}` : '';
    const titlePart = result.title ? `"${result.title}"${authorPart} — ` : '';
    box.innerHTML = `<div class="wd-success-box">${titlePart}Imported ${result.count} macro(s)!</div>`;
    $('#wd-cloud-import-code').value = '';
  } else {
    box.innerHTML = `<div class="wd-error-text">${result.error || 'Invalid share code.'}</div>`;
  }
  box.style.display = 'block';
}

async function loadWdExplore() {
  const results = await browsePublicShares();
  const grid = $('#wd-explore-grid');
  const empty = $('#wd-explore-empty');

  if (!results || results.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = results.map(s => `
    <div class="wd-explore-card">
      <div class="wd-ec-title">${esc(s.title)}</div>
      <div class="wd-ec-desc">${esc(s.description || 'No description')}</div>
      <div class="wd-ec-meta">
        <span>&#128100; ${esc(s.author_name || 'Anonymous')}</span>
        <span>&#128230; ${(s.macros || []).length} macros</span>
        <span>&#11015; ${s.download_count || 0} imports</span>
      </div>
      <button class="wd-btn wd-btn-sm wd-btn-primary" data-import-cloud="${esc(s.share_code)}">Import</button>
      <span class="wd-share-code-hint">Code: ${esc(s.share_code)}</span>
    </div>`).join('');

  grid.querySelectorAll('[data-import-cloud]').forEach(el => {
    el.addEventListener('click', async () => {
      const code = el.dataset.importCloud;
      const result = await importFromCloud(code);
      if (result.success) {
        renderAll();
        el.textContent = `Imported ${result.count}!`;
        el.disabled = true;
      } else {
        alert(result.error || 'Import failed.');
      }
    });
  });
}

async function loadWdMyShares() {
  const shares = await getMyShares();
  const wrap = $('#wd-my-shares-wrap');

  if (!shares || shares.length === 0) {
    wrap.innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">&#128279;</div><p>You haven\'t shared any snippet packs yet.</p></div>';
    return;
  }

  wrap.innerHTML = `
    <table class="wd-my-shares-table">
      <thead><tr><th>Title</th><th>Code</th><th>Macros</th><th>Downloads</th><th>Public</th><th></th></tr></thead>
      <tbody>${shares.map(s => `
        <tr>
          <td style="font-weight:600;">${esc(s.title)}</td>
          <td class="wd-share-code-cell">${esc(s.share_code)}</td>
          <td>${(s.macros || []).length}</td>
          <td>${s.download_count || 0}</td>
          <td>${s.is_public ? '<span class="wd-public-yes">Yes</span>' : 'No'}</td>
          <td><button class="wd-btn wd-btn-sm wd-btn-danger" data-delete-share="${s.id}">Delete</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('[data-delete-share]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Delete this shared pack?')) return;
      await deleteShare(el.dataset.deleteShare);
      loadWdMyShares();
    });
  });
}

// ── Settings ───────────────────────────────────────────────────────────
function loadWdSettings() {
  const settings = getStoredSettings();
  const triggerEl = $('#wd-set-trigger');
  const syncEl = $('#wd-set-sync');

  if (triggerEl) triggerEl.value = settings.triggerChar || ';';
  if (syncEl) syncEl.checked = settings.syncEnabled || false;

  renderWdBlockedDomains(settings.blockedDomains || []);
}

function renderWdBlockedDomains(domains) {
  const list = $('#wd-domain-list');
  if (!list) return;

  list.innerHTML = domains.map(d =>
    `<span class="wd-domain-tag">${esc(d)} <span class="wd-remove" data-domain="${esc(d)}">&times;</span></span>`
  ).join('');

  list.querySelectorAll('.wd-remove').forEach(el => {
    el.addEventListener('click', () => {
      const settings = getStoredSettings();
      settings.blockedDomains = (settings.blockedDomains || []).filter(d => d !== el.dataset.domain);
      setStoredSettings(settings);
      renderWdBlockedDomains(settings.blockedDomains);
    });
  });
}

function addWdBlockedDomain() {
  const input = $('#wd-domain-input');
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;

  const settings = getStoredSettings();
  if (!settings.blockedDomains) settings.blockedDomains = [];
  if (!settings.blockedDomains.includes(domain)) {
    settings.blockedDomains.push(domain);
    setStoredSettings(settings);
  }
  renderWdBlockedDomains(settings.blockedDomains);
  input.value = '';
}

function saveWdSettings() {
  const settings = getStoredSettings();
  settings.triggerChar = $('#wd-set-trigger').value || ';';
  settings.syncEnabled = $('#wd-set-sync').checked;
  setStoredSettings(settings);
  alert('Settings saved!');
}

// ── Auth UI ────────────────────────────────────────────────────────────
function checkWdAuth(session) {
  const loggedOut = $('#wd-auth-logged-out');
  const loggedIn = $('#wd-auth-logged-in');
  const navSignin = $('#nav-signin');
  const navDashboard = $('#nav-dashboard');

  if (session?.idToken && session?.email) {
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'block';
    $('#wd-auth-user-email').textContent = session.email;
    $('#wd-user-info').textContent = session.email;
    if (navSignin) navSignin.style.display = 'none';
    if (navDashboard) navDashboard.style.display = 'inline-flex';
  } else {
    if (loggedOut) loggedOut.style.display = 'block';
    if (loggedIn) loggedIn.style.display = 'none';
    if ($('#wd-user-info')) $('#wd-user-info').textContent = 'Not signed in';
    if (navSignin) navSignin.style.display = 'inline-flex';
    if (navDashboard) navDashboard.style.display = 'none';
  }
}

async function wdSignIn() {
  const email = $('#wd-auth-email').value.trim();
  const password = $('#wd-auth-password').value;
  if (!email || !password) return alert('Email and password required.');

  const result = await firebaseSignIn(email, password);
  if (result.success) {
    checkWdAuth(result.session);
    await syncMacrosFromCloud();
    renderAll();
  } else {
    alert(result.error || 'Sign in failed.');
  }
}

async function wdSignUp() {
  const email = $('#wd-auth-email').value.trim();
  const password = $('#wd-auth-password').value;
  if (!email || !password) return alert('Email and password required.');
  if (password.length < 6) return alert('Password must be at least 6 characters.');

  const result = await firebaseSignUp(email, password);
  if (result.success) {
    checkWdAuth(result.session);
    // Push any existing local macros to cloud
    for (const m of macros) {
      await pushMacroToCloud(m);
    }
    alert('Account created and signed in!');
  } else {
    alert(result.error || 'Sign up failed.');
  }
}

async function wdSignOut() {
  await firebaseSignOut();
  checkWdAuth(null);
  showLandingPage();
}

async function wdSyncNow() {
  const result = await syncMacrosFromCloud();
  if (result.success) {
    renderAll();
    alert(`Synced ${result.count} macro(s)!`);
  } else {
    alert(result.error || 'Sync failed.');
  }
}

// ── Export/Import ──────────────────────────────────────────────────────
function wdExportJSON() {
  const toExport = currentFolder ? macros.filter(m => (m.folder || 'General') === currentFolder) : macros;
  const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = currentFolder ? `-${currentFolder.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.href = url;
  a.download = `snaptext-macros${suffix}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function wdExportCSV() {
  const toExport = currentFolder ? macros.filter(m => (m.folder || 'General') === currentFolder) : macros;
  const header = 'trigger,body,folder,enabled,useCount';
  const rows = toExport.map(m => {
    const body = '"' + (m.body || '').replace(/"/g, '""') + '"';
    const folder = '"' + (m.folder || 'General').replace(/"/g, '""') + '"';
    return `"${m.trigger}",${body},${folder},${m.enabled !== false},${m.useCount || 0}`;
  });
  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = currentFolder ? `-${currentFolder.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.href = url;
  a.download = `snaptext-macros${suffix}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function wdImportFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    if (file.name.endsWith('.csv')) {
      const imported = parseCSVImport(text);
      if (!imported) {
        alert('Invalid CSV file.');
        return;
      }
      macros = [...macros, ...imported];
      setStoredMacros(macros);

      // Sync to cloud
      const session = await getValidSession();
      if (session) {
        for (const m of imported) {
          await pushMacroToCloud(m);
        }
      }

      renderAll();
      alert(`Imported ${imported.length} macros from CSV!`);
    } else {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error();
        const imported = parsed.map(m => ({
          ...m,
          id: m.id || 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        }));
        macros = [...macros, ...imported];
        setStoredMacros(macros);

        // Sync to cloud
        const session = await getValidSession();
        if (session) {
          for (const m of imported) {
            await pushMacroToCloud(m);
          }
        }

        renderAll();
        alert(`Imported ${imported.length} macros!`);
      } catch {
        alert('Invalid JSON file.');
      }
    }
  };
  reader.readAsText(file);
}

function parseCSVImport(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  const macrosList = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row && row.length >= 2) {
      macrosList.push({
        id: 'csv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        trigger: row[0],
        body: row[1],
        folder: row[2] || 'Imported',
        enabled: row[3] !== 'false',
        useCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
  }
  return macrosList.length > 0 ? macrosList : null;
}

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ── Page Switching ─────────────────────────────────────────────────────
function showDashboard() {
  const landing = $('#landing-page');
  const dashboard = $('#web-dashboard');
  const navSignin = $('#nav-signin');
  const navDashboard = $('#nav-dashboard');

  if (landing) landing.style.display = 'none';
  if (dashboard) dashboard.style.display = 'flex';
  if (navSignin) navSignin.style.display = 'none';
  if (navDashboard) navDashboard.style.display = 'inline-flex';

  window.history.replaceState(null, '', '#dashboard');
}

function showLandingPage() {
  const landing = $('#landing-page');
  const dashboard = $('#web-dashboard');
  const navSignin = $('#nav-signin');
  const navDashboard = $('#nav-dashboard');

  if (landing) landing.style.display = 'block';
  if (dashboard) dashboard.style.display = 'none';
  if (navSignin) navSignin.style.display = 'inline-flex';
  if (navDashboard) navDashboard.style.display = 'none';

  window.history.replaceState(null, '', window.location.pathname);
}

function openAuthModal() {
  $('#auth-modal').classList.add('visible');
  setTimeout(() => $('#auth-modal-email').focus(), 100);
}

function closeAuthModal() {
  $('#auth-modal').classList.remove('visible');
}

async function authModalSignIn() {
  const email = $('#auth-modal-email').value.trim();
  const password = $('#auth-modal-password').value;
  const errorEl = $('#auth-modal-error');

  if (!email || !password) {
    errorEl.textContent = 'Email and password required.';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  const result = await firebaseSignIn(email, password);

  if (result.success) {
    closeAuthModal();
    await syncMacrosFromCloud();
    macros = getStoredMacros();
    renderAll();
    checkWdAuth(result.session);
    showDashboard();
  } else {
    errorEl.textContent = result.error || 'Sign in failed.';
    errorEl.style.display = 'block';
  }
}

async function authModalSignUp() {
  const email = $('#auth-modal-email').value.trim();
  const password = $('#auth-modal-password').value;
  const errorEl = $('#auth-modal-error');

  if (!email || !password) {
    errorEl.textContent = 'Email and password required.';
    errorEl.style.display = 'block';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters.';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  const result = await firebaseSignUp(email, password);

  if (result.success) {
    closeAuthModal();
    checkWdAuth(result.session);
    showDashboard();
  } else {
    errorEl.textContent = result.error || 'Sign up failed.';
    errorEl.style.display = 'block';
  }
}

// ── Initialization ─────────────────────────────────────────────────────
async function initWebDashboard() {
  // Load cached macros
  macros = getStoredMacros();

  // Check for existing session
  const session = await getValidSession();

  // Check URL hash
  const hash = window.location.hash;

  if (session) {
    checkWdAuth(session);

    // Sync from cloud
    await syncMacrosFromCloud();
    macros = getStoredMacros();

    if (hash === '#dashboard' || hash === '#settings' || hash === '#share' || hash === '#account') {
      showDashboard();
      renderAll();
      populateWdShareFolders();
      loadWdSettings();

      if (hash === '#settings') showWdView('settings');
      else if (hash === '#share') showWdView('share');
      else if (hash === '#account') showWdView('account');
    }
  } else {
    checkWdAuth(null);
    if (hash === '#signin') {
      openAuthModal();
    }
  }
}

// ── Event Binding ──────────────────────────────────────────────────────
function bindWebDashboardEvents() {
  // Nav buttons
  const navSignin = $('#nav-signin');
  const navDashboard = $('#nav-dashboard');

  if (navSignin) {
    navSignin.addEventListener('click', (e) => {
      e.preventDefault();
      openAuthModal();
    });
  }

  if (navDashboard) {
    navDashboard.addEventListener('click', (e) => {
      e.preventDefault();
      showDashboard();
      renderAll();
      populateWdShareFolders();
      loadWdSettings();
    });
  }

  // Auth modal
  const authModal = $('#auth-modal');
  if (authModal) {
    $('#auth-modal-close').addEventListener('click', closeAuthModal);
    $('#auth-modal-signin').addEventListener('click', authModalSignIn);
    $('#auth-modal-signup').addEventListener('click', authModalSignUp);
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
    $('#auth-modal-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') authModalSignIn();
    });
  }

  // Dashboard sidebar menu
  $$('.wd-sidebar-item[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      currentFolder = null;
      $$('.wd-sidebar-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      showWdView(el.dataset.view);
      if (el.dataset.view === 'macros') {
        $('#wd-view-title').textContent = 'All Macros';
        renderMacroTable();
      }
      if (el.dataset.view === 'share') populateWdShareFolders();
    });
  });

  // Share tabs
  $$('.wd-share-tab').forEach(el => {
    el.addEventListener('click', () => showWdShareTab(el.dataset.stab));
  });

  // Macro modal
  const btnNewMacro = $('#wd-btn-new-macro');
  if (btnNewMacro) btnNewMacro.addEventListener('click', () => openWdMacroModal());

  const modalClose = $('#wd-modal-close');
  if (modalClose) modalClose.addEventListener('click', closeWdMacroModal);

  const modalCancel = $('#wd-modal-cancel');
  if (modalCancel) modalCancel.addEventListener('click', closeWdMacroModal);

  const modalSave = $('#wd-modal-save');
  if (modalSave) modalSave.addEventListener('click', saveWdMacro);

  const modalDelete = $('#wd-modal-delete');
  if (modalDelete) modalDelete.addEventListener('click', deleteWdMacro);

  const searchInput = $('#wd-search');
  if (searchInput) searchInput.addEventListener('input', renderMacroTable);

  const macroBody = $('#wd-macro-body');
  if (macroBody) macroBody.addEventListener('input', updateWdPreview);

  const macroTrigger = $('#wd-macro-trigger');
  if (macroTrigger) macroTrigger.addEventListener('input', checkWdDuplicate);

  // Folder modal
  const btnAddFolder = $('#wd-btn-add-folder');
  if (btnAddFolder) btnAddFolder.addEventListener('click', () => openWdFolderModal());

  const folderModalClose = $('#wd-folder-modal-close');
  if (folderModalClose) folderModalClose.addEventListener('click', closeWdFolderModal);

  const folderModalCancel = $('#wd-folder-modal-cancel');
  if (folderModalCancel) folderModalCancel.addEventListener('click', closeWdFolderModal);

  const folderModalSave = $('#wd-folder-modal-save');
  if (folderModalSave) folderModalSave.addEventListener('click', saveWdFolderAction);

  const folderNameInput = $('#wd-folder-name-input');
  if (folderNameInput) {
    folderNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveWdFolderAction();
    });
  }

  // Export dropdown
  const btnExportToggle = $('#wd-btn-export-toggle');
  if (btnExportToggle) {
    btnExportToggle.addEventListener('click', () => {
      $('#wd-export-menu').classList.toggle('visible');
    });
  }

  document.addEventListener('click', (e) => {
    const exportMenu = $('#wd-export-menu');
    if (exportMenu && !e.target.closest('.wd-export-dropdown')) {
      exportMenu.classList.remove('visible');
    }
  });

  const btnExportJson = $('#wd-btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      wdExportJSON();
      $('#wd-export-menu').classList.remove('visible');
    });
  }

  const btnExportCsv = $('#wd-btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      wdExportCSV();
      $('#wd-export-menu').classList.remove('visible');
    });
  }

  // Import
  const btnImport = $('#wd-btn-import');
  if (btnImport) {
    btnImport.addEventListener('click', () => $('#wd-file-import').click());
  }

  const fileImport = $('#wd-file-import');
  if (fileImport) {
    fileImport.addEventListener('change', (e) => {
      if (e.target.files[0]) wdImportFile(e.target.files[0]);
      e.target.value = '';
    });
  }

  // Cloud sharing
  const btnPublishCloud = $('#wd-btn-publish-cloud');
  if (btnPublishCloud) btnPublishCloud.addEventListener('click', wdPublishToCloud);

  const btnImportCloud = $('#wd-btn-import-cloud');
  if (btnImportCloud) btnImportCloud.addEventListener('click', wdImportFromCloud);

  // Auth (dashboard view)
  const btnSignin = $('#wd-btn-signin');
  if (btnSignin) btnSignin.addEventListener('click', wdSignIn);

  const btnSignup = $('#wd-btn-signup');
  if (btnSignup) btnSignup.addEventListener('click', wdSignUp);

  const btnSignout = $('#wd-btn-signout');
  if (btnSignout) btnSignout.addEventListener('click', wdSignOut);

  const btnSyncNow = $('#wd-btn-sync-now');
  if (btnSyncNow) btnSyncNow.addEventListener('click', wdSyncNow);

  // Settings
  const btnSaveSettings = $('#wd-btn-save-settings');
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveWdSettings);

  const btnAddDomain = $('#wd-btn-add-domain');
  if (btnAddDomain) btnAddDomain.addEventListener('click', addWdBlockedDomain);

  const domainInput = $('#wd-domain-input');
  if (domainInput) {
    domainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWdBlockedDomain();
    });
  }

  // Modal dismiss on overlay click
  const modalMacro = $('#wd-modal-macro');
  if (modalMacro) {
    modalMacro.addEventListener('click', (e) => {
      if (e.target === modalMacro) closeWdMacroModal();
    });
  }

  const modalFolder = $('#wd-modal-folder');
  if (modalFolder) {
    modalFolder.addEventListener('click', (e) => {
      if (e.target === modalFolder) closeWdFolderModal();
    });
  }

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeWdMacroModal();
      closeWdFolderModal();
      closeAuthModal();
    }
  });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  bindWebDashboardEvents();
  initWebDashboard();
});
