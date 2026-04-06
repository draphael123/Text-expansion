let macros = [];
let currentFolder = null;
let editingMacroId = null;
let renamingFolder = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Init ────────────────────────────────────────────────────────────
async function init() {
  const data = await chrome.storage.local.get(['macros', 'session', 'settings', 'stats', 'charsSaved', 'conflicts', 'folders', 'isOnline']);
  macros = data.macros || [];
  renderAll();
  renderStats(data.stats || {}, data.charsSaved || 0);
  checkAuth(data.session);
  loadSettings(data.settings);
  showConflicts(data.conflicts || []);
  populateShareFolders();
  updateFolderDatalist();
  updateOfflineStatus(data.isOnline !== false);

  if (new URLSearchParams(location.search).get('add') === 'true') openMacroModal();
}

// ── Offline indicator ───────────────────────────────────────────────
function updateOfflineStatus(isOnline) {
  const banner = $('#offline-banner');
  if (banner) {
    banner.style.display = isOnline ? 'none' : 'flex';
  }
}

// Listen for connectivity changes from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONNECTIVITY_CHANGED') {
    updateOfflineStatus(msg.isOnline);
  }
});

function showConflicts(conflicts) {
  if (conflicts.length > 0) {
    $('#conflict-banner').classList.add('visible');
    $('#conflict-count').textContent = conflicts.length;
  } else {
    $('#conflict-banner').classList.remove('visible');
  }
}

// ── Stats ───────────────────────────────────────────────────────────
function renderStats(stats, charsSaved) {
  const today = new Date().toISOString().slice(0, 10);
  let weekCount = 0;
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    weekCount += (stats[d.toISOString().slice(0, 10)] || 0);
  }
  $('#stat-total').textContent = macros.length;
  $('#stat-today').textContent = stats[today] || 0;
  $('#stat-week').textContent = weekCount;
  $('#stat-chars').textContent = charsSaved >= 1000 ? `${(charsSaved / 1000).toFixed(1)}k` : charsSaved;
}

// ── Render ──────────────────────────────────────────────────────────
function renderAll() { renderFolders(); renderMacroTable(); }

function getAllFolders() {
  const fromMacros = macros.map(m => m.folder || 'General');
  // Merge with explicit folders
  return [...new Set(fromMacros)].sort();
}

