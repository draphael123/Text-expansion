const macroListEl = document.getElementById('macro-list');
const searchEl = document.getElementById('search');
const folderFilterEl = document.getElementById('folder-filter');
const recentSection = document.getElementById('recent-section');
const quickEditForm = document.getElementById('quick-edit-form');
const quickEditFolderEl = document.getElementById('quick-edit-folder');
let allMacros = [];
let storedMacros = []; // All macros including disabled
let currentFolder = '';
let editingMacroId = null;
let isAddMode = false;

// Inline default macros — popup can seed these without background worker
const POPUP_DEFAULT_MACROS = [
  { id: 'default-1', trigger: 'sig', body: 'Best regards,\n{{input:Your Name}}', folder: 'Email', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-2', trigger: 'today', body: '{{date}}', folder: 'Dates', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-3', trigger: 'now', body: '{{time}}', folder: 'Dates', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-4', trigger: 'cb', body: '{{clipboard}}', folder: 'Utility', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-5', trigger: 'reply', body: 'Hi {{input:Name}},\n\nThank you for reaching out. {{cursor}}\n\nBest,\n{{macro:sig}}', folder: 'Email', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-6', trigger: 'ack', body: 'Thanks for reporting this. I\'m looking into it now and will follow up within 24 hours.', folder: 'Support', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'default-7', trigger: 'meeting', body: 'Hi {{input:Name}},\n\nCould we schedule a quick call on {{input:Date/Time}}? I\'d like to discuss {{input:Topic}}.\n\nLet me know what works.\n\n{{macro:sig}}', folder: 'Email', enabled: true, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() }
];

// Highlight variables in preview text
function highlightVars(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(\{\{[^}]+\}\})/g, '<span class="var-tag">$1</span>');
}

async function loadMacros() {
  let macros = [];
  let session = null;
  let stats = {};

  try {
    const data = await chrome.storage.local.get(['macros', 'session', 'stats']);
    macros = data.macros || [];
    session = data.session || null;
    stats = data.stats || {};
  } catch (e) {
    console.error('[SnapText Popup] Storage read failed:', e);
  }

  // If empty, try background worker first, then fall back to inline defaults
  if (!macros || macros.length === 0) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_MACROS' });
      macros = result?.macros || [];
    } catch (e) {
      console.warn('[SnapText Popup] Background unreachable, seeding defaults locally');
    }
  }

  // Last resort: seed from inline defaults
  if (!macros || macros.length === 0) {
    macros = POPUP_DEFAULT_MACROS;
    try {
      await chrome.storage.local.set({ macros });
    } catch (e) {
      console.error('[SnapText Popup] Failed to save defaults:', e);
    }
  }

  storedMacros = macros;
  allMacros = macros.filter(m => m.enabled !== false);

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('stat-macros').textContent = allMacros.length;
  document.getElementById('stat-expansions').textContent = stats[today] || 0;

  // Populate folder filter
  const folders = [...new Set(allMacros.map(m => m.folder || 'General'))].sort();
  folderFilterEl.innerHTML = '<option value="">All Folders</option>' +
    folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');

  // Recent macros
  const recent = [...allMacros]
    .filter(m => m.lastUsed)
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    .slice(0, 3);

  if (recent.length > 0) {
    recentSection.innerHTML = '<div class="section-label">Recent</div>' +
      recent.map(m => macroItemHtml(m)).join('');
    document.getElementById('all-section').innerHTML = '<div class="section-label">All Macros</div>';
  } else {
    recentSection.innerHTML = '';
    document.getElementById('all-section').innerHTML = '';
  }

  renderMacros(allMacros);

  const syncEl = document.getElementById('sync-status');
  syncEl.innerHTML = session?.idToken
    ? '<span class="sync-badge online"><span class="sync-dot"></span>Synced</span>'
    : '<span class="sync-badge offline"><span class="sync-dot"></span>Local only</span>';
}

function macroItemHtml(m) {
  const previewText = m.body.length > 200 ? m.body.substring(0, 200) + '...' : m.body;
  return `<div class="macro-item" data-id="${m.id}" data-body="${escapeAttr(m.body)}" data-trigger="${escapeAttr(m.trigger)}">
    <span class="macro-trigger">;${escapeHtml(m.trigger)}</span>
    <span class="macro-body">${escapeHtml(m.body)}</span>
    ${m.useCount ? `<span class="macro-count">${m.useCount}x</span>` : ''}
    <button class="edit-btn" data-edit="${m.id}">Edit</button>
    <div class="macro-preview">${highlightVars(previewText)}</div>
  </div>`;
}

