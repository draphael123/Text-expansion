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

function exportSimpleCSV() {
  const toExport = currentFolder ? macros.filter(m => (m.folder || 'General') === currentFolder) : macros;
  const header = 'Subject,Content';
  const rows = toExport.map(m => {
    const trigger = '"' + (m.trigger || '').replace(/"/g, '""') + '"';
    const body = '"' + (m.body || '').replace(/"/g, '""') + '"';
    return `${trigger},${body}`;
  });
  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = currentFolder ? `-${currentFolder.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.href = url; a.download = `snaptext-simple${suffix}-${new Date().toISOString().slice(0,10)}.csv`;
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

// Get the share URL base - works for both extension dashboard and web
function getShareUrlBase() {
  // Use the hosted site URL for share links
  return 'https://draphael123.github.io/Text-expansion';
}

// Generate QR code as data URL (simple implementation)
function generateQRCode(text, size = 150) {
  // We'll use a simple QR code API for now - can be replaced with local lib later
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
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
    const shareUrl = `${getShareUrlBase()}/#share/${result.shareCode}`;
    box.innerHTML = `
      <div class="share-result-box">
        <div class="share-result-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Published successfully!
        </div>
        <div class="share-link-box">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text);">Share Link</div>
          <input type="text" class="share-link-input" id="share-link-input" value="${shareUrl}" readonly onclick="this.select()" />
          <div class="share-actions-row">
            <button class="share-action-btn primary" id="btn-copy-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy Link
            </button>
            <button class="share-action-btn" id="btn-copy-code">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              Copy Code: ${result.shareCode}
            </button>
            <button class="share-action-btn" id="btn-show-qr">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              QR Code
            </button>
          </div>
          <div id="qr-container" class="share-qr-container" style="display:none;">
            <img id="qr-image" src="" alt="QR Code" style="width:150px;height:150px;" />
            <div class="share-qr-hint">Scan to import macros instantly</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);">
          <strong>${toShare.length}</strong> macro(s) shared ${isPublic ? '(publicly listed)' : '(private link)'}
        </div>
      </div>`;

    // Copy link button
    $('#btn-copy-link').addEventListener('click', function() {
      navigator.clipboard.writeText(shareUrl);
      this.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => {
        this.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Link';
      }, 2000);
    });

    // Copy code button
    $('#btn-copy-code').addEventListener('click', function() {
      navigator.clipboard.writeText(result.shareCode);
      this.textContent = 'Copied!';
      setTimeout(() => {
        this.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Copy Code: ${result.shareCode}`;
      }, 2000);
    });

    // QR code toggle
    $('#btn-show-qr').addEventListener('click', function() {
      const container = $('#qr-container');
      if (container.style.display === 'none') {
        const qrImg = $('#qr-image');
        qrImg.src = generateQRCode(shareUrl);
        container.style.display = 'block';
        this.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Hide QR';
      } else {
        container.style.display = 'none';
        this.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> QR Code';
      }
    });
  } else {
    box.innerHTML = `<div style="color:var(--danger);font-size:13px;">${result.error || 'Failed to publish. Are you signed in?'}</div>`;
  }
  box.style.display = 'block';
}

// Share a single macro quickly
async function shareSingleMacro(macroId) {
  const macro = macros.find(m => m.id === macroId);
  if (!macro) return;

  const title = `Macro: ${macro.trigger}`;
  const result = await chrome.runtime.sendMessage({
    type: 'PUBLISH_TO_CLOUD',
    title,
    description: macro.body.slice(0, 100) + (macro.body.length > 100 ? '...' : ''),
    macros: [macro],
    isPublic: false
  });

  if (result.success) {
    const shareUrl = `${getShareUrlBase()}/#share/${result.shareCode}`;
    navigator.clipboard.writeText(shareUrl);
    showToast(`Link copied! Share: ${result.shareCode}`);
  } else {
    alert(result.error || 'Failed to share. Are you signed in?');
  }
}

// Simple toast notification
function showToast(message) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #1F2937;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    z-index: 9999;
    animation: slideUp 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
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

  const baseUrl = getShareUrlBase();
  wrap.innerHTML = `
    <table class="my-shares-table">
      <thead><tr><th>Title</th><th>Code</th><th>Macros</th><th>Downloads</th><th>Public</th><th>Actions</th></tr></thead>
      <tbody>${shares.map(s => `
        <tr>
          <td style="font-weight:600;">${esc(s.title)}</td>
          <td style="font-family:monospace;color:var(--blue);font-weight:600;">${esc(s.share_code)}</td>
          <td>${(s.macros || []).length}</td>
          <td>${s.download_count || 0}</td>
          <td>${s.is_public ? '<span style="color:var(--success);">Yes</span>' : 'No'}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-sm" data-copy-link="${esc(s.share_code)}" title="Copy share link">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Link
            </button>
            <button class="btn btn-sm" data-show-qr="${esc(s.share_code)}" title="Show QR code">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button class="btn btn-sm btn-danger" data-delete-share="${s.id}" title="Delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div id="my-shares-qr" style="display:none;margin-top:16px;text-align:center;padding:20px;background:white;border:1px solid var(--border);border-radius:10px;">
      <img id="my-shares-qr-img" src="" style="width:150px;height:150px;margin-bottom:8px;" />
      <div style="font-size:12px;color:var(--text-muted);">Scan to import</div>
      <button class="btn btn-sm" id="btn-close-my-qr" style="margin-top:10px;">Close</button>
    </div>`;

  // Copy link buttons
  wrap.querySelectorAll('[data-copy-link]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.copyLink;
      const shareUrl = `${baseUrl}/#share/${code}`;
      navigator.clipboard.writeText(shareUrl);
      const originalHTML = el.innerHTML;
      el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { el.innerHTML = originalHTML; }, 1500);
    });
  });

  // QR buttons
  wrap.querySelectorAll('[data-show-qr]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.showQr;
      const shareUrl = `${baseUrl}/#share/${code}`;
      const qrContainer = $('#my-shares-qr');
      const qrImg = $('#my-shares-qr-img');
      qrImg.src = generateQRCode(shareUrl);
      qrContainer.style.display = 'block';
    });
  });

  // Close QR button
  const closeQr = $('#btn-close-my-qr');
  if (closeQr) {
    closeQr.addEventListener('click', () => {
      $('#my-shares-qr').style.display = 'none';
    });
  }

  // Delete buttons
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
  const resultEl = $('#reset-result');

  if (!email || !password) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = 'Please enter both email and password.';
    return;
  }

  // Show loading state
  resultEl.style.display = 'block';
  resultEl.style.background = '#F1F5F9';
  resultEl.style.color = '#64748B';
  resultEl.textContent = 'Signing in...';

  const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_IN', email, password });
  if (result.success) {
    resultEl.style.background = '#DCFCE7';
    resultEl.style.color = '#166534';
    resultEl.textContent = 'Signed in successfully!';
    const { session } = await chrome.storage.local.get(['session']);
    checkAuth(session);
  } else {
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = result.error || 'Sign in failed. Please check your credentials.';
  }
}

