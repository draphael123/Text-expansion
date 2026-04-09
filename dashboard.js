let macros = [];
let currentFolder = null;
let editingMacroId = null;
let renamingFolder = null;
let currentFilter = 'all'; // all, enabled, disabled
let currentTags = []; // Tags for the macro being edited
let filterTags = []; // Tags selected for filtering

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Fuzzy search scoring function
function fuzzyMatch(text, query) {
  if (!query) return { match: true, score: 0 };
  text = text.toLowerCase();
  query = query.toLowerCase();

  // Exact match gets highest score
  if (text.includes(query)) {
    const index = text.indexOf(query);
    return { match: true, score: 100 - index, indices: [[index, index + query.length - 1]] };
  }

  // Fuzzy matching - all query chars must appear in order
  let queryIdx = 0;
  let indices = [];
  let lastMatchIdx = -1;
  let score = 0;

  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i] === query[queryIdx]) {
      indices.push(i);
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) score += 5;
      // Bonus for start of word
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '-' || text[i - 1] === '_') score += 10;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx === query.length) {
    // All characters matched
    score += 50 - (indices[indices.length - 1] - indices[0]); // Bonus for tighter matches
    return { match: true, score, indices: indices.map(i => [i, i]) };
  }

  return { match: false, score: 0 };
}