function renderMacros(macros) {
  if (macros.length === 0) {
    macroListEl.innerHTML = `<div class="empty-state"><div class="icon">&#9889;</div><p>No macros yet. Click + to create one!</p></div>`;
    return;
  }
  macroListEl.innerHTML = macros.map(m => macroItemHtml(m)).join('');
}

function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(str) { return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function applyFilters() {
  const q = searchEl.value.toLowerCase();
  const folder = folderFilterEl.value;
  let filtered = allMacros;

  if (folder) {
    filtered = filtered.filter(m => (m.folder || 'General') === folder);
  }

  if (q) {
    filtered = filtered.filter(m =>
      m.trigger.toLowerCase().includes(q) ||
      m.body.toLowerCase().includes(q) ||
      (m.folder || '').toLowerCase().includes(q)
    );
  }

  renderMacros(filtered);
  const hideRecent = q || folder;
  recentSection.style.display = hideRecent ? 'none' : '';
  document.getElementById('all-section').style.display = hideRecent ? 'none' : '';
}

searchEl.addEventListener('input', applyFilters);
folderFilterEl.addEventListener('change', applyFilters);

document.addEventListener('click', async (e) => {
  // Handle edit button click
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    e.stopPropagation();
    const macroId = editBtn.dataset.edit;
    openQuickEdit(macroId);
    return;
  }

  // Handle macro item click (insert)
  const item = e.target.closest('.macro-item');
  if (!item) return;
  const body = item.dataset.body;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'INSERT_MACRO', body });
    window.close();
  }
});

// Quick edit/add functions
function populateFolderDropdown(selectedFolder = 'General') {
  const folders = [...new Set(storedMacros.map(m => m.folder || 'General'))].sort();
  if (!folders.includes('General')) folders.unshift('General');

  quickEditFolderEl.innerHTML = folders.map(f =>
    `<option value="${escapeHtml(f)}" ${f === selectedFolder ? 'selected' : ''}>${escapeHtml(f)}</option>`
  ).join('') + '<option value="__new__">+ New Folder...</option>';
}

function openQuickAdd() {
  isAddMode = true;
  editingMacroId = null;
  document.getElementById('quick-edit-title').textContent = 'New Macro';
  document.getElementById('quick-edit-trigger').value = '';
  document.getElementById('quick-edit-body').value = '';
  populateFolderDropdown('General');
  quickEditForm.classList.add('visible');
  document.getElementById('quick-edit-trigger').focus();
}

function openQuickEdit(macroId) {
  const macro = storedMacros.find(m => m.id === macroId);
  if (!macro) return;

  isAddMode = false;
  editingMacroId = macroId;
  document.getElementById('quick-edit-title').textContent = 'Edit Macro';
  document.getElementById('quick-edit-trigger').value = macro.trigger;
  document.getElementById('quick-edit-body').value = macro.body;
  populateFolderDropdown(macro.folder || 'General');
  quickEditForm.classList.add('visible');
  document.getElementById('quick-edit-trigger').focus();
}

function closeQuickEdit() {
  quickEditForm.classList.remove('visible');
  editingMacroId = null;
  isAddMode = false;
}