async function signUp() {
  const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
  const resultEl = $('#reset-result');

  if (!email || !password) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = 'Please enter both email and password.';
    return;
  }
  if (password.length < 6) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = 'Password must be at least 6 characters.';
    return;
  }

  // Show loading state
  resultEl.style.display = 'block';
  resultEl.style.background = '#F1F5F9';
  resultEl.style.color = '#64748B';
  resultEl.textContent = 'Creating account...';

  const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_UP', email, password });
  if (result.success) {
    const { session } = await chrome.storage.local.get(['session']);
    checkAuth(session);
    resultEl.style.background = '#DCFCE7';
    resultEl.style.color = '#166534';
    resultEl.innerHTML = '<strong>Account created!</strong><br>Please check your email to verify your account. You can start using SnapText right away.';
  } else {
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = result.error || 'Sign up failed.';
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

async function resetPassword(e) {
  e.preventDefault();
  const email = $('#auth-email').value.trim();
  const resultEl = $('#reset-result');

  if (!email) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = 'Please enter your email address above.';
    return;
  }

  resultEl.style.display = 'block';
  resultEl.style.background = '#F1F5F9';
  resultEl.style.color = '#64748B';
  resultEl.textContent = 'Sending reset email...';

  const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_RESET_PASSWORD', email });

  if (result.success) {
    resultEl.style.background = '#DCFCE7';
    resultEl.style.color = '#166534';
    resultEl.textContent = result.message;
  } else {
    resultEl.style.background = '#FEE2E2';
    resultEl.style.color = '#DC2626';
    resultEl.textContent = result.error;
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
$('#btn-export-simple').addEventListener('click', () => { exportSimpleCSV(); $('#export-menu').classList.remove('visible'); });

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
$('#btn-forgot-password').addEventListener('click', resetPassword);
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMacroModal(); closeFolderModal(); closeTeamModal(); closeTeamSettingsModal(); closeTeamMacroModal(); } });