function renderFolders() {
  const folders = getAllFolders();
  const fl = $('#folder-list');
  fl.innerHTML = folders.map(f => {
    const count = macros.filter(m => (m.folder || 'General') === f).length;
    const active = currentFolder === f ? 'active' : '';
    return `<div class="sidebar-item ${active}" data-folder="${esc(f)}">
      &#128193; ${esc(f)} <span class="count">${count}</span>
      <span class="folder-actions">
        <button class="folder-action-btn" data-rename="${esc(f)}" title="Rename">&#9998;</button>
        ${f !== 'General' ? `<button class="folder-action-btn danger" data-delfolder="${esc(f)}" title="Delete">&#128465;</button>` : ''}
      </span>
    </div>`;
  }).join('');

  fl.querySelectorAll('.sidebar-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.folder-action-btn')) return;
      currentFolder = el.dataset.folder;
      $$('.sidebar-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      $('#view-title').textContent = currentFolder;
      showView('macros');
      renderMacroTable();
    });
  });

  fl.querySelectorAll('[data-rename]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(el.dataset.rename);
    });
  });

  fl.querySelectorAll('[data-delfolder]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = el.dataset.delfolder;
      if (!confirm(`Delete folder "${name}"? Macros will be moved to General.`)) return;
      const result = await chrome.runtime.sendMessage({ type: 'DELETE_FOLDER', name });
      if (result.success) {
        macros = result.macros;
        currentFolder = null;
        $('#view-title').textContent = 'All Macros';
        renderAll();
      }
    });
  });

  $('#count-all').textContent = macros.length;
}

function updateFolderDatalist() {
  const dl = $('#folder-datalist');
  if (!dl) return;
  const folders = getAllFolders();
  dl.innerHTML = folders.map(f => `<option value="${esc(f)}">`).join('');
}

function renderMacroTable() {
  const q = ($('#dash-search')?.value || '').toLowerCase();
  let filtered = macros;
  if (currentFolder) filtered = filtered.filter(m => (m.folder || 'General') === currentFolder);
  if (q) filtered = filtered.filter(m =>
    m.trigger.toLowerCase().includes(q) || m.body.toLowerCase().includes(q) || (m.folder || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    $('#macro-table-wrap').innerHTML = `<div class="empty"><div class="icon">&#9889;</div><p>No macros found.</p><button class="btn btn-primary" id="btn-empty-new-macro">+ New Macro</button></div>`;
    const emptyBtn = $('#btn-empty-new-macro');
    if (emptyBtn) emptyBtn.addEventListener('click', () => openMacroModal());
    return;
  }

  filtered.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));

  $('#macro-table-wrap').innerHTML = `
    <table class="macro-table">
      <thead><tr><th>Trigger</th><th>Body</th><th>Folder</th><th>Used</th><th>On</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(m => `
        <tr>
          <td class="trigger-cell">;${esc(m.trigger)}</td>
          <td class="body-cell" title="${esc(m.body)}">${esc(m.body)}</td>
          <td><span class="folder-badge">${esc(m.folder || 'General')}</span></td>
          <td><span class="use-count">${m.useCount || 0}x</span></td>
          <td><label class="toggle-switch"><input type="checkbox" ${m.enabled !== false ? 'checked' : ''} data-toggle="${m.id}" /><span class="toggle-slider"></span></label></td>
          <td><div class="actions-cell"><button class="btn btn-sm" data-edit="${m.id}">Edit</button></div></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  $$('[data-toggle]').forEach(el => {
    el.addEventListener('change', () => {
      const macro = macros.find(m => m.id === el.dataset.toggle);
      if (macro) { macro.enabled = el.checked; saveMacros(); }
    });
  });
  $$('[data-edit]').forEach(el => {
    el.addEventListener('click', () => openMacroModal(el.dataset.edit));
  });
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

// ── Folder CRUD ────────────────────────────────────────────────────
function openFolderModal(renameFrom) {
  renamingFolder = renameFrom || null;
  $('#folder-error').classList.remove('visible');
  if (renameFrom) {
    $('#folder-modal-title').textContent = 'Rename Folder';
    $('#folder-name-input').value = renameFrom;
    $('#folder-modal-save').textContent = 'Rename';
  } else {
    $('#folder-modal-title').textContent = 'New Folder';
    $('#folder-name-input').value = '';
    $('#folder-modal-save').textContent = 'Create';
  }
  $('#modal-folder').classList.add('visible');
  setTimeout(() => $('#folder-name-input').focus(), 100);
}

function closeFolderModal() { $('#modal-folder').classList.remove('visible'); renamingFolder = null; }

async function saveFolderAction() {
  const name = $('#folder-name-input').value.trim();
  if (!name) return;

  if (renamingFolder) {
    if (name === renamingFolder) return closeFolderModal();
    const result = await chrome.runtime.sendMessage({ type: 'RENAME_FOLDER', oldName: renamingFolder, newName: name });
    if (result.success) {
      macros = result.macros;
      if (currentFolder === renamingFolder) currentFolder = name;
      renderAll(); populateShareFolders(); updateFolderDatalist();
    }
  } else {
    const result = await chrome.runtime.sendMessage({ type: 'CREATE_FOLDER', name });
    if (!result.success) {
      $('#folder-error').textContent = result.error;
      $('#folder-error').classList.add('visible');
      return;
    }
    // Add empty folder — render it by adding explicit folder tracking
    renderAll(); updateFolderDatalist();
  }
  closeFolderModal();
}