async function saveQuickEdit() {
  const trigger = document.getElementById('quick-edit-trigger').value.trim().replace(/^;/, '');
  const body = document.getElementById('quick-edit-body').value;
  let folder = quickEditFolderEl.value;

  if (!trigger || !body) return;

  // Handle new folder creation
  if (folder === '__new__') {
    folder = prompt('Enter new folder name:');
    if (!folder || !folder.trim()) return;
    folder = folder.trim();
  }

  if (isAddMode) {
    // Create new macro
    const newMacro = {
      id: 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      trigger,
      body,
      folder,
      enabled: true,
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    storedMacros.push(newMacro);
  } else {
    // Edit existing macro
    if (!editingMacroId) return;
    const macroIndex = storedMacros.findIndex(m => m.id === editingMacroId);
    if (macroIndex === -1) return;

    storedMacros[macroIndex].trigger = trigger;
    storedMacros[macroIndex].body = body;
    storedMacros[macroIndex].folder = folder;
    storedMacros[macroIndex].updatedAt = Date.now();
  }

  try {
    await chrome.storage.local.set({ macros: storedMacros });
    closeQuickEdit();
    loadMacros(); // Refresh the list
  } catch (e) {
    console.error('[SnapText Popup] Failed to save:', e);
  }
}

document.getElementById('quick-edit-cancel').addEventListener('click', closeQuickEdit);
document.getElementById('quick-edit-save').addEventListener('click', saveQuickEdit);

document.getElementById('btn-dashboard').addEventListener('click', () => {
  chrome.runtime.openOptionsPage(); window.close();
});
document.getElementById('btn-dashboard-link').addEventListener('click', (e) => {
  e.preventDefault(); chrome.runtime.openOptionsPage(); window.close();
});
document.getElementById('btn-add').addEventListener('click', () => {
  openQuickAdd();
});

// ── Settings Panel ─────────────────────────────────────────────────────
const settingsPanel = document.getElementById('settings-panel');
const settingsLoggedOut = document.getElementById('settings-logged-out');
const settingsLoggedIn = document.getElementById('settings-logged-in');

function openSettings() {
  settingsPanel.classList.add('visible');
  loadSettingsState();
}

function closeSettings() {
  settingsPanel.classList.remove('visible');
}

async function loadSettingsState() {
  try {
    const data = await chrome.storage.local.get(['session', 'settings']);
    const session = data.session || null;
    const settings = data.settings || { triggerChar: ';', syncEnabled: false };

    // Update auth state
    if (session?.idToken && session?.email) {
      settingsLoggedOut.style.display = 'none';
      settingsLoggedIn.style.display = 'block';
      document.getElementById('settings-account-email').textContent = session.email;
    } else {
      settingsLoggedOut.style.display = 'block';
      settingsLoggedIn.style.display = 'none';
    }

    // Update settings
    document.getElementById('settings-sync-toggle').checked = settings.syncEnabled || false;
    document.getElementById('settings-trigger-char').value = settings.triggerChar || ';';
  } catch (e) {
    console.error('[SnapText] Failed to load settings:', e);
  }
}

async function settingsSignIn() {
  const email = document.getElementById('settings-email').value.trim();
  const password = document.getElementById('settings-password').value;
  const errorEl = document.getElementById('settings-auth-error');

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password.';
    errorEl.classList.add('visible');
    return;
  }

  errorEl.textContent = 'Signing in...';
  errorEl.classList.add('visible');
  errorEl.style.background = '#F1F5F9';
  errorEl.style.color = '#64748B';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_IN', email, password });
    if (result.success) {
      errorEl.classList.remove('visible');
      document.getElementById('settings-email').value = '';
      document.getElementById('settings-password').value = '';
      loadSettingsState();
      loadMacros(); // Refresh sync status
    } else {
      errorEl.textContent = result.error || 'Sign in failed.';
      errorEl.style.background = '#FEE2E2';
      errorEl.style.color = '#DC2626';
    }
  } catch (e) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.background = '#FEE2E2';
    errorEl.style.color = '#DC2626';
  }
}

async function settingsSignUp() {
  const email = document.getElementById('settings-email').value.trim();
  const password = document.getElementById('settings-password').value;
  const errorEl = document.getElementById('settings-auth-error');

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password.';
    errorEl.classList.add('visible');
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters.';
    errorEl.classList.add('visible');
    return;
  }

  errorEl.textContent = 'Creating account...';
  errorEl.classList.add('visible');
  errorEl.style.background = '#F1F5F9';
  errorEl.style.color = '#64748B';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_UP', email, password });
    if (result.success) {
      errorEl.textContent = 'Account created! Check email to verify.';
      errorEl.style.background = '#DCFCE7';
      errorEl.style.color = '#166534';
      document.getElementById('settings-email').value = '';
      document.getElementById('settings-password').value = '';
      loadSettingsState();
      loadMacros();
    } else {
      errorEl.textContent = result.error || 'Sign up failed.';
      errorEl.style.background = '#FEE2E2';
      errorEl.style.color = '#DC2626';
    }
  } catch (e) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.background = '#FEE2E2';
    errorEl.style.color = '#DC2626';
  }
}

async function settingsSignOut() {
  try {
    await chrome.runtime.sendMessage({ type: 'FIREBASE_SIGN_OUT' });
    loadSettingsState();
    loadMacros();
  } catch (e) {
    console.error('[SnapText] Sign out failed:', e);
  }
}

async function saveSettings() {
  const syncEnabled = document.getElementById('settings-sync-toggle').checked;
  const triggerChar = document.getElementById('settings-trigger-char').value || ';';

  try {
    const data = await chrome.storage.local.get(['settings']);
    const settings = data.settings || {};
    settings.syncEnabled = syncEnabled;
    settings.triggerChar = triggerChar;
    await chrome.storage.local.set({ settings });
    closeSettings();
  } catch (e) {
    console.error('[SnapText] Failed to save settings:', e);
  }
}

// Settings event listeners
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-signin').addEventListener('click', settingsSignIn);
document.getElementById('settings-signup').addEventListener('click', settingsSignUp);
document.getElementById('settings-signout').addEventListener('click', settingsSignOut);
document.getElementById('settings-save').addEventListener('click', saveSettings);

// Enter key for settings auth
document.getElementById('settings-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') settingsSignIn();
});

loadMacros();