// ── Team Workspaces ─────────────────────────────────────────────────────
let teams = [];
let currentTeam = null;
let currentTeamDetails = null;
let editingTeamMacroId = null;

async function loadTeams() {
  const session = await chrome.runtime.sendMessage({ type: 'FIREBASE_GET_SESSION' });
  if (!session?.session) return;
  teams = await chrome.runtime.sendMessage({ type: 'GET_MY_TEAMS' }) || [];
  renderTeamList();
}

function renderTeamList() {
  const tl = $('#team-list');
  if (!tl) return;
  if (teams.length === 0) {
    tl.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:var(--text-light);">No teams yet</div>';
    return;
  }
  tl.innerHTML = teams.map(t => {
    const active = currentTeam?.id === t.id ? 'active' : '';
    const roleIcon = t.role === 'owner' ? '&#128081;' : (t.role === 'admin' ? '&#11088;' : '');
    return `<div class="sidebar-item ${active}" data-team="${esc(t.id)}">
      &#128101; ${esc(t.name)} ${roleIcon}
    </div>`;
  }).join('');

  tl.querySelectorAll('[data-team]').forEach(el => {
    el.addEventListener('click', () => selectTeam(el.dataset.team));
  });
}

async function selectTeam(teamId) {
  currentTeam = teams.find(t => t.id === teamId);
  if (!currentTeam) return;

  $$('.sidebar-item').forEach(i => i.classList.remove('active'));
  $(`[data-team="${teamId}"]`)?.classList.add('active');

  // Load team details
  const result = await chrome.runtime.sendMessage({ type: 'GET_TEAM_DETAILS', teamId });
  if (!result.success) {
    alert(result.error || 'Failed to load team');
    return;
  }
  currentTeamDetails = result;

  // Show team view
  showView('team');
  renderTeamView();
}