// Highlight matching text
function highlightMatch(text, query) {
  if (!query) return esc(text);
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return esc(text);

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${esc(before)}<mark class="search-highlight">${esc(match)}</mark>${esc(after)}`;
}

// ── Init ────────────────────────────────────────────────────────────
async function init() {
  // Show skeleton loaders immediately
  showSkeletonLoaders();

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

  // Check if onboarding should be shown
  checkOnboarding();

  if (new URLSearchParams(location.search).get('add') === 'true') openMacroModal();
}

// ── Onboarding ──────────────────────────────────────────────────────
const SAMPLE_MACROS = [
  { trigger: 'sig', body: 'Best regards,\n[Your Name]', folder: 'General' },
  { trigger: 'today', body: '{{date}}', folder: 'General' },
  { trigger: 'email', body: 'Hi {{input:Name}},\n\nThank you for reaching out. I wanted to follow up on our conversation.\n\nBest regards', folder: 'Email' },
  { trigger: 'shrug', body: '¯\\_(ツ)_/¯', folder: 'Fun' },
  { trigger: 'addr', body: '{{input:Street}}, {{input:City}}, {{input:ZIP}}', folder: 'Personal' }
];

function checkOnboarding() {
  if (!localStorage.getItem('snaptext-onboarded') && macros.length === 0) {
    $('#modal-onboarding').classList.add('visible');
  }
}

function closeOnboarding() {
  $('#modal-onboarding').classList.remove('visible');
  localStorage.setItem('snaptext-onboarded', 'true');
}

async function startWithSampleMacros() {
  const btn = $('#onboarding-start');
  setButtonLoading(btn, true);

  // Create sample macros with unique IDs
  const newMacros = SAMPLE_MACROS.map(m => ({
    id: crypto.randomUUID(),
    trigger: m.trigger,
    body: m.body,
    folder: m.folder,
    enabled: true,
    useCount: 0,
    createdAt: Date.now()
  }));

  macros = [...macros, ...newMacros];
  await saveMacros();
  renderAll();
  closeOnboarding();
  showSuccessToast(`Created ${newMacros.length} sample macros!`);
}

// Event listeners for onboarding
document.addEventListener('DOMContentLoaded', () => {
  $('#onboarding-close')?.addEventListener('click', closeOnboarding);
  $('#onboarding-skip')?.addEventListener('click', closeOnboarding);
  $('#onboarding-start')?.addEventListener('click', startWithSampleMacros);
  $('#modal-onboarding')?.addEventListener('click', (e) => {
    if (e.target === $('#modal-onboarding')) closeOnboarding();
  });
});

// ── Skeleton Loaders ────────────────────────────────────────────────
function showSkeletonLoaders() {
  // Skeleton for stats cards
  const statsRow = $('#stats-row');
  if (statsRow) {
    statsRow.innerHTML = Array(4).fill(`
      <div class="stat-card">
        <div class="skeleton skeleton-text short" style="width:60%;height:10px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-text" style="width:40%;height:28px;"></div>
      </div>
    `).join('');
  }

  // Skeleton for macro table
  const tableWrap = $('#macro-table-wrap');
  if (tableWrap) {
    tableWrap.innerHTML = `
      <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <div style="background:var(--bg);padding:10px 16px;border-bottom:1px solid var(--border);">
          <div class="skeleton skeleton-text" style="width:100%;height:14px;"></div>
        </div>
        ${Array(5).fill(`
          <div style="padding:12px 16px;border-bottom:1px solid var(--border-light);display:flex;gap:16px;align-items:center;">
            <div class="skeleton" style="width:60px;height:20px;"></div>
            <div class="skeleton" style="flex:1;height:16px;"></div>
            <div class="skeleton" style="width:60px;height:20px;"></div>
            <div class="skeleton" style="width:40px;height:16px;"></div>
            <div class="skeleton" style="width:34px;height:18px;border-radius:10px;"></div>
            <div class="skeleton" style="width:50px;height:28px;"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Skeleton for folder list
  const folderList = $('#folder-list');
  if (folderList) {
    folderList.innerHTML = Array(3).fill(`
      <div class="sidebar-item" style="pointer-events:none;">
        <div class="skeleton" style="width:16px;height:16px;"></div>
        <div class="skeleton skeleton-text" style="flex:1;height:14px;"></div>
      </div>
    `).join('');
  }
}

// ── Button Loading State ────────────────────────────────────────────
function setButtonLoading(button, loading) {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.classList.add('btn-loading');
    button.disabled = true;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
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

// ── Analytics ───────────────────────────────────────────────────────
let analyticsChartMode = 'usage'; // 'usage' or 'chars'

async function renderAnalytics() {
  const data = await chrome.storage.local.get(['stats', 'charsSaved', 'dailyChars', 'hourlyStats']);
  const stats = data.stats || {};
  const charsSaved = data.charsSaved || 0;
  const dailyChars = data.dailyChars || {};
  const hourlyStats = data.hourlyStats || {};

  // Calculate totals
  let totalExpansions = 0;
  for (const date in stats) {
    totalExpansions += stats[date];
  }

  // Assume 40 WPM typing, average word is 5 chars
  const timeMinutes = Math.round(charsSaved / (40 * 5));

  // Find most active day
  let bestDay = '—';
  let bestDayCount = 0;
  for (const date in stats) {
    if (stats[date] > bestDayCount) {
      bestDayCount = stats[date];
      bestDay = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }

  // Update summary cards
  $('#analytics-total').textContent = totalExpansions.toLocaleString();
  $('#analytics-chars').textContent = charsSaved >= 1000 ? `${(charsSaved / 1000).toFixed(1)}k` : charsSaved;
  $('#analytics-time').textContent = timeMinutes >= 60 ? `${Math.floor(timeMinutes / 60)}h ${timeMinutes % 60}m` : `${timeMinutes} min`;
  $('#analytics-best-day').textContent = bestDay;

  // Render usage chart
  renderUsageChart(stats, dailyChars);

  // Render top macros
  renderTopMacros();

  // Render folder usage
  renderFolderUsage();

  // Render heatmap
  renderHeatmap(hourlyStats);
}

function renderUsageChart(stats, dailyChars) {
  const canvas = $('#usage-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Get last 30 days of data
  const days = [];
  const values = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push(d.getDate().toString());

    if (analyticsChartMode === 'usage') {
      values.push(stats[dateStr] || 0);
    } else {
      values.push(dailyChars[dateStr] || 0);
    }
  }

  const maxVal = Math.max(...values, 1);
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barWidth = chartWidth / 30 - 4;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Get theme colors
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const barColor = '#3B82F6';
  const gridColor = isDark ? '#374151' : '#E5E7EB';

  // Draw grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Draw bars
  ctx.fillStyle = barColor;
  for (let i = 0; i < values.length; i++) {
    const barHeight = (values[i] / maxVal) * chartHeight;
    const x = padding.left + i * (chartWidth / 30) + 2;
    const y = padding.top + chartHeight - barHeight;
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  // Draw labels
  ctx.fillStyle = textColor;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';

  // X-axis labels (every 5th day)
  for (let i = 0; i < days.length; i += 5) {
    const x = padding.left + i * (chartWidth / 30) + barWidth / 2 + 2;
    ctx.fillText(days[i], x, height - 10);
  }

  // Y-axis labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxVal * (4 - i) / 4);
    const y = padding.top + (chartHeight / 4) * i + 4;
    ctx.fillText(val.toString(), padding.left - 10, y);
  }
}

function renderTopMacros() {
  const container = $('#analytics-top-macros');
  if (!container) return;

  // Sort macros by useCount
  const sorted = [...macros]
    .filter(m => m.useCount > 0)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, 10);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="analytics-empty">No usage data yet. Start using your macros!</div>';
    return;
  }

  const maxCount = sorted[0].useCount || 1;

  container.innerHTML = sorted.map((m, i) => `
    <div class="analytics-top-item">
      <div class="ati-rank">#${i + 1}</div>
      <div class="ati-info">
        <div class="ati-trigger">${esc(m.trigger)}</div>
        <div class="ati-folder">${esc(m.folder || 'General')}</div>
      </div>
      <div class="ati-bar-wrap">
        <div class="ati-bar" style="width: ${(m.useCount / maxCount) * 100}%"></div>
      </div>
      <div class="ati-count">${m.useCount}</div>
    </div>
  `).join('');
}

function renderFolderUsage() {
  const container = $('#analytics-folders');
  if (!container) return;

  // Group usage by folder
  const folderUsage = {};
  for (const m of macros) {
    const folder = m.folder || 'General';
    folderUsage[folder] = (folderUsage[folder] || 0) + (m.useCount || 0);
  }

  const sorted = Object.entries(folderUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const total = sorted.reduce((sum, [, count]) => sum + count, 0) || 1;

  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

  container.innerHTML = `
    <div class="folder-chart-bars">
      ${sorted.map(([folder, count], i) => `
        <div class="folder-bar-row">
          <div class="fbr-label">${esc(folder)}</div>
          <div class="fbr-bar-wrap">
            <div class="fbr-bar" style="width: ${(count / total) * 100}%; background: ${colors[i % colors.length]}"></div>
          </div>
          <div class="fbr-count">${count}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHeatmap(hourlyStats) {
  const container = $('#analytics-heatmap');
  if (!container) return;

  // Create 7x24 grid for day of week x hour
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Parse hourly stats into grid
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxVal = 0;

  for (const key in hourlyStats) {
    // Key format: "YYYY-MM-DD-HH"
    const parts = key.split('-');
    if (parts.length >= 4) {
      const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const day = date.getDay();
      const hour = parseInt(parts[3]);
      grid[day][hour] += hourlyStats[key];
      maxVal = Math.max(maxVal, grid[day][hour]);
    }
  }

  container.innerHTML = `
    <div class="heatmap-grid">
      <div class="heatmap-row heatmap-header">
        <div class="heatmap-label"></div>
        ${hours.filter(h => h % 3 === 0).map(h => `<div class="heatmap-hour">${h}</div>`).join('')}
      </div>
      ${days.map((day, dayIdx) => `
        <div class="heatmap-row">
          <div class="heatmap-label">${day}</div>
          ${hours.map(h => {
            const val = grid[dayIdx][h];
            const intensity = maxVal > 0 ? Math.min(val / maxVal, 1) : 0;
            const opacity = 0.1 + intensity * 0.9;
            return `<div class="heatmap-cell" style="background: rgba(59, 130, 246, ${opacity})" title="${day} ${h}:00 - ${val} expansions"></div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
    <div class="heatmap-legend">
      <span>Less</span>
      <div class="heatmap-legend-cells">
        ${[0.1, 0.3, 0.5, 0.7, 0.9].map(o => `<div class="heatmap-legend-cell" style="background: rgba(59, 130, 246, ${o})"></div>`).join('')}
      </div>
      <span>More</span>
    </div>
  `;
}

// Analytics chart toggle
document.addEventListener('DOMContentLoaded', () => {
  $$('.chart-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      $$('.chart-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      analyticsChartMode = btn.dataset.chart;
      const data = await chrome.storage.local.get(['stats', 'dailyChars']);
      renderUsageChart(data.stats || {}, data.dailyChars || {});
    });
  });
});

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
  const totalCount = macros.length;

  // Apply folder filter
  if (currentFolder) filtered = filtered.filter(m => (m.folder || 'General') === currentFolder);

  // Apply enabled/disabled filter
  if (currentFilter === 'enabled') {
    filtered = filtered.filter(m => m.enabled !== false);
  } else if (currentFilter === 'disabled') {
    filtered = filtered.filter(m => m.enabled === false);
  }

  // Apply tag filter
  if (filterTags.length > 0) {
    filtered = filtered.filter(m =>
      m.tags && filterTags.every(t => m.tags.includes(t))
    );
  }

  // Apply search query with fuzzy matching (includes tags)
  if (q) {
    filtered = filtered.map(m => {
      const triggerMatch = fuzzyMatch(m.trigger, q);
      const bodyMatch = fuzzyMatch(m.body, q);
      const folderMatch = fuzzyMatch(m.folder || '', q);
      const tagMatch = m.tags ? m.tags.some(t => fuzzyMatch(t, q).match) : false;

      const isMatch = triggerMatch.match || bodyMatch.match || folderMatch.match || tagMatch;
      const score = Math.max(
        triggerMatch.match ? triggerMatch.score + 50 : 0, // Boost trigger matches
        bodyMatch.match ? bodyMatch.score : 0,
        folderMatch.match ? folderMatch.score : 0,
        tagMatch ? 30 : 0
      );

      return { ...m, _searchMatch: isMatch, _searchScore: score };
    })
    .filter(m => m._searchMatch)
    .sort((a, b) => b._searchScore - a._searchScore);
  }

  // Show result count
  const resultCountEl = $('#search-result-count');
  if (resultCountEl) {
    if (q || currentFilter !== 'all' || currentFolder) {
      resultCountEl.style.display = 'block';
      resultCountEl.innerHTML = `Showing <span class="highlight">${filtered.length}</span> of ${totalCount} macros`;
    } else {
      resultCountEl.style.display = 'none';
    }
  }

  if (filtered.length === 0) {
    const isSearching = q || currentFolder;
    const emptyContent = isSearching
      ? `
        <div class="empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-light)" stroke-width="1.5" style="margin-bottom:16px;">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p style="font-size:15px;font-weight:600;margin-bottom:4px;">No matches found</p>
          <p style="font-size:13px;">Try adjusting your search or filter</p>
          <button class="btn" id="btn-empty-clear" style="margin-top:12px;">Clear Search</button>
        </div>`
      : `
        <div class="empty">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" style="margin-bottom:16px;">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="var(--blue)" stroke-width="1.5" fill="var(--blue-bg)"/>
            <path d="M7 8h10M7 12h6M7 16h8" stroke="var(--blue)" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="18" cy="18" r="5" fill="var(--blue)"/>
            <path d="M18 16v4M16 18h4" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p style="font-size:16px;font-weight:600;margin-bottom:6px;">Create your first macro</p>
          <p style="font-size:13px;max-width:280px;margin:0 auto 16px;">Type a trigger like <code style="background:var(--blue-bg);color:var(--blue);padding:2px 6px;border-radius:4px;">;sig</code> anywhere and it expands instantly.</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn btn-primary" id="btn-empty-new-macro">+ New Macro</button>
          </div>
          <div style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border);">
            <p style="font-size:12px;color:var(--text-light);margin-bottom:8px;">Example uses:</p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <span style="background:var(--bg);padding:4px 10px;border-radius:6px;font-size:12px;"><code>;sig</code> → Email signature</span>
              <span style="background:var(--bg);padding:4px 10px;border-radius:6px;font-size:12px;"><code>;addr</code> → Your address</span>
              <span style="background:var(--bg);padding:4px 10px;border-radius:6px;font-size:12px;"><code>;meet</code> → Meeting template</span>
            </div>
          </div>
        </div>`;

    $('#macro-table-wrap').innerHTML = emptyContent;

    const newMacroBtn = $('#btn-empty-new-macro');
    if (newMacroBtn) newMacroBtn.addEventListener('click', () => openMacroModal());

    const clearBtn = $('#btn-empty-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      $('#dash-search').value = '';
      currentFolder = null;
      $$('.sidebar-item').forEach(i => i.classList.remove('active'));
      $$('.sidebar-item[data-view="macros"]').forEach(i => i.classList.add('active'));
      $('#view-title').textContent = 'All Macros';
      renderMacroTable();
    });
    return;
  }

  // Only sort by order/useCount if not searching (search has its own scoring)
  if (!q) {
    filtered.sort((a, b) => {
      // Sort by custom order if exists, then by useCount
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      return (b.useCount || 0) - (a.useCount || 0);
    });
  }

  // Build bulk action bar
  const bulkActionBar = `
    <div id="bulk-action-bar" class="bulk-action-bar" style="display:none;">
      <span id="bulk-count">0 selected</span>
      <div class="bulk-actions">
        <select id="bulk-move-folder" class="bulk-select">
          <option value="">Move to folder...</option>
          ${getAllFolders().map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="bulk-enable">Enable</button>
        <button class="btn btn-sm" id="bulk-disable">Disable</button>
        <button class="btn btn-sm btn-danger" id="bulk-delete">Delete</button>
        <button class="btn btn-sm" id="bulk-cancel">Cancel</button>
      </div>
    </div>
  `;

  $('#macro-table-wrap').innerHTML = bulkActionBar + `
    <table class="macro-table" id="macro-table">
      <thead><tr>
        <th style="width:32px;"><input type="checkbox" id="select-all-macros" title="Select all" /></th>
        <th style="width:32px;"></th>
        <th>Trigger</th><th>Body</th><th>Folder</th><th>Used</th><th>On</th><th>Actions</th>
      </tr></thead>
      <tbody>${filtered.map((m, idx) => `
        <tr draggable="true" data-macro-id="${m.id}" data-index="${idx}">
          <td><input type="checkbox" class="macro-checkbox" data-id="${m.id}" /></td>
          <td class="drag-handle" style="cursor:grab;color:var(--text-light);text-align:center;">&#8942;&#8942;</td>
          <td class="trigger-cell">;${q ? highlightMatch(m.trigger, q) : esc(m.trigger)}</td>
          <td class="body-cell" title="${esc(m.body)}">
            ${q ? highlightMatch(m.body, q) : esc(m.body)}
            ${m.tags && m.tags.length > 0 ? `<div class="macro-tags">${m.tags.map(t => `<span class="macro-tag">${q ? highlightMatch(t, q) : esc(t)}</span>`).join('')}</div>` : ''}
          </td>
          <td><span class="folder-badge">${q ? highlightMatch(m.folder || 'General', q) : esc(m.folder || 'General')}</span></td>
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

  // Initialize bulk selection
  initBulkSelection();

  // Initialize drag-and-drop for table rows
  initTableDragDrop();
}

// ── Bulk Selection ─────────────────────────────────────────────────
function initBulkSelection() {
  const selectAll = $('#select-all-macros');
  const checkboxes = $$('.macro-checkbox');
  const bulkBar = $('#bulk-action-bar');

  if (!selectAll) return;

  // Select all checkbox
  selectAll.addEventListener('change', () => {
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateBulkBar();
  });

  // Individual checkboxes
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = [...checkboxes].every(c => c.checked);
      const someChecked = [...checkboxes].some(c => c.checked);
      selectAll.checked = allChecked;
      selectAll.indeterminate = someChecked && !allChecked;
      updateBulkBar();
    });
  });

  // Bulk action buttons
  $('#bulk-enable')?.addEventListener('click', () => bulkSetEnabled(true));
  $('#bulk-disable')?.addEventListener('click', () => bulkSetEnabled(false));
  $('#bulk-delete')?.addEventListener('click', bulkDelete);
  $('#bulk-cancel')?.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = false);
    selectAll.checked = false;
    selectAll.indeterminate = false;
    updateBulkBar();
  });

  // Move to folder dropdown
  $('#bulk-move-folder')?.addEventListener('change', (e) => {
    if (e.target.value) {
      bulkMoveToFolder(e.target.value);
      e.target.value = '';
    }
  });
}

function getSelectedMacroIds() {
  return [...$$('.macro-checkbox:checked')].map(cb => cb.dataset.id);
}

function updateBulkBar() {
  const selected = getSelectedMacroIds();
  const bulkBar = $('#bulk-action-bar');
  const countEl = $('#bulk-count');

  if (selected.length > 0) {
    bulkBar.style.display = 'flex';
    countEl.textContent = `${selected.length} selected`;
  } else {
    bulkBar.style.display = 'none';
  }
}

function bulkSetEnabled(enabled) {
  const ids = getSelectedMacroIds();
  if (ids.length === 0) return;

  ids.forEach(id => {
    const macro = macros.find(m => m.id === id);
    if (macro) macro.enabled = enabled;
  });

  saveMacros();
  renderMacroTable();
  showSuccessToast(`${enabled ? 'Enabled' : 'Disabled'} ${ids.length} macro(s)`);
}

function bulkMoveToFolder(folder) {
  const ids = getSelectedMacroIds();
  if (ids.length === 0) return;

  ids.forEach(id => {
    const macro = macros.find(m => m.id === id);
    if (macro) macro.folder = folder;
  });

  saveMacros();
  renderAll();
  showSuccessToast(`Moved ${ids.length} macro(s) to "${folder}"`);
}

function bulkDelete() {
  const ids = getSelectedMacroIds();
  if (ids.length === 0) return;

  const deletedMacros = macros.filter(m => ids.includes(m.id));
  macros = macros.filter(m => !ids.includes(m.id));
  saveMacros();
  renderAll();

  showToast(`Deleted ${ids.length} macro(s)`, {
    type: 'default',
    undoCallback: () => {
      macros = [...macros, ...deletedMacros];
      saveMacros();
      renderAll();
      showSuccessToast('Macros restored');
    }
  });
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

// ── Drag and Drop ──────────────────────────────────────────────────
let draggedMacroId = null;
let draggedRow = null;

function initTableDragDrop() {
  const tbody = document.querySelector('#macro-table tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr[draggable="true"]');

  rows.forEach(row => {
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragleave', handleDragLeave);
  });

  // Also make sidebar folders drop targets
  initFolderDropTargets();
}

function handleDragStart(e) {
  draggedMacroId = e.target.dataset.macroId;
  draggedRow = e.target;
  e.target.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedMacroId);
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  draggedRow = null;
  draggedMacroId = null;

  // Remove all drop indicators
  document.querySelectorAll('.drop-above, .drop-below').forEach(el => {
    el.classList.remove('drop-above', 'drop-below');
  });
  document.querySelectorAll('.sidebar-item.drop-target').forEach(el => {
    el.classList.remove('drop-target');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const row = e.target.closest('tr[draggable="true"]');
  if (!row || row === draggedRow) return;

  // Determine if dropping above or below
  const rect = row.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  // Remove previous indicators
  document.querySelectorAll('.drop-above, .drop-below').forEach(el => {
    el.classList.remove('drop-above', 'drop-below');
  });

  if (e.clientY < midY) {
    row.classList.add('drop-above');
  } else {
    row.classList.add('drop-below');
  }
}

function handleDragLeave(e) {
  const row = e.target.closest('tr[draggable="true"]');
  if (row) {
    row.classList.remove('drop-above', 'drop-below');
  }
}

function handleDrop(e) {
  e.preventDefault();

  const targetRow = e.target.closest('tr[draggable="true"]');
  if (!targetRow || !draggedMacroId) return;

  const targetMacroId = targetRow.dataset.macroId;
  if (targetMacroId === draggedMacroId) return;

  const rect = targetRow.getBoundingClientRect();
  const dropAbove = e.clientY < rect.top + rect.height / 2;

  // Find indices
  const draggedIndex = macros.findIndex(m => m.id === draggedMacroId);
  let targetIndex = macros.findIndex(m => m.id === targetMacroId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  // Remove dragged item
  const [draggedMacro] = macros.splice(draggedIndex, 1);

  // Recalculate target index after removal
  targetIndex = macros.findIndex(m => m.id === targetMacroId);
  const insertIndex = dropAbove ? targetIndex : targetIndex + 1;

  // Insert at new position
  macros.splice(insertIndex, 0, draggedMacro);

  // Update order property
  macros.forEach((m, i) => m.order = i);

  saveMacros();
  renderMacroTable();
  showSuccessToast('Macro order updated');
}

function initFolderDropTargets() {
  const folderItems = document.querySelectorAll('#folder-list .sidebar-item');

  folderItems.forEach(item => {
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drop-target');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drop-target');

      const macroId = e.dataTransfer.getData('text/plain');
      const targetFolder = item.dataset.folder;

      if (!macroId || !targetFolder) return;

      const macro = macros.find(m => m.id === macroId);
      if (!macro) return;

      const oldFolder = macro.folder || 'General';
      if (oldFolder === targetFolder) return;

      macro.folder = targetFolder;
      saveMacros();
      renderAll();
      showSuccessToast(`Moved to "${targetFolder}"`);
    });
  });
}

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

  // Populate chain dropdown with other macros
  populateChainDropdown(id);

  if (id) {
    const m = macros.find(x => x.id === id); if (!m) return;
    $('#modal-title').textContent = 'Edit Macro';
    $('#macro-trigger').value = m.trigger;
    $('#macro-body').value = m.body;
    $('#macro-folder').value = m.folder || '';
    $('#macro-abbreviation').checked = m.isAbbreviation || false;
    if ($('#macro-richtext')) $('#macro-richtext').checked = m.richText || false;
    if ($('#macro-chain')) $('#macro-chain').value = m.chainTo || '';
    currentTags = m.tags ? [...m.tags] : [];
    $('#modal-delete').style.display = 'inline-flex';
    updatePreview();
  } else {
    $('#modal-title').textContent = 'New Macro';
    $('#macro-trigger').value = '';
    $('#macro-body').value = '';
    $('#macro-folder').value = currentFolder || '';
    $('#macro-abbreviation').checked = false;
    if ($('#macro-richtext')) $('#macro-richtext').checked = false;
    if ($('#macro-chain')) $('#macro-chain').value = '';
    currentTags = [];
    $('#modal-delete').style.display = 'none';
    $('#macro-preview').textContent = 'Type in the body above to see a preview...';
  }
  renderTagsInModal();
  $('#macro-tags-input').value = '';
  resetHistory(); // Clear undo/redo history for new edit session
  $('#modal-macro').classList.add('visible');
  setTimeout(() => $('#macro-trigger').focus(), 100);
}

function populateChainDropdown(excludeId) {
  const select = $('#macro-chain');
  if (!select) return;

  // Get all macros except the current one being edited
  const availableMacros = macros
    .filter(m => m.id !== excludeId && m.enabled !== false)
    .sort((a, b) => a.trigger.localeCompare(b.trigger));

  select.innerHTML = '<option value="">None</option>' +
    availableMacros.map(m => `<option value="${esc(m.trigger)}">${esc(m.trigger)} — ${esc((m.body || '').substring(0, 30))}${m.body && m.body.length > 30 ? '...' : ''}</option>`).join('');
}

function renderTagsInModal() {
  const tagsList = $('#tags-list');
  if (!tagsList) return;
  tagsList.innerHTML = currentTags.map(tag => `
    <span class="tag-chip">
      ${esc(tag)}
      <button type="button" class="tag-remove" data-tag="${esc(tag)}">&times;</button>
    </span>
  `).join('');

  // Add click handlers for remove buttons
  tagsList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tag = btn.dataset.tag;
      currentTags = currentTags.filter(t => t !== tag);
      renderTagsInModal();
    });
  });
}

function addTag(tag) {
  tag = tag.trim().toLowerCase();
  if (tag && !currentTags.includes(tag)) {
    currentTags.push(tag);
    renderTagsInModal();
  }
}
window.openMacroModal = openMacroModal;

function closeMacroModal() { $('#modal-macro').classList.remove('visible'); editingMacroId = null; }

function updatePreview() {
  const body = $('#macro-body').value;
  if (!body) { $('#macro-preview').textContent = 'Type in the body above to see a preview...'; return; }

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');

  // Helper for custom date formatting in preview
  function formatPreviewDate(format) {
    const tokens = {
      'YYYY': now.getFullYear(),
      'YY': now.getFullYear().toString().slice(-2),
      'MM': pad(now.getMonth() + 1),
      'M': now.getMonth() + 1,
      'DD': pad(now.getDate()),
      'D': now.getDate(),
      'HH': pad(now.getHours()),
      'H': now.getHours(),
      'hh': pad(now.getHours() % 12 || 12),
      'h': now.getHours() % 12 || 12,
      'mm': pad(now.getMinutes()),
      'm': now.getMinutes(),
      'ss': pad(now.getSeconds()),
      's': now.getSeconds(),
      'A': now.getHours() >= 12 ? 'PM' : 'AM',
      'a': now.getHours() >= 12 ? 'pm' : 'am',
      'dddd': now.toLocaleDateString('en-US', { weekday: 'long' }),
      'ddd': now.toLocaleDateString('en-US', { weekday: 'short' }),
      'MMMM': now.toLocaleDateString('en-US', { month: 'long' }),
      'MMM': now.toLocaleDateString('en-US', { month: 'short' })
    };
    const sortedTokens = Object.keys(tokens).sort((a, b) => b.length - a.length);
    let result = format;
    for (const token of sortedTokens) {
      result = result.replace(new RegExp(token, 'g'), tokens[token]);
    }
    return result;
  }

  let preview = body
    // Text wrappers
    .replace(/\{\{uppercase\}\}([\s\S]*?)\{\{\/uppercase\}\}/gi, (_, inner) => inner.toUpperCase())
    .replace(/\{\{lowercase\}\}([\s\S]*?)\{\{\/lowercase\}\}/gi, (_, inner) => inner.toLowerCase())
    // Simple variables
    .replace(/\{\{date\}\}/gi, now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{time\}\}/gi, now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{weekday\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long' }))
    .replace(/\{\{month\}\}/gi, now.toLocaleDateString('en-US', { month: 'long' }))
    .replace(/\{\{year\}\}/gi, now.getFullYear().toString())
    .replace(/\{\{domain\}\}/gi, '[current domain]')
    .replace(/\{\{url\}\}/gi, '[current URL]')
    .replace(/\{\{title\}\}/gi, '[page title]')
    .replace(/\{\{selection\}\}/gi, '[selected text]')
    // Custom format dates
    .replace(/\{\{date:([^}]+)\}\}/gi, (_, format) => formatPreviewDate(format))
    .replace(/\{\{time:([^}]+)\}\}/gi, (_, format) => formatPreviewDate(format))
    .replace(/\{\{datetime:([^}]+)\}\}/gi, (_, format) => formatPreviewDate(format))
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
  const chainTo = $('#macro-chain') ? $('#macro-chain').value : '';
  const tags = [...currentTags];
  if (!trigger || !body) return alert('Trigger and body are required.');
  if (checkDuplicate()) return alert('A macro with this trigger already exists.');

  if (editingMacroId) {
    const m = macros.find(x => x.id === editingMacroId);
    if (m) { m.trigger = trigger; m.body = body; m.folder = folder; m.isAbbreviation = isAbbreviation; m.richText = richText; m.chainTo = chainTo; m.tags = tags; m.updatedAt = Date.now(); }
  } else {
    macros.push({
      id: 'macro-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      trigger, body, folder, isAbbreviation, richText, chainTo, tags, enabled: true, useCount: 0,
      createdAt: Date.now(), updatedAt: Date.now()
    });
  }
  saveMacros(); closeMacroModal(); renderAll(); populateShareFolders(); updateFolderDatalist();
}

function deleteMacro() {
  if (!editingMacroId) return;

  const macroToDelete = macros.find(m => m.id === editingMacroId);
  if (!macroToDelete) return;

  // Remove macro
  macros = macros.filter(m => m.id !== editingMacroId);
  saveMacros();
  closeMacroModal();
  renderAll();

  // Show toast with undo option
  showToast(`Deleted "${macroToDelete.trigger}"`, {
    type: 'default',
    undoCallback: () => {
      macros.push(macroToDelete);
      saveMacros();
      renderAll();
      showSuccessToast('Macro restored');
    }
  });
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
    const fileName = file.name.toLowerCase();

    // Detect file type and parse accordingly
    if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
      // Espanso YAML format
      const imported = parseEspansoYaml(text, file.name);
      if (imported.length > 0) {
        macros = [...macros, ...imported];
        await saveMacros();
        renderAll();
        showSuccessToast(`Imported ${imported.length} macros from Espanso!`);
      } else {
        alert('No valid macros found in Espanso file.');
      }
    } else if (fileName.endsWith('.csv')) {
      // Check if it's TextExpander format (has specific headers or structure)
      const isTextExpander = text.includes('abbreviation') || isTextExpanderCSV(text);
      if (isTextExpander) {
        const imported = parseTextExpanderCSV(text);
        if (imported.length > 0) {
          macros = [...macros, ...imported];
          await saveMacros();
          renderAll();
          showSuccessToast(`Imported ${imported.length} macros from TextExpander!`);
        } else {
          alert('No valid macros found in TextExpander CSV.');
        }
      } else {
        // Standard SnapText CSV import
        const result = await chrome.runtime.sendMessage({ type: 'IMPORT_CSV', csv: text });
        if (result.success) {
          const { macros: updated } = await chrome.storage.local.get(['macros']);
          macros = updated || [];
          renderAll();
          showSuccessToast(`Imported ${result.count} macros from CSV!`);
        } else {
          alert(result.error || 'Invalid CSV file.');
        }
      }
    } else {
      // JSON format
      try {
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) throw new Error();
        macros = [...macros, ...imported.map(m => ({
          ...m, id: m.id || crypto.randomUUID()
        }))];
        await saveMacros();
        renderAll();
        showSuccessToast(`Imported ${imported.length} macros!`);
      } catch {
        alert('Invalid JSON file.');
      }
    }
  };
  reader.readAsText(file);
}

// ── TextExpander CSV Parser ──────────────────────────────────────────
function isTextExpanderCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return false;
  // TextExpander CSV typically has: abbreviation, plain text content, label
  const firstLine = lines[0].toLowerCase();
  return firstLine.includes('abbreviation') || firstLine.includes('snippet') ||
         (lines.length > 1 && lines[1].split(',').length >= 2);
}

function parseTextExpanderCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const imported = [];
  const hasHeader = lines[0].toLowerCase().includes('abbreviation') ||
                    lines[0].toLowerCase().includes('snippet');
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 2) {
      const trigger = (fields[0] || '').trim().replace(/^[;:\/]/, ''); // Remove common prefixes
      const body = (fields[1] || '').trim();
      const folder = (fields[2] || 'Imported').trim() || 'Imported';

      if (trigger && body) {
        imported.push({
          id: crypto.randomUUID(),
          trigger: trigger,
          body: convertTextExpanderVariables(body),
          folder: folder,
          enabled: true,
          useCount: 0,
          tags: ['imported', 'textexpander'],
          createdAt: Date.now()
        });
      }
    }
  }

  return imported;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields.map(f => f.replace(/^"|"$/g, '').trim());
}

function convertTextExpanderVariables(text) {
  // Convert TextExpander variables to SnapText format
  return text
    .replace(/%clipboard/gi, '{{clipboard}}')
    .replace(/%\|/g, '{{cursor}}')
    .replace(/%d/g, '{{date}}')
    .replace(/%t/g, '{{time}}')
    .replace(/%snippet:([^%]+)%/gi, '{{macro:$1}}')
    .replace(/%fill:([^%]+)%/gi, '{{input:$1}}')
    .replace(/%fillpopup:name=([^:]+):default=([^%]+)%/gi, '{{input:$1||$2}}')
    .replace(/%fillpopup:name=([^%]+)%/gi, '{{input:$1}}');
}

// ── Espanso YAML Parser ──────────────────────────────────────────────
function parseEspansoYaml(text, fileName) {
  const imported = [];

  // Infer folder from filename (e.g., "email.yml" -> "Email")
  const folderFromFile = fileName
    .replace(/\.(ya?ml)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Simple YAML parser for Espanso format
  // Espanso format:
  // matches:
  //   - trigger: ":hello"
  //     replace: "Hello World"
  //   - trigger: ":date"
  //     replace: "{{date}}"

  const lines = text.split('\n');
  let currentMatch = null;
  let inMatches = false;
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Detect matches section
    if (trimmed === 'matches:') {
      inMatches = true;
      continue;
    }

    if (!inMatches) continue;

    // New match starts with "- trigger:"
    if (trimmed.startsWith('- trigger:') || trimmed.startsWith('-trigger:')) {
      // Save previous match
      if (currentMatch && currentMatch.trigger && currentMatch.body) {
        imported.push(createMacroFromEspanso(currentMatch, folderFromFile));
      }
      currentMatch = {
        trigger: extractYamlValue(trimmed.replace(/^-\s*/, ''))
      };
    } else if (trimmed.startsWith('trigger:') && !trimmed.startsWith('- trigger:')) {
      if (currentMatch) {
        currentMatch.trigger = extractYamlValue(trimmed);
      }
    } else if (trimmed.startsWith('replace:')) {
      if (currentMatch) {
        const value = extractYamlValue(trimmed);
        // Check for multiline string (|)
        if (value === '|' || value === '|-') {
          // Collect multiline content
          const bodyLines = [];
          const baseIndent = line.search(/\S/);
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j];
            const nextIndent = nextLine.search(/\S/);
            if (nextLine.trim() === '' || nextIndent > baseIndent) {
              bodyLines.push(nextLine.substring(baseIndent + 2) || '');
              j++;
            } else {
              break;
            }
          }
          currentMatch.body = bodyLines.join('\n').trim();
          i = j - 1; // Adjust line counter
        } else {
          currentMatch.body = value;
        }
      }
    } else if (trimmed.startsWith('label:') || trimmed.startsWith('description:')) {
      if (currentMatch) {
        currentMatch.label = extractYamlValue(trimmed);
      }
    } else if (trimmed.startsWith('word:')) {
      if (currentMatch) {
        currentMatch.word = extractYamlValue(trimmed) === 'true';
      }
    }
  }

  // Don't forget the last match
  if (currentMatch && currentMatch.trigger && currentMatch.body) {
    imported.push(createMacroFromEspanso(currentMatch, folderFromFile));
  }

  return imported;
}

function extractYamlValue(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return '';
  let value = line.substring(colonIdx + 1).trim();
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  // Handle escape sequences
  value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return value;
}

function createMacroFromEspanso(match, folder) {
  // Remove leading colon from trigger if present (Espanso convention)
  let trigger = match.trigger.replace(/^[:;]/, '');

  // Convert Espanso variables to SnapText format
  let body = match.body
    .replace(/\{\{clipboard\}\}/gi, '{{clipboard}}')
    .replace(/\{\{date\}\}/gi, '{{date}}')
    .replace(/\{\{time\}\}/gi, '{{time}}')
    .replace(/\{\{cursor\}\}/gi, '{{cursor}}')
    .replace(/\$\|?\$/g, '{{cursor}}')
    .replace(/\{\{output\}\}/gi, '{{cursor}}');

  return {
    id: crypto.randomUUID(),
    trigger: trigger,
    body: body,
    folder: folder || 'Imported',
    enabled: true,
    useCount: 0,
    tags: ['imported', 'espanso'],
    createdAt: Date.now()
  };
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

// ── Toast Notification System ────────────────────────────────────────
let toastTimeout = null;
let pendingUndo = null;

function showToast(message, options = {}) {
  const { type = 'default', undoCallback = null, duration = 3000 } = options;

  // Clear any existing toast
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  if (toastTimeout) clearTimeout(toastTimeout);

  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  // Type-specific colors
  const colors = {
    default: '#1F2937',
    success: '#10B981',
    error: '#EF4444',
    info: '#3B82F6'
  };

  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: ${colors[type] || colors.default};
    color: white;
    padding: 12px 20px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    z-index: 9999;
    animation: slideUp 0.3s ease;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  `;

  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;
  toast.appendChild(messageSpan);

  // Add undo button if callback provided
  if (undoCallback) {
    pendingUndo = undoCallback;
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText = `
      background: none;
      border: none;
      color: inherit;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
      margin-left: auto;
      font-size: 13px;
    `;
    undoBtn.addEventListener('click', () => {
      if (pendingUndo) {
        pendingUndo();
        pendingUndo = null;
      }
      toast.remove();
      if (toastTimeout) clearTimeout(toastTimeout);
    });
    toast.appendChild(undoBtn);
  }

  document.body.appendChild(toast);

  toastTimeout = setTimeout(() => {
    toast.remove();
    pendingUndo = null;
  }, undoCallback ? 5000 : duration);
}

// Convenience functions for typed toasts
function showSuccessToast(message) { showToast(message, { type: 'success' }); }
function showErrorToast(message) { showToast(message, { type: 'error' }); }
function showInfoToast(message) { showToast(message, { type: 'info' }); }

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

// ── Snippet Templates ────────────────────────────────────────────────
const TEMPLATE_PACKS = [
  {
    id: 'email',
    name: 'Email Essentials',
    description: 'Common email responses and templates for everyday communication',
    icon: '&#128231;',
    color: '#3B82F6',
    macros: [
      { trigger: 'ty', body: 'Thank you for reaching out! I appreciate you taking the time to contact me.', folder: 'Email' },
      { trigger: 'fup', body: 'Hi {{input:Name}},\n\nI wanted to follow up on our previous conversation. Please let me know if you have any questions or need any additional information.\n\nBest regards', folder: 'Email' },
      { trigger: 'intro', body: 'Hi {{input:Name}},\n\nI hope this email finds you well. My name is {{input:Your Name}} and I\'m reaching out regarding {{input:Topic}}.\n\n{{cursor}}\n\nBest regards', folder: 'Email' },
      { trigger: 'avail', body: 'I\'m available on the following dates/times:\n\n- {{input:Option 1}}\n- {{input:Option 2}}\n- {{input:Option 3}}\n\nPlease let me know what works best for you.', folder: 'Email' },
      { trigger: 'ack', body: 'Thank you for your email. I\'ve received your message and will get back to you within {{input:Timeframe||24 hours}}.', folder: 'Email' },
      { trigger: 'ooo', body: 'Thank you for your email. I am currently out of the office and will return on {{input:Return Date}}. I will respond to your message upon my return.\n\nFor urgent matters, please contact {{input:Contact Name}} at {{input:Contact Email}}.', folder: 'Email' }
    ]
  },
  {
    id: 'dev',
    name: 'Developer Toolkit',
    description: 'Templates for code reviews, PRs, commits, and technical communication',
    icon: '&#128187;',
    color: '#10B981',
    macros: [
      { trigger: 'prdesc', body: '## Summary\n{{input:Brief description}}\n\n## Changes\n- {{cursor}}\n\n## Testing\n- [ ] Unit tests added/updated\n- [ ] Manual testing completed\n\n## Screenshots (if applicable)\n', folder: 'Dev' },
      { trigger: 'commit', body: '{{select:Type||feat|fix|docs|style|refactor|test|chore}}: {{input:Short description}}\n\n{{input:Longer description (optional)}}', folder: 'Dev' },
      { trigger: 'review', body: '## Code Review\n\n**Overall:** {{select:Rating||Approve|Request Changes|Comment}}\n\n### What I liked\n- {{cursor}}\n\n### Suggestions\n- \n\n### Questions\n- ', folder: 'Dev' },
      { trigger: 'bug', body: '## Bug Report\n\n**Description:** {{input:What happened?}}\n\n**Expected:** {{input:What should happen?}}\n\n**Steps to reproduce:**\n1. {{cursor}}\n\n**Environment:**\n- OS: {{input:OS}}\n- Browser: {{input:Browser}}\n- Version: {{input:Version}}', folder: 'Dev' },
      { trigger: 'todo', body: '// TODO({{input:Your name||you}}): {{input:Description}} - {{date}}', folder: 'Dev' },
      { trigger: 'fixme', body: '// FIXME: {{input:Description}} - {{date}}', folder: 'Dev' }
    ]
  },
  {
    id: 'support',
    name: 'Customer Support',
    description: 'Professional responses for customer service and support teams',
    icon: '&#127919;',
    color: '#8B5CF6',
    macros: [
      { trigger: 'hello', body: 'Hi {{input:Customer Name}},\n\nThank you for contacting our support team. I\'d be happy to help you with {{input:Issue}}.\n\n{{cursor}}\n\nPlease let me know if you have any questions.\n\nBest regards', folder: 'Support' },
      { trigger: 'resolve', body: 'Hi {{input:Customer Name}},\n\nGreat news! I\'ve {{input:Resolution details}}.\n\nYour issue has been resolved. Please let me know if there\'s anything else I can help you with.\n\nBest regards', folder: 'Support' },
      { trigger: 'escalate', body: 'Hi {{input:Customer Name}},\n\nThank you for your patience. I\'ve escalated your case to our {{input:Team||specialized team}} for further assistance.\n\nYou\'ll receive an update within {{input:Timeframe||24-48 hours}}.\n\nReference: #{{input:Ticket Number}}\n\nBest regards', folder: 'Support' },
      { trigger: 'sorry', body: 'Hi {{input:Customer Name}},\n\nI sincerely apologize for the inconvenience this has caused. I understand how frustrating this must be, and I want to assure you that we\'re working to resolve this as quickly as possible.\n\n{{cursor}}\n\nThank you for your patience and understanding.', folder: 'Support' },
      { trigger: 'refund', body: 'Hi {{input:Customer Name}},\n\nI\'ve processed your refund of {{input:Amount}}. You should see it reflected in your account within {{input:Timeframe||5-7 business days}}.\n\nRefund Reference: {{input:Reference Number}}\n\nPlease let me know if you have any questions.', folder: 'Support' }
    ]
  },
  {
    id: 'meeting',
    name: 'Meeting Templates',
    description: 'Agendas, notes, and follow-up templates for productive meetings',
    icon: '&#128197;',
    color: '#F59E0B',
    macros: [
      { trigger: 'agenda', body: '# Meeting Agenda\n**Date:** {{date}}\n**Time:** {{input:Time}}\n**Attendees:** {{input:Names}}\n\n## Topics\n1. {{cursor}}\n2. \n3. \n\n## Action Items from Last Meeting\n- \n\n## Notes\n', folder: 'Meetings' },
      { trigger: 'notes', body: '# Meeting Notes - {{date}}\n\n**Attendees:** {{input:Names}}\n\n## Discussion\n{{cursor}}\n\n## Decisions Made\n- \n\n## Action Items\n- [ ] {{input:Task}} - @{{input:Owner}}\n\n## Next Steps\n', folder: 'Meetings' },
      { trigger: 'mtgfup', body: 'Hi team,\n\nThank you for joining today\'s meeting. Here\'s a quick summary:\n\n**Key Decisions:**\n- {{cursor}}\n\n**Action Items:**\n- [ ] \n\n**Next Meeting:** {{input:Date/Time}}\n\nPlease let me know if I missed anything.\n\nBest', folder: 'Meetings' },
      { trigger: '1on1', body: '# 1:1 Meeting - {{date}}\n\n## Check-in\n- How are you doing?\n- Any blockers or concerns?\n\n## Updates\n{{cursor}}\n\n## Goals Review\n- \n\n## Feedback\n- \n\n## Action Items\n- ', folder: 'Meetings' }
    ]
  },
  {
    id: 'fun',
    name: 'Fun & Emoji',
    description: 'Kaomoji, emoticons, and fun text for casual conversations',
    icon: '&#127881;',
    color: '#EC4899',
    macros: [
      { trigger: 'shrug', body: '¯\\_(ツ)_/¯', folder: 'Fun' },
      { trigger: 'tableflip', body: '(╯°□°)╯︵ ┻━┻', folder: 'Fun' },
      { trigger: 'unflip', body: '┬─┬ノ( º _ ºノ)', folder: 'Fun' },
      { trigger: 'lenny', body: '( ͡° ͜ʖ ͡°)', folder: 'Fun' },
      { trigger: 'disapprove', body: 'ಠ_ಠ', folder: 'Fun' },
      { trigger: 'sparkles', body: '✨', folder: 'Fun' },
      { trigger: 'check', body: '✓', folder: 'Fun' },
      { trigger: 'arrow', body: '→', folder: 'Fun' }
    ]
  },
  {
    id: 'sales',
    name: 'Sales Outreach',
    description: 'Cold outreach, follow-ups, and closing templates for sales teams',
    icon: '&#128176;',
    color: '#EF4444',
    macros: [
      { trigger: 'cold', body: 'Hi {{input:Name}},\n\nI noticed that {{input:Observation about their company}}. At {{input:Your Company}}, we help companies like yours {{input:Value proposition}}.\n\nWould you be open to a quick 15-minute call to explore if we could help?\n\n{{cursor}}\n\nBest regards', folder: 'Sales' },
      { trigger: 'demo', body: 'Hi {{input:Name}},\n\nThank you for your interest in {{input:Product}}! I\'d love to show you how it can {{input:Key benefit}}.\n\nAre you available for a {{input:Duration||30-minute}} demo this week? Here are some times that work for me:\n\n- {{input:Option 1}}\n- {{input:Option 2}}\n\nLooking forward to connecting!', folder: 'Sales' },
      { trigger: 'proposal', body: 'Hi {{input:Name}},\n\nAs discussed, I\'ve prepared a proposal for {{input:Project/Service}}.\n\n**Investment:** {{input:Price}}\n**Timeline:** {{input:Timeline}}\n\nThis includes:\n- {{cursor}}\n\nPlease let me know if you have any questions.\n\nBest regards', folder: 'Sales' },
      { trigger: 'close', body: 'Hi {{input:Name}},\n\nI wanted to follow up on our conversation about {{input:Product/Service}}. Based on our discussion, I believe we\'re a great fit because {{input:Key reasons}}.\n\nAre you ready to move forward? I can have the agreement ready for you today.\n\nBest regards', folder: 'Sales' }
    ]
  }
];

function renderTemplates() {
  const grid = $('#template-grid');
  if (!grid) return;

  grid.innerHTML = TEMPLATE_PACKS.map(pack => `
    <div class="template-card" data-pack="${pack.id}">
      <div class="template-icon" style="background:${pack.color};">${pack.icon}</div>
      <div class="template-info">
        <div class="template-name">${esc(pack.name)}</div>
        <div class="template-desc">${esc(pack.description)}</div>
        <div class="template-meta">${pack.macros.length} snippets</div>
      </div>
      <div class="template-actions">
        <button class="btn btn-sm" data-preview-pack="${pack.id}">Preview</button>
        <button class="btn btn-sm btn-primary" data-install-pack="${pack.id}">Install</button>
      </div>
    </div>
  `).join('');

  // Preview handlers
  grid.querySelectorAll('[data-preview-pack]').forEach(btn => {
    btn.addEventListener('click', () => {
      const packId = btn.dataset.previewPack;
      previewTemplatePack(packId);
    });
  });

  // Install handlers
  grid.querySelectorAll('[data-install-pack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const packId = btn.dataset.installPack;
      await installTemplatePack(packId, btn);
    });
  });
}

function previewTemplatePack(packId) {
  const pack = TEMPLATE_PACKS.find(p => p.id === packId);
  if (!pack) return;

  const preview = pack.macros.map(m =>
    `<div class="template-preview-item">
      <div class="tpi-trigger">${esc(m.trigger)}</div>
      <div class="tpi-body">${esc(m.body.slice(0, 100))}${m.body.length > 100 ? '...' : ''}</div>
    </div>`
  ).join('');

  // Show in a simple alert for now (could be a modal)
  const modal = document.createElement('div');
  modal.className = 'modal-overlay visible';
  modal.id = 'modal-template-preview';
  modal.innerHTML = `
    <div class="modal" style="max-width:550px;">
      <div class="modal-header">
        <div class="modal-title">${pack.icon} ${esc(pack.name)}</div>
        <button class="modal-close" id="template-preview-close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:12px;color:var(--muted);">${esc(pack.description)}</p>
        <div class="template-preview-list">${preview}</div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="template-preview-cancel">Close</button>
        <button class="btn btn-primary" id="template-preview-install">Install Pack</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#template-preview-close').addEventListener('click', close);
  modal.querySelector('#template-preview-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#template-preview-install').addEventListener('click', async () => {
    const btn = modal.querySelector('#template-preview-install');
    await installTemplatePack(packId, btn);
    close();
  });
}

async function installTemplatePack(packId, btn) {
  const pack = TEMPLATE_PACKS.find(p => p.id === packId);
  if (!pack) return;

  setButtonLoading(btn, true);

  // Create macros with unique IDs
  const newMacros = pack.macros.map(m => ({
    id: crypto.randomUUID(),
    trigger: m.trigger,
    body: m.body,
    folder: m.folder,
    enabled: true,
    useCount: 0,
    tags: ['template', pack.id],
    createdAt: Date.now()
  }));

  // Check for duplicate triggers
  const existingTriggers = new Set(macros.map(m => m.trigger));
  const duplicates = newMacros.filter(m => existingTriggers.has(m.trigger));

  if (duplicates.length > 0) {
    const confirmMsg = `${duplicates.length} trigger(s) already exist (${duplicates.map(d => d.trigger).join(', ')}). Install anyway? Existing macros will be kept.`;
    if (!confirm(confirmMsg)) {
      setButtonLoading(btn, false);
      return;
    }
    // Filter out duplicates
    const filteredMacros = newMacros.filter(m => !existingTriggers.has(m.trigger));
    macros = [...macros, ...filteredMacros];
  } else {
    macros = [...macros, ...newMacros];
  }

  await saveMacros();
  renderAll();
  setButtonLoading(btn, false);
  btn.textContent = 'Installed!';
  btn.disabled = true;
  showSuccessToast(`Installed ${pack.name} (${newMacros.length} snippets)`);
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
  ['publish', 'import', 'explore', 'templates', 'my-shares'].forEach(t => {
    const el = $(`#stab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  $$('.share-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab));
  if (tab === 'explore') loadExplore();
  if (tab === 'templates') renderTemplates();
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

// Filter chips
$$('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderMacroTable();
  });
});

// ── Undo/Redo for macro body ──────────────────────────────────────────
let editorHistory = [];
let historyIndex = -1;
const MAX_HISTORY = 50;
let lastHistoryTime = 0;

function pushHistory(value) {
  const now = Date.now();
  // Debounce: don't push if less than 300ms since last push and value is similar
  if (now - lastHistoryTime < 300 && historyIndex >= 0) {
    editorHistory[historyIndex] = value;
  } else {
    // Remove any redo history
    editorHistory = editorHistory.slice(0, historyIndex + 1);
    editorHistory.push(value);
    if (editorHistory.length > MAX_HISTORY) {
      editorHistory.shift();
    }
    historyIndex = editorHistory.length - 1;
  }
  lastHistoryTime = now;
  updateUndoRedoButtons();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    const textarea = $('#macro-body');
    textarea.value = editorHistory[historyIndex];
    updatePreview();
    updateUndoRedoButtons();
  }
}

function redo() {
  if (historyIndex < editorHistory.length - 1) {
    historyIndex++;
    const textarea = $('#macro-body');
    textarea.value = editorHistory[historyIndex];
    updatePreview();
    updateUndoRedoButtons();
  }
}

function updateUndoRedoButtons() {
  const undoBtn = $('#btn-undo');
  const redoBtn = $('#btn-redo');
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= editorHistory.length - 1;
}

function resetHistory() {
  editorHistory = [];
  historyIndex = -1;
  updateUndoRedoButtons();
}

$('#macro-body').addEventListener('input', (e) => {
  pushHistory(e.target.value);
  updatePreview();
});

$('#macro-body').addEventListener('focus', () => {
  // Initialize history if empty
  if (editorHistory.length === 0) {
    pushHistory($('#macro-body').value);
  }
});

$('#macro-body').addEventListener('keydown', (e) => {
  // Ctrl+Z for undo, Ctrl+Y or Ctrl+Shift+Z for redo
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  }
});

$('#btn-undo')?.addEventListener('click', undo);
$('#btn-redo')?.addEventListener('click', redo);

$('#macro-trigger').addEventListener('input', checkDuplicate);

// Tags input
$('#macro-tags-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const input = e.target;
    const value = input.value.replace(',', '').trim();
    if (value) {
      addTag(value);
      input.value = '';
    }
  } else if (e.key === 'Backspace' && e.target.value === '' && currentTags.length > 0) {
    // Remove last tag when backspace on empty input
    currentTags.pop();
    renderTagsInModal();
  }
});