// ── Macro CRUD ──────────────────────────────────────────────────────
function openMacroModal(id) {
  editingMacroId = id || null;
  $('#trigger-error').classList.remove('visible');
  if (id) {
    const m = macros.find(x => x.id === id); if (!m) return;
    $('#modal-title').textContent = 'Edit Macro';
    $('#macro-trigger').value = m.trigger;
    $('#macro-body').value = m.body;
    $('#macro-folder').value = m.folder || '';
    $('#macro-abbreviation').checked = m.isAbbreviation || false;
    if ($('#macro-richtext')) $('#macro-richtext').checked = m.richText || false;
    $('#modal-delete').style.display = 'inline-flex';
    updatePreview();
  } else {
    $('#modal-title').textContent = 'New Macro';
    $('#macro-trigger').value = '';
    $('#macro-body').value = '';
    $('#macro-folder').value = currentFolder || '';
    $('#macro-abbreviation').checked = false;
    if ($('#macro-richtext')) $('#macro-richtext').checked = false;
    $('#modal-delete').style.display = 'none';
    $('#macro-preview').textContent = 'Type in the body above to see a preview...';
  }
  $('#modal-macro').classList.add('visible');
  setTimeout(() => $('#macro-trigger').focus(), 100);
}
window.openMacroModal = openMacroModal;

function closeMacroModal() { $('#modal-macro').classList.remove('visible'); editingMacroId = null; }

function updatePreview() {
  const body = $('#macro-body').value;
  if (!body) { $('#macro-preview').textContent = 'Type in the body above to see a preview...'; return; }
  let preview = body
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
  $('#macro-preview').textContent = preview;
}

function checkDuplicate() {
  const trigger = $('#macro-trigger').value.trim().replace(/^;/, '').toLowerCase();
  const existing = macros.find(m => m.trigger.toLowerCase() === trigger && m.id !== editingMacroId);
  if (existing) { $('#trigger-error').classList.add('visible'); return true; }
  $('#trigger-error').classList.remove('visible');
  return false;
}

function saveMacro() {
  const trigger = $('#macro-trigger').value.trim().replace(/^;/, '');
  const body = $('#macro-body').value;
  const folder = $('#macro-folder').value.trim() || 'General';
  const isAbbreviation = $('#macro-abbreviation').checked;
  const richText = $('#macro-richtext') ? $('#macro-richtext').checked : false;
  if (!trigger || !body) return alert('Trigger and body are required.');
  if (checkDuplicate()) return alert('A macro with this trigger already exists.');

  if (editingMacroId) {
    const m = macros.find(x => x.id === editingMacroId);
    if (m) { m.trigger = trigger; m.body = body; m.folder = folder; m.isAbbreviation = isAbbreviation; m.richText = richText; m.updatedAt = Date.now(); }
  } else {
    macros.push({
      id: 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      trigger, body, folder, isAbbreviation, richText, enabled: true, useCount: 0,
      createdAt: Date.now(), updatedAt: Date.now()
    });
  }
  saveMacros(); closeMacroModal(); renderAll(); populateShareFolders(); updateFolderDatalist();
}

function deleteMacro() {
  if (!editingMacroId || !confirm('Delete this macro?')) return;
  macros = macros.filter(m => m.id !== editingMacroId);
  saveMacros(); closeMacroModal(); renderAll();
}

async function saveMacros() { await chrome.storage.local.set({ macros }); }