function showView(view) {
  ['macros', 'share', 'settings', 'account', 'team'].forEach(v => {
    const el = $(`#view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  if (view !== 'macros') $('#stats-row').style.display = 'none';
  else $('#stats-row').style.display = '';
}

function renderTeamView() {
  if (!currentTeam || !currentTeamDetails) return;

  $('#team-view-title').textContent = currentTeam.name;
  $('#team-stat-total').textContent = currentTeamDetails.macros.length;
  $('#team-stat-members').textContent = currentTeamDetails.members.length;
  $('#team-stat-role').textContent = currentTeam.role;
  $('#team-stat-code').textContent = currentTeamDetails.team.join_code || '—';

  renderTeamMacroTable();
}

function renderTeamMacroTable() {
  const q = ($('#team-search')?.value || '').toLowerCase();
  let filtered = currentTeamDetails?.macros || [];
  if (q) filtered = filtered.filter(m =>
    m.trigger.toLowerCase().includes(q) || m.body.toLowerCase().includes(q)
  );

  const wrap = $('#team-macro-table-wrap');
  if (!wrap) return;

  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="empty"><div class="icon">&#128101;</div><p>No team macros yet.</p><button class="btn btn-primary" id="btn-empty-team-macro">+ New Team Macro</button></div>`;
    const emptyBtn = $('#btn-empty-team-macro');
    if (emptyBtn) emptyBtn.addEventListener('click', () => openTeamMacroModal());
    return;
  }

  wrap.innerHTML = `
    <table class="macro-table">
      <thead><tr><th>Trigger</th><th>Body</th><th>Folder</th><th>On</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(m => `
        <tr>
          <td class="trigger-cell">;${esc(m.trigger)}</td>
          <td class="body-cell" title="${esc(m.body)}">${esc(m.body)}</td>
          <td><span class="folder-badge">${esc(m.folder || 'General')}</span></td>
          <td><label class="toggle-switch"><input type="checkbox" ${m.enabled !== false ? 'checked' : ''} data-team-toggle="${m.id}" /><span class="toggle-slider"></span></label></td>
          <td><div class="actions-cell"><button class="btn btn-sm" data-edit-team-macro="${m.id}">Edit</button></div></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('[data-team-toggle]').forEach(el => {
    el.addEventListener('change', async () => {
      const macro = currentTeamDetails.macros.find(m => m.id === el.dataset.teamToggle);
      if (macro) {
        macro.enabled = el.checked;
        await chrome.runtime.sendMessage({
          type: 'SAVE_TEAM_MACRO',
          teamId: currentTeam.id,
          macro
        });
      }
    });
  });

  wrap.querySelectorAll('[data-edit-team-macro]').forEach(el => {
    el.addEventListener('click', () => openTeamMacroModal(el.dataset.editTeamMacro));
  });
}

// Team create/join modal
function openTeamModal() {
  $('#modal-team').classList.add('visible');
  $('#team-create-name').value = '';
  $('#team-join-code').value = '';
  $('#team-create-result').style.display = 'none';
  $('#team-join-result').style.display = 'none';
  setTimeout(() => $('#team-create-name').focus(), 100);
}

function closeTeamModal() {
  $('#modal-team').classList.remove('visible');
}

function showTeamTab(tab) {
  ['create', 'join'].forEach(t => {
    const el = $(`#team-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  $$('[data-team-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.teamTab === tab);
  });
}

async function createTeam() {
  const name = $('#team-create-name').value.trim();
  if (!name) return alert('Enter a team name.');

  const result = await chrome.runtime.sendMessage({ type: 'CREATE_TEAM', name });
  const resultEl = $('#team-create-result');

  if (result.success) {
    resultEl.innerHTML = `<div style="background:var(--success-bg);border:1px solid #A7F3D0;border-radius:8px;padding:12px;font-size:13px;color:#065F46;">
      Team created! Join code: <strong style="font-family:monospace;font-size:16px;">${result.team.join_code}</strong>
    </div>`;
    await loadTeams();
    selectTeam(result.team.id);
    setTimeout(closeTeamModal, 2000);
  } else {
    resultEl.innerHTML = `<div style="color:var(--danger);font-size:13px;">${result.error}</div>`;
  }
  resultEl.style.display = 'block';
}

async function joinTeam() {
  const code = $('#team-join-code').value.trim().toUpperCase();
  if (!code) return alert('Enter a team code.');

  const result = await chrome.runtime.sendMessage({ type: 'JOIN_TEAM', joinCode: code });
  const resultEl = $('#team-join-result');

  if (result.success) {
    resultEl.innerHTML = `<div style="background:var(--success-bg);border:1px solid #A7F3D0;border-radius:8px;padding:12px;font-size:13px;color:#065F46;">
      Joined team "${esc(result.team.name)}"!
    </div>`;
    await loadTeams();
    const team = teams.find(t => t.id === result.team.id);
    if (team) selectTeam(team.id);
    setTimeout(closeTeamModal, 2000);
  } else {
    resultEl.innerHTML = `<div style="color:var(--danger);font-size:13px;">${result.error}</div>`;
  }
  resultEl.style.display = 'block';
}

// Team settings modal
function openTeamSettingsModal() {
  if (!currentTeam || !currentTeamDetails) return;

  $('#team-settings-title').textContent = `${currentTeam.name} Settings`;
  $('#team-settings-name').textContent = currentTeam.name;
  $('#team-settings-code').textContent = currentTeamDetails.team.join_code || '—';
  $('#team-member-count').textContent = currentTeamDetails.members.length;

  // Render members
  const membersList = $('#team-members-list');
  membersList.innerHTML = currentTeamDetails.members.map(m => {
    const roleIcon = m.role === 'owner' ? '&#128081;' : (m.role === 'admin' ? '&#11088;' : '&#128100;');
    const canRemove = currentTeam.role === 'owner' || (currentTeam.role === 'admin' && m.role === 'member');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${roleIcon}</span>
        <div>
          <div style="font-size:13px;font-weight:500;">${esc(m.email)}</div>
          <div style="font-size:11px;color:var(--text-light);text-transform:capitalize;">${m.role}</div>
        </div>
      </div>
      ${canRemove && m.role !== 'owner' ? `<button class="btn btn-sm btn-danger" data-remove-member="${m.id}" title="Remove">&#10005;</button>` : ''}
    </div>`;
  }).join('');

  // Remove member handlers
  membersList.querySelectorAll('[data-remove-member]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Remove this member from the team?')) return;
      const result = await chrome.runtime.sendMessage({
        type: 'REMOVE_MEMBER',
        teamId: currentTeam.id,
        memberId: el.dataset.removeMember
      });
      if (result.success) {
        await selectTeam(currentTeam.id);
        openTeamSettingsModal();
      } else {
        alert(result.error);
      }
    });
  });

  // Show/hide danger zone based on role
  $('#team-danger-zone').style.display = currentTeam.role === 'owner' ? 'block' : 'none';
  $('#team-leave-zone').style.display = currentTeam.role !== 'owner' ? 'block' : 'none';

  $('#modal-team-settings').classList.add('visible');
}

function closeTeamSettingsModal() {
  $('#modal-team-settings').classList.remove('visible');
}

async function deleteTeam() {
  if (!confirm('Are you sure you want to delete this team? This cannot be undone.')) return;
  if (!confirm('This will delete all team macros and remove all members. Continue?')) return;

  const result = await chrome.runtime.sendMessage({ type: 'DELETE_TEAM', teamId: currentTeam.id });
  if (result.success) {
    closeTeamSettingsModal();
    currentTeam = null;
    currentTeamDetails = null;
    await loadTeams();
    showView('macros');
    renderMacroTable();
  } else {
    alert(result.error);
  }
}

async function leaveTeam() {
  if (!confirm('Are you sure you want to leave this team?')) return;

  const result = await chrome.runtime.sendMessage({ type: 'LEAVE_TEAM', teamId: currentTeam.id });
  if (result.success) {
    closeTeamSettingsModal();
    currentTeam = null;
    currentTeamDetails = null;
    await loadTeams();
    showView('macros');
    renderMacroTable();
  } else {
    alert(result.error);
  }
}

// Team macro modal
function openTeamMacroModal(id) {
  editingTeamMacroId = id || null;
  $('#team-trigger-error').classList.remove('visible');

  if (id) {
    const m = currentTeamDetails?.macros.find(x => x.id === id);
    if (!m) return;
    $('#team-macro-modal-title').textContent = 'Edit Team Macro';
    $('#team-macro-trigger').value = m.trigger;
    $('#team-macro-body').value = m.body;
    $('#team-macro-folder').value = m.folder || '';
    $('#team-macro-modal-delete').style.display = 'inline-flex';
    updateTeamMacroPreview();
  } else {
    $('#team-macro-modal-title').textContent = 'New Team Macro';
    $('#team-macro-trigger').value = '';
    $('#team-macro-body').value = '';
    $('#team-macro-folder').value = '';
    $('#team-macro-modal-delete').style.display = 'none';
    $('#team-macro-preview').textContent = 'Type in the body above to see a preview...';
  }
  $('#modal-team-macro').classList.add('visible');
  setTimeout(() => $('#team-macro-trigger').focus(), 100);
}

function closeTeamMacroModal() {
  $('#modal-team-macro').classList.remove('visible');
  editingTeamMacroId = null;
}

function updateTeamMacroPreview() {
  const body = $('#team-macro-body').value;
  const preview = $('#team-macro-preview');
  if (!body) {
    preview.textContent = 'Type in the body above to see a preview...';
    return;
  }
  let text = body
    .replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{time\}\}/gi, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{clipboard\}\}/gi, '[clipboard]')
    .replace(/\{\{cursor\}\}/gi, '|')
    .replace(/\{\{input:([^}]+)\}\}/gi, '[$1]');
  preview.textContent = text;
}

function checkTeamDuplicate() {
  const trigger = $('#team-macro-trigger').value.trim().replace(/^;/, '').toLowerCase();
  const existing = currentTeamDetails?.macros.find(m => m.trigger.toLowerCase() === trigger && m.id !== editingTeamMacroId);
  if (existing) {
    $('#team-trigger-error').classList.add('visible');
    return true;
  }
  $('#team-trigger-error').classList.remove('visible');
  return false;
}

async function saveTeamMacro() {
  const trigger = $('#team-macro-trigger').value.trim().replace(/^;/, '');
  const body = $('#team-macro-body').value;
  const folder = $('#team-macro-folder').value.trim() || 'General';

  if (!trigger || !body) return alert('Trigger and body are required.');
  if (checkTeamDuplicate()) return alert('A macro with this trigger already exists in this team.');

  const macro = editingTeamMacroId
    ? { ...currentTeamDetails.macros.find(m => m.id === editingTeamMacroId), trigger, body, folder }
    : { trigger, body, folder, enabled: true };

  const result = await chrome.runtime.sendMessage({
    type: 'SAVE_TEAM_MACRO',
    teamId: currentTeam.id,
    macro
  });

  if (result.success) {
    closeTeamMacroModal();
    await selectTeam(currentTeam.id);
  } else {
    alert(result.error);
  }
}

async function deleteTeamMacro() {
  if (!editingTeamMacroId || !confirm('Delete this team macro?')) return;

  const result = await chrome.runtime.sendMessage({
    type: 'DELETE_TEAM_MACRO',
    teamId: currentTeam.id,
    macroId: editingTeamMacroId
  });

  if (result.success) {
    closeTeamMacroModal();
    await selectTeam(currentTeam.id);
  } else {
    alert(result.error);
  }
}

// Team event bindings
$('#btn-add-team').addEventListener('click', openTeamModal);
$('#team-modal-close').addEventListener('click', closeTeamModal);
$$('[data-team-tab]').forEach(el => {
  el.addEventListener('click', () => showTeamTab(el.dataset.teamTab));
});
$('#btn-create-team').addEventListener('click', createTeam);
$('#btn-join-team').addEventListener('click', joinTeam);
$('#team-create-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createTeam(); });
$('#team-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinTeam(); });

$('#btn-team-settings').addEventListener('click', openTeamSettingsModal);
$('#team-settings-close').addEventListener('click', closeTeamSettingsModal);
$('#btn-delete-team').addEventListener('click', deleteTeam);
$('#btn-leave-team').addEventListener('click', leaveTeam);

$('#btn-new-team-macro').addEventListener('click', () => openTeamMacroModal());
$('#team-macro-modal-close').addEventListener('click', closeTeamMacroModal);
$('#team-macro-modal-cancel').addEventListener('click', closeTeamMacroModal);
$('#team-macro-modal-save').addEventListener('click', saveTeamMacro);
$('#team-macro-modal-delete').addEventListener('click', deleteTeamMacro);
$('#team-macro-body').addEventListener('input', updateTeamMacroPreview);
$('#team-macro-trigger').addEventListener('input', checkTeamDuplicate);
$('#team-search').addEventListener('input', renderTeamMacroTable);

$('#modal-team').addEventListener('click', (e) => { if (e.target === $('#modal-team')) closeTeamModal(); });
$('#modal-team-settings').addEventListener('click', (e) => { if (e.target === $('#modal-team-settings')) closeTeamSettingsModal(); });
$('#modal-team-macro').addEventListener('click', (e) => { if (e.target === $('#modal-team-macro')) closeTeamMacroModal(); });

// Copy team code on click
$('#team-stat-code').addEventListener('click', () => {
  const code = $('#team-stat-code').textContent;
  if (code && code !== '—') {
    navigator.clipboard.writeText(code);
    showToast('Team code copied!');
  }
});
$('#team-settings-code').addEventListener('click', () => {
  const code = $('#team-settings-code').textContent;
  if (code && code !== '—') {
    navigator.clipboard.writeText(code);
    showToast('Team code copied!');
  }
});

// Override init to include teams
const originalInit = init;
async function init() {
  await originalInit();
  await loadTeams();
}

init();