$('#macro-tags-input')?.addEventListener('blur', (e) => {
  // Add tag when input loses focus
  const value = e.target.value.trim();
  if (value) {
    // Split by comma in case multiple tags were pasted
    value.split(',').forEach(t => addTag(t));
    e.target.value = '';
  }
});

$('#tags-input-container')?.addEventListener('click', (e) => {
  // Focus the input when clicking the container
  if (e.target === $('#tags-input-container') || e.target === $('#tags-list')) {
    $('#macro-tags-input')?.focus();
  }
});

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
  ['macros', 'analytics', 'share', 'settings', 'account', 'team'].forEach(v => {
    const el = $(`#view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  if (view !== 'macros') $('#stats-row').style.display = 'none';
  else $('#stats-row').style.display = '';
  if (view === 'analytics') renderAnalytics();
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

// Extend init to include teams
(function() {
  const originalInit = init;
  window.init = async function() {
    await originalInit();
    await loadTeams();
  };
})();

// ── Keyboard Navigation ─────────────────────────────────────────────────
let selectedRowIndex = -1;

function initKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Only handle navigation when not in input/modal
    const activeEl = document.activeElement;
    const inInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable;
    const helpModal = $('#modal-keyboard-help');
    const helpModalOpen = helpModal && helpModal.classList.contains('visible');
    const inModal = activeEl.closest('.modal-overlay.visible');

    // Allow Escape and ? even in modals
    if (e.key === 'Escape') {
      // Close help modal if open
      if (helpModalOpen) {
        e.preventDefault();
        closeKeyboardHelpModal();
        return;
      }
      // Close any open modal
      const openModal = document.querySelector('.modal-overlay.visible');
      if (openModal) {
        e.preventDefault();
        openModal.classList.remove('visible');
        return;
      }
      // Clear row selection
      if (selectedRowIndex >= 0) {
        e.preventDefault();
        selectedRowIndex = -1;
        const table = document.querySelector('.macro-table tbody');
        if (table) highlightRow(table.querySelectorAll('tr'), -1);
        return;
      }
    }

    // Show keyboard help with ?
    if (e.key === '?' && !inInput) {
      e.preventDefault();
      openKeyboardHelpModal();
      return;
    }

    if (inInput || inModal) return;

    const table = document.querySelector('.macro-table tbody');
    if (!table) return;

    const rows = table.querySelectorAll('tr');

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        if (rows.length > 0) {
          selectedRowIndex = Math.min(selectedRowIndex + 1, rows.length - 1);
          highlightRow(rows, selectedRowIndex);
        }
        break;

      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        if (rows.length > 0) {
          selectedRowIndex = Math.max(selectedRowIndex - 1, 0);
          highlightRow(rows, selectedRowIndex);
        }
        break;

      case 'Enter':
      case 'e':
        if (selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
          e.preventDefault();
          const editBtn = rows[selectedRowIndex].querySelector('[data-edit]');
          if (editBtn) editBtn.click();
        }
        break;

      case 'd':
        if (selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
          e.preventDefault();
          const deleteBtn = rows[selectedRowIndex].querySelector('[data-delete]');
          if (deleteBtn) deleteBtn.click();
        }
        break;

      case ' ':
        // Toggle enabled/disabled
        if (selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
          e.preventDefault();
          const toggleBtn = rows[selectedRowIndex].querySelector('.toggle input');
          if (toggleBtn) {
            toggleBtn.click();
          }
        }
        break;

      case '/':
        // Focus search on / key
        e.preventDefault();
        const searchInput = $('#dash-search');
        if (searchInput) searchInput.focus();
        break;

      case 'n':
        // New macro on 'n' key
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          openMacroModal();
        }
        break;

      case 'g':
        // Go to top
        e.preventDefault();
        if (rows.length > 0) {
          selectedRowIndex = 0;
          highlightRow(rows, selectedRowIndex);
        }
        break;

      case 'G':
        // Go to bottom
        e.preventDefault();
        if (rows.length > 0) {
          selectedRowIndex = rows.length - 1;
          highlightRow(rows, selectedRowIndex);
        }
        break;
    }
  });
}

function highlightRow(rows, index) {
  rows.forEach((row, i) => {
    if (i === index) {
      row.classList.add('keyboard-selected');
      row.scrollIntoView({ block: 'nearest' });
    } else {
      row.classList.remove('keyboard-selected');
    }
  });
}

function openKeyboardHelpModal() {
  const modal = $('#modal-keyboard-help');
  if (modal) modal.classList.add('visible');
}

function closeKeyboardHelpModal() {
  const modal = $('#modal-keyboard-help');
  if (modal) modal.classList.remove('visible');
}

// Reset selection when table is re-rendered
const originalRenderMacroTable = renderMacroTable;
renderMacroTable = function() {
  selectedRowIndex = -1;
  originalRenderMacroTable();
};

// Initialize keyboard navigation and help modal events
document.addEventListener('DOMContentLoaded', () => {
  initKeyboardNavigation();

  // Help modal events
  const helpModal = $('#modal-keyboard-help');
  if (helpModal) {
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) closeKeyboardHelpModal();
    });
    $('#keyboard-help-close')?.addEventListener('click', closeKeyboardHelpModal);
  }
});

init();