// ── Export ──────────────────────────────────────────────────────────
function exportJSON() {
  const toExport = currentFolder ? macros.filter(m => (m.folder || 'General') === currentFolder) : macros;
  const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = currentFolder ? `-${currentFolder.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.href = url; a.download = `snaptext-macros${suffix}-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function exportCSV() {
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
  a.href = url; a.download = `snaptext-macros${suffix}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    if (file.name.endsWith('.csv')) {
      const result = await chrome.runtime.sendMessage({ type: 'IMPORT_CSV', csv: text });
      if (result.success) {
        const { macros: updated } = await chrome.storage.local.get(['macros']);
        macros = updated || [];
        renderAll(); alert(`Imported ${result.count} macros from CSV!`);
      } else {
        alert(result.error || 'Invalid CSV file.');
      }
    } else {
      try {
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) throw new Error();
        macros = [...macros, ...imported.map(m => ({
          ...m, id: m.id || 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        }))];
        await saveMacros(); renderAll(); alert(`Imported ${imported.length} macros!`);
      } catch { alert('Invalid JSON file.'); }
    }
  };
  reader.readAsText(file);
}

// ── Cloud sharing ──────────────────────────────────────────────────
function populateShareFolders() {
  const folders = getAllFolders();
  const sel = $('#share-folder-select');
  if (!sel) return;
  sel.innerHTML = '<option value="__all__">All Macros</option>' +
    folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
}

async function publishToCloud() {
  const folder = $('#share-folder-select').value;
  const title = $('#share-title').value.trim();
  if (!title) return alert('Give your snippet pack a title.');

  const toShare = folder === '__all__' ? macros : macros.filter(m => (m.folder || 'General') === folder);
  if (toShare.length === 0) return alert('No macros to share.');

  const description = $('#share-desc').value.trim();
  const isPublic = $('#share-public').checked;

  const result = await chrome.runtime.sendMessage({
    type: 'PUBLISH_TO_CLOUD', title, description, macros: toShare, isPublic
  });

  const box = $('#publish-result');
  if (result.success) {
    box.innerHTML = `
      <div style="background:var(--success-bg);border:1px solid #A7F3D0;border-radius:8px;padding:14px;">
        <div style="font-size:13px;font-weight:600;color:#065F46;margin-bottom:8px;">Published!</div>
        <div class="share-code-display">
          ${result.shareCode}
          <button class="copy-btn" id="btn-copy-share-code">Copy</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">
          Share this code with anyone. They can import in SnapText's Import tab.
        </div>
      </div>`;
    const copyBtn = $('#btn-copy-share-code');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(result.shareCode);
        copyBtn.textContent = 'Copied!';
      });
    }
  } else {
    box.innerHTML = `<div style="color:var(--danger);font-size:13px;">${result.error || 'Failed to publish. Are you signed in?'}</div>`;
  }
  box.style.display = 'block';
}

async function importFromCloud() {
  const code = $('#cloud-import-code').value.trim();
  if (!code) return alert('Enter a share code.');

  // Try cloud code first (8 chars), fall back to Base64
  let result;
  if (code.length <= 12 && !code.includes('=') && !code.includes('/')) {
    result = await chrome.runtime.sendMessage({ type: 'IMPORT_FROM_CLOUD', shareCode: code });
  }

  if (!result || !result.success) {
    // Try as legacy base64
    result = await chrome.runtime.sendMessage({ type: 'IMPORT_SHARE_CODE', code });
  }

  const box = $('#import-result');
  if (result.success) {
    const { macros: updated } = await chrome.storage.local.get(['macros']);
    macros = updated || [];
    renderAll(); populateShareFolders();
    const authorPart = result.author ? ` by ${result.author}` : '';
    const titlePart = result.title ? `"${result.title}"${authorPart} — ` : '';
    box.innerHTML = `<div style="background:var(--success-bg);border:1px solid #A7F3D0;border-radius:8px;padding:12px;font-size:13px;color:#065F46;">
      Imported ${titlePart}${result.count} macro(s)!</div>`;
    $('#cloud-import-code').value = '';
  } else {
    box.innerHTML = `<div style="color:var(--danger);font-size:13px;">${result.error || 'Invalid share code.'}</div>`;
  }
  box.style.display = 'block';
}

async function loadExplore(query) {
  const results = await chrome.runtime.sendMessage({ type: 'BROWSE_PUBLIC', query: query || '' });
  const grid = $('#explore-grid');
  const empty = $('#explore-empty');

  if (!results || results.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = results.map(s => `
    <div class="explore-card">
      <div class="ec-title">${esc(s.title)}</div>
      <div class="ec-desc">${esc(s.description || 'No description')}</div>
      <div class="ec-meta">
        <span>&#128100; ${esc(s.author_name || 'Anonymous')}</span>
        <span>&#128230; ${(s.macros || []).length} macros</span>
        <span>&#11015; ${s.download_count || 0} imports</span>
      </div>
      <button class="btn btn-sm btn-primary" data-import-cloud="${esc(s.share_code)}">Import</button>
      <span style="font-size:11px;color:var(--text-light);margin-left:8px;">Code: ${esc(s.share_code)}</span>
    </div>`).join('');

  grid.querySelectorAll('[data-import-cloud]').forEach(el => {
    el.addEventListener('click', async () => {
      const code = el.dataset.importCloud;
      const result = await chrome.runtime.sendMessage({ type: 'IMPORT_FROM_CLOUD', shareCode: code });
      if (result.success) {
        const { macros: updated } = await chrome.storage.local.get(['macros']);
        macros = updated || [];
        renderAll();
        el.textContent = `Imported ${result.count}!`;
        el.disabled = true;
      } else {
        alert(result.error || 'Import failed.');
      }
    });
  });
}

async function loadMyShares() {
  const shares = await chrome.runtime.sendMessage({ type: 'GET_MY_SHARES' });
  const wrap = $('#my-shares-wrap');

  if (!shares || shares.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="icon">&#128279;</div><p>You haven\'t shared any snippet packs yet.</p></div>';
    return;
  }

  wrap.innerHTML = `
    <table class="my-shares-table">
      <thead><tr><th>Title</th><th>Code</th><th>Macros</th><th>Downloads</th><th>Public</th><th></th></tr></thead>
      <tbody>${shares.map(s => `
        <tr>
          <td style="font-weight:600;">${esc(s.title)}</td>
          <td style="font-family:monospace;color:var(--blue);font-weight:600;">${esc(s.share_code)}</td>
          <td>${(s.macros || []).length}</td>
          <td>${s.download_count || 0}</td>
          <td>${s.is_public ? '<span style="color:var(--success);">Yes</span>' : 'No'}</td>
          <td><button class="btn btn-sm btn-danger" data-delete-share="${s.id}">Delete</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('[data-delete-share]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Delete this shared pack?')) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_SHARE', shareId: el.dataset.deleteShare });
      loadMyShares();
    });
  });
}

// Legacy share code functions
async function generateLegacyCode() {
  const folder = $('#share-folder-select').value;
  const toShare = folder === '__all__' ? macros : macros.filter(m => (m.folder || 'General') === folder);
  if (toShare.length === 0) return alert('No macros in this folder.');
  const result = await chrome.runtime.sendMessage({ type: 'GENERATE_SHARE_CODE', macros: toShare });
  $('#legacy-share-code').value = result.code;
  $('#legacy-share-box').style.display = 'block';
}

async function importLegacyCode() {
  const code = $('#legacy-import-code').value.trim();
  if (!code) return alert('Paste a share code first.');
  const result = await chrome.runtime.sendMessage({ type: 'IMPORT_SHARE_CODE', code });
  if (result.success) {
    const { macros: updated } = await chrome.storage.local.get(['macros']);
    macros = updated || [];
    renderAll(); populateShareFolders();
    alert(`Imported ${result.count} macros!`);
    $('#legacy-import-code').value = '';
  } else {
    alert(result.error || 'Invalid share code.');
  }
}

// ── Auth ────────────────────────────────────────────────────────────
function checkAuth(session) {
  if (session?.idToken && session?.email) {
    $('#auth-logged-out').style.display = 'none';
    $('#auth-logged-in').style.display = 'block';
    $('#auth-user-email').textContent = session.email;
    $('#user-info').textContent = session.email;
  } else {
    $('#auth-logged-out').style.display = 'block';
    $('#auth-logged-in').style.display = 'none';
    $('#user-info').textContent = 'Not signed in';
  }
}

async function signIn() {
  const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
  if (!email || !password) return alert('Email and password required.');
  const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_IN', email, password });
  if (result.success) {
    const { session } = await chrome.storage.local.get(['session']);
    checkAuth(session);
  } else {
    alert(result.error || 'Sign in failed.');
  }
}

async function signUp() {
  const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
  if (!email || !password) return alert('Email and password required.');
  if (password.length < 6) return alert('Password must be at least 6 characters.');
  const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_UP', email, password });
  if (result.success) {
    const { session } = await chrome.storage.local.get(['session']);
    checkAuth(session);
    alert('Account created and signed in!');
  } else {
    alert(result.error || 'Sign up failed.');
  }
}

async function signOut() {
  await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_OUT' });
  checkAuth(null);
}

async function syncNow() {
  const result = await chrome.runtime.sendMessage({ type: 'SYNC_FULL' });
  const { macros: synced, conflicts } = await chrome.storage.local.get(['macros', 'conflicts']);
  macros = synced || [];
  renderAll();
  showConflicts(conflicts || []);
  if (result.conflicts > 0) {
    alert(`Synced! ${result.conflicts} conflict(s) detected — cloud version was kept.`);
  } else {
    alert('Synced!');
  }
}

// ── Settings ────────────────────────────────────────────────────────
let currentShortcut = { ctrlKey: true, shiftKey: true, code: 'Space' };
let recordingShortcut = false;

function loadSettings(settings) {
  if (!settings) return;
  $('#set-trigger').value = settings.triggerChar || ';';
  $('#set-sync').checked = settings.syncEnabled || false;
  $('#set-autosuggest').checked = settings.autoSuggestEnabled !== false;
  currentShortcut = settings.searchShortcut || { ctrlKey: true, shiftKey: true, code: 'Space' };
  $('#set-shortcut-display').value = formatShortcut(currentShortcut);
  renderBlockedDomains(settings.blockedDomains || []);
}

function formatShortcut(s) {
  const parts = [];
  if (s.ctrlKey) parts.push('Ctrl');
  if (s.altKey) parts.push('Alt');
  if (s.shiftKey) parts.push('Shift');
  if (s.metaKey) parts.push('Meta');
  // Convert code to readable name
  let keyName = s.code || '';
  if (keyName.startsWith('Key')) keyName = keyName.slice(3);
  else if (keyName.startsWith('Digit')) keyName = keyName.slice(5);
  else if (keyName === 'Space') keyName = 'Space';
  parts.push(keyName);
  return parts.join('+');
}

function startRecordingShortcut() {
  recordingShortcut = true;
  const input = $('#set-shortcut-display');
  input.value = 'Press keys...';
  input.style.background = '#FEF3C7';
  $('#btn-record-shortcut').textContent = 'Recording...';
}

function stopRecordingShortcut(e) {
  if (!recordingShortcut) return;
  if (e.key === 'Escape') {
    recordingShortcut = false;
    $('#set-shortcut-display').value = formatShortcut(currentShortcut);
    $('#set-shortcut-display').style.background = 'var(--bg-alt)';
    $('#btn-record-shortcut').textContent = 'Record';
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // Wait for actual key

  e.preventDefault();
  currentShortcut = {
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    code: e.code
  };
  recordingShortcut = false;
  $('#set-shortcut-display').value = formatShortcut(currentShortcut);
  $('#set-shortcut-display').style.background = 'var(--bg-alt)';
  $('#btn-record-shortcut').textContent = 'Record';
}

function renderBlockedDomains(domains) {
  const list = $('#domain-list');
  list.innerHTML = domains.map(d =>
    `<span class="domain-tag">${esc(d)} <span class="remove" data-domain="${esc(d)}">&times;</span></span>`
  ).join('');

  list.querySelectorAll('.remove').forEach(el => {
    el.addEventListener('click', async () => {
      const { settings } = await chrome.storage.local.get(['settings']);
      settings.blockedDomains = (settings.blockedDomains || []).filter(d => d !== el.dataset.domain);
      await chrome.storage.local.set({ settings });
      renderBlockedDomains(settings.blockedDomains);
    });
  });
}

async function addBlockedDomain() {
  const domain = $('#domain-input').value.trim().toLowerCase();
  if (!domain) return;
  const { settings } = await chrome.storage.local.get(['settings']);
  if (!settings.blockedDomains) settings.blockedDomains = [];
  if (!settings.blockedDomains.includes(domain)) {
    settings.blockedDomains.push(domain);
    await chrome.storage.local.set({ settings });
  }
  renderBlockedDomains(settings.blockedDomains);
  $('#domain-input').value = '';
}

async function saveSettings() {
  const { settings: existing } = await chrome.storage.local.get(['settings']);
  const settings = {
    ...existing,
    triggerChar: $('#set-trigger').value || ';',
    syncEnabled: $('#set-sync').checked,
    autoSuggestEnabled: $('#set-autosuggest').checked,
    searchShortcut: currentShortcut
  };
  await chrome.storage.local.set({ settings });
  alert('Settings saved!');
}

// ── View switching ──────────────────────────────────────────────────
function showView(view) {
  ['macros', 'share', 'settings', 'account'].forEach(v => {
    const el = $(`#view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  if (view !== 'macros') $('#stats-row').style.display = 'none';
  else $('#stats-row').style.display = '';
}

function showShareTab(tab) {
  ['publish', 'import', 'explore', 'my-shares'].forEach(t => {
    const el = $(`#stab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  $$('.share-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab));
  if (tab === 'explore') loadExplore();
  if (tab === 'my-shares') loadMyShares();
}

// ── Event bindings ──────────────────────────────────────────────────
$$('.sidebar-item[data-view]').forEach(el => {
  el.addEventListener('click', () => {
    currentFolder = null;
    $$('.sidebar-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    showView(el.dataset.view);
    if (el.dataset.view === 'macros') { $('#view-title').textContent = 'All Macros'; renderMacroTable(); }
    if (el.dataset.view === 'share') populateShareFolders();
  });
});

// Share tabs
$$('.share-tab').forEach(el => {
  el.addEventListener('click', () => showShareTab(el.dataset.stab));
});

// Macro modal
$('#btn-new-macro').addEventListener('click', () => openMacroModal());
$('#modal-close').addEventListener('click', closeMacroModal);
$('#modal-cancel').addEventListener('click', closeMacroModal);
$('#modal-save').addEventListener('click', saveMacro);
$('#modal-delete').addEventListener('click', deleteMacro);
$('#dash-search').addEventListener('input', renderMacroTable);
$('#macro-body').addEventListener('input', updatePreview);
$('#macro-trigger').addEventListener('input', checkDuplicate);

// Folder modal
$('#btn-add-folder').addEventListener('click', () => openFolderModal());
$('#folder-modal-close').addEventListener('click', closeFolderModal);
$('#folder-modal-cancel').addEventListener('click', closeFolderModal);
$('#folder-modal-save').addEventListener('click', saveFolderAction);
$('#folder-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveFolderAction(); });

// Export dropdown
$('#btn-export-toggle').addEventListener('click', () => {
  $('#export-menu').classList.toggle('visible');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.export-dropdown')) $('#export-menu').classList.remove('visible');
});
$('#btn-export-json').addEventListener('click', () => { exportJSON(); $('#export-menu').classList.remove('visible'); });
$('#btn-export-csv').addEventListener('click', () => { exportCSV(); $('#export-menu').classList.remove('visible'); });

// Import
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });

// Cloud sharing
$('#btn-publish-cloud').addEventListener('click', publishToCloud);
$('#btn-import-cloud').addEventListener('click', importFromCloud);
$('#btn-explore-search').addEventListener('click', () => loadExplore($('#explore-search').value));
$('#explore-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadExplore($('#explore-search').value); });

// Legacy sharing
$('#btn-generate-legacy').addEventListener('click', generateLegacyCode);
$('#btn-copy-legacy').addEventListener('click', () => {
  navigator.clipboard.writeText($('#legacy-share-code').value);
  $('#btn-copy-legacy').textContent = 'Copied!';
  setTimeout(() => $('#btn-copy-legacy').textContent = 'Copy to Clipboard', 2000);
});
$('#btn-import-legacy').addEventListener('click', importLegacyCode);

// Auth
$('#btn-signin').addEventListener('click', signIn);
$('#btn-signup').addEventListener('click', signUp);
$('#btn-signout').addEventListener('click', signOut);
$('#btn-sync-now').addEventListener('click', syncNow);
$('#btn-save-settings').addEventListener('click', saveSettings);

// Shortcut recording
$('#btn-record-shortcut').addEventListener('click', startRecordingShortcut);
document.addEventListener('keydown', stopRecordingShortcut);

// Blocked domains
$('#btn-add-domain').addEventListener('click', addBlockedDomain);
$('#domain-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockedDomain(); });

// Conflict banner
$('#btn-dismiss-conflict').addEventListener('click', async () => {
  await chrome.storage.local.set({ conflicts: [] });
  $('#conflict-banner').classList.remove('visible');
});

// Modal dismiss
$('#modal-macro').addEventListener('click', (e) => { if (e.target === $('#modal-macro')) closeMacroModal(); });
$('#modal-folder').addEventListener('click', (e) => { if (e.target === $('#modal-folder')) closeFolderModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMacroModal(); closeFolderModal(); } });

init();
