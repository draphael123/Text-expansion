/**
 * SnapText Content Script v2
 *
 * Features:
 * - ;trigger expansion on Space/Tab/Enter
 * - Rich text insertion in contenteditable (HTML with line breaks)
 * - Nested macros: {{macro:name}} references other macros
 * - Tabbed multi-field fill-in form for {{input:Label}} variables
 * - Undo support via document.execCommand / insertText
 * - Context-aware search (detects current site, boosts relevant folder)
 * - Domain blocklist (skip expansion on blocked sites)
 * - Ctrl+Shift+Space quick search overlay
 * - Usage tracking
 */

(function () {
  'use strict';

  let macros = [];
  let settings = {};
  let blockedDomains = [];
  let triggerChar = ';';
  let searchShortcut = { ctrlKey: true, shiftKey: true, code: 'Space' };
  let autoSuggestEnabled = true;
  let searchOverlay = null;
  let autoSuggestPopup = null;
  let lastExpansion = null; // for undo
  let multiCursorPositions = []; // positions for multi-cursor Tab cycling
  let currentCursorIndex = 0;

  // ── Load from storage ─────────────────────────────────────────────────
  function loadAll() {
    chrome.storage.local.get(['macros', 'settings'], (result) => {
      macros = result.macros || [];
      settings = result.settings || {};
      blockedDomains = (settings.blockedDomains || []).map(d => d.toLowerCase().trim());
      triggerChar = settings.triggerChar || ';';
      searchShortcut = settings.searchShortcut || { ctrlKey: true, shiftKey: true, code: 'Space' };
      autoSuggestEnabled = settings.autoSuggestEnabled !== false;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.macros) macros = changes.macros.newValue || [];
      if (changes.settings) {
        settings = changes.settings.newValue || {};
        blockedDomains = (settings.blockedDomains || []).map(d => d.toLowerCase().trim());
        triggerChar = settings.triggerChar || ';';
        searchShortcut = settings.searchShortcut || { ctrlKey: true, shiftKey: true, code: 'Space' };
        autoSuggestEnabled = settings.autoSuggestEnabled !== false;
      }
    }
  });

  loadAll();

  // ── Domain blocklist check ────────────────────────────────────────────
  function isSiteBlocked() {
    const host = location.hostname.toLowerCase();
    return blockedDomains.some(d => host === d || host.endsWith('.' + d));
  }

  // ── Context detection (for smart sorting) ─────────────────────────────
  function detectContext() {
    const host = location.hostname.toLowerCase();
    if (host.includes('mail.google') || host.includes('outlook')) return 'Email';
    if (host.includes('slack') || host.includes('discord') || host.includes('teams')) return 'Chat';
    if (host.includes('zendesk') || host.includes('intercom') || host.includes('freshdesk')) return 'Support';
    if (host.includes('github') || host.includes('gitlab') || host.includes('stackoverflow')) return 'Code';
    if (host.includes('notion') || host.includes('docs.google')) return 'Docs';
    if (host.includes('linkedin') || host.includes('twitter') || host.includes('x.com')) return 'Social';
    return null;
  }

  function getContextSortedMacros() {
    const ctx = detectContext();
    if (!ctx) return macros.filter(m => m.enabled !== false);

    const enabled = macros.filter(m => m.enabled !== false);
    const boosted = [];
    const rest = [];
    for (const m of enabled) {
      const folder = (m.folder || '').toLowerCase();
      if (folder === ctx.toLowerCase() || folder.includes(ctx.toLowerCase())) {
        boosted.push(m);
      } else {
        rest.push(m);
      }
    }
    return [...boosted, ...rest];
  }

  // ── Variable processors ───────────────────────────────────────────────
  function getFormattedDate() {
    return new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function getFormattedTime() {
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  // Custom format date/time
  function formatDateTime(date, format) {
    const pad = (n) => n.toString().padStart(2, '0');
    const tokens = {
      'YYYY': date.getFullYear(),
      'YY': date.getFullYear().toString().slice(-2),
      'MM': pad(date.getMonth() + 1),
      'M': date.getMonth() + 1,
      'DD': pad(date.getDate()),
      'D': date.getDate(),
      'HH': pad(date.getHours()),
      'H': date.getHours(),
      'hh': pad(date.getHours() % 12 || 12),
      'h': date.getHours() % 12 || 12,
      'mm': pad(date.getMinutes()),
      'm': date.getMinutes(),
      'ss': pad(date.getSeconds()),
      's': date.getSeconds(),
      'A': date.getHours() >= 12 ? 'PM' : 'AM',
      'a': date.getHours() >= 12 ? 'pm' : 'am',
      'dddd': date.toLocaleDateString('en-US', { weekday: 'long' }),
      'ddd': date.toLocaleDateString('en-US', { weekday: 'short' }),
      'MMMM': date.toLocaleDateString('en-US', { month: 'long' }),
      'MMM': date.toLocaleDateString('en-US', { month: 'short' })
    };

    // Sort by length descending to replace longer tokens first
    const sortedTokens = Object.keys(tokens).sort((a, b) => b.length - a.length);
    let result = format;
    for (const token of sortedTokens) {
      result = result.replace(new RegExp(token, 'g'), tokens[token]);
    }
    return result;
  }

  function getWeekday() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  function getMonthName() {
    return new Date().toLocaleDateString('en-US', { month: 'long' });
  }

  function getYear() {
    return new Date().getFullYear().toString();
  }

  function getDomain() {
    return window.location.hostname;
  }

  function getUrl() {
    return window.location.href;
  }

  function getTitle() {
    return document.title;
  }

  function getSelection() {
    return window.getSelection().toString() || '';
  }

  async function getClipboard() {
    try { return await navigator.clipboard.readText(); }
    catch { return '[clipboard unavailable]'; }
  }

  // Get relative date (e.g., +7 days, -1 day)
  function getRelativeDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Safe math expression evaluator (no eval)
  function safeCalc(expr) {
    // Only allow numbers, operators, parentheses, decimal points, spaces
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return '[invalid expression]';
    try {
      // Use Function constructor with strict mode for safer evaluation
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result !== 'number' || !isFinite(result)) return '[calc error]';
      // Round to avoid floating point issues
      return Math.round(result * 1000000) / 1000000;
    } catch { return '[calc error]'; }
  }

  // Get random item from comma-separated list
  function getRandomItem(items) {
    const options = items.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (options.length === 0) return '';
    return options[Math.floor(Math.random() * options.length)];
  }

  // Resolve nested {{macro:name}} references (max depth 5)
  function resolveNestedMacros(text, depth = 0) {
    if (depth > 5) return text;
    return text.replace(/\{\{macro:([a-zA-Z0-9_.-]+)\}\}/gi, (full, name) => {
      const ref = macros.find(m =>
        m.trigger.toLowerCase() === name.toLowerCase() && m.enabled !== false
      );
      if (!ref) return full;
      return resolveNestedMacros(ref.body, depth + 1);
    });
  }

  async function processVariables(text) {
    // Step 1: resolve nested macros
    let result = resolveNestedMacros(text);

    // Step 2: text wrappers (process early, before other replacements)
    result = result.replace(/\{\{uppercase\}\}([\s\S]*?)\{\{\/uppercase\}\}/gi, (_, inner) => inner.toUpperCase());
    result = result.replace(/\{\{lowercase\}\}([\s\S]*?)\{\{\/lowercase\}\}/gi, (_, inner) => inner.toLowerCase());

    // Step 3: simple variables
    result = result.replace(/\{\{date\}\}/gi, getFormattedDate());
    result = result.replace(/\{\{time\}\}/gi, getFormattedTime());
    result = result.replace(/\{\{weekday\}\}/gi, getWeekday());
    result = result.replace(/\{\{month\}\}/gi, getMonthName());
    result = result.replace(/\{\{year\}\}/gi, getYear());
    result = result.replace(/\{\{domain\}\}/gi, getDomain());
    result = result.replace(/\{\{url\}\}/gi, getUrl());
    result = result.replace(/\{\{title\}\}/gi, getTitle());
    result = result.replace(/\{\{selection\}\}/gi, getSelection());

    // Step 3b: custom format date/time {{date:FORMAT}} {{time:FORMAT}} {{datetime:FORMAT}}
    result = result.replace(/\{\{date:([^}]+)\}\}/gi, (_, format) => formatDateTime(new Date(), format));
    result = result.replace(/\{\{time:([^}]+)\}\}/gi, (_, format) => formatDateTime(new Date(), format));
    result = result.replace(/\{\{datetime:([^}]+)\}\}/gi, (_, format) => formatDateTime(new Date(), format));

    // Step 4: relative dates {{date+N}} or {{date-N}}
    result = result.replace(/\{\{date([+-])(\d+)\}\}/gi, (_, op, days) => {
      const offset = op === '+' ? parseInt(days, 10) : -parseInt(days, 10);
      return getRelativeDate(offset);
    });

    // Step 5: random selection {{random:item1,item2,item3}}
    result = result.replace(/\{\{random:([^}]+)\}\}/gi, (_, items) => getRandomItem(items));

    // Step 6: math expressions {{calc:expression}}
    result = result.replace(/\{\{calc:([^}]+)\}\}/gi, (_, expr) => safeCalc(expr));

    // Step 7: clipboard
    if (/\{\{clipboard\}\}/i.test(result)) {
      const clip = await getClipboard();
      result = result.replace(/\{\{clipboard\}\}/gi, clip);
    }

    // Step 8: collect all {{select:options}} prompts
    const selectRegex = /\{\{select:([^}]+)\}\}/gi;
    let selectMatch;
    const selectPrompts = [];
    while ((selectMatch = selectRegex.exec(result)) !== null) {
      const options = selectMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
      if (!selectPrompts.find(p => p.raw === selectMatch[0])) {
        selectPrompts.push({ raw: selectMatch[0], options });
      }
    }

    // Show select dropdowns one at a time
    for (const sp of selectPrompts) {
      const selected = await showSelectPrompt(sp.options);
      result = result.replace(sp.raw, selected);
    }

    // Step 9: collect all {{input:Label}} prompts
    const inputRegex = /\{\{input:([^}]+)\}\}/gi;
    let match;
    const prompts = [];
    while ((match = inputRegex.exec(result)) !== null) {
      // Deduplicate: if same label appears multiple times, only prompt once
      if (!prompts.find(p => p.label === match[1])) {
        prompts.push({ label: match[1] });
      }
    }

    // Step 4: show tabbed fill-in form if multiple prompts, single prompt if one
    if (prompts.length > 0) {
      const values = prompts.length === 1
        ? { [prompts[0].label]: await showSinglePrompt(prompts[0].label) }
        : await showMultiFieldForm(prompts.map(p => p.label));

      for (const p of prompts) {
        const regex = new RegExp(`\\{\\{input:${escapeRegex(p.label)}\\}\\}`, 'gi');
        result = result.replace(regex, values[p.label] || '');
      }
    }

    // Step 5: multi-cursor positioning
    // Supports {{cursor}}, {{cursor:1}}, {{cursor:2}}, etc.
    let cursorPositions = [];
    const cursorRegex = /\{\{cursor(?::(\d+))?\}\}/gi;
    let cursorMatch;

    // First pass: collect all cursor positions with their indices
    const tempResult = result;
    while ((cursorMatch = cursorRegex.exec(tempResult)) !== null) {
      cursorPositions.push({
        position: cursorMatch.index,
        index: cursorMatch[1] ? parseInt(cursorMatch[1], 10) : 0,
        length: cursorMatch[0].length
      });
    }

    // Sort by index (numbered cursors come first in order, unnumbered last)
    cursorPositions.sort((a, b) => a.index - b.index);

    // Second pass: remove cursor markers and adjust positions
    let removed = 0;
    const adjustedPositions = [];
    for (const cursor of cursorPositions) {
      adjustedPositions.push(cursor.position - removed);
      removed += cursor.length;
    }

    // Remove all cursor markers
    result = result.replace(/\{\{cursor(?::\d+)?\}\}/gi, '');

    // For backward compatibility, use first cursor as primary
    const cursorOffset = adjustedPositions.length > 0 ? adjustedPositions[0] : -1;

    return { text: result, cursorOffset, cursorPositions: adjustedPositions };
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Single input prompt ───────────────────────────────────────────────
  function showSinglePrompt(label) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'snaptext-overlay';
      overlay.innerHTML = `
        <div class="snaptext-prompt">
          <div class="snaptext-prompt-label">${escapeHtml(label)}</div>
          <input type="text" class="snaptext-prompt-input" placeholder="Type a value..." autofocus />
          <div class="snaptext-prompt-actions">
            <button class="snaptext-btn snaptext-btn-cancel">Cancel</button>
            <button class="snaptext-btn snaptext-btn-ok">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('.snaptext-prompt-input');
      const btnOk = overlay.querySelector('.snaptext-btn-ok');
      const btnCancel = overlay.querySelector('.snaptext-btn-cancel');

      function cleanup(v) { overlay.remove(); resolve(v); }
      btnOk.addEventListener('click', () => cleanup(input.value));
      btnCancel.addEventListener('click', () => cleanup(''));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup(input.value);
        if (e.key === 'Escape') cleanup('');
      });
      requestAnimationFrame(() => input.focus());
    });
  }

  // ── Multi-field tabbed form ───────────────────────────────────────────
  function showMultiFieldForm(labels) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'snaptext-overlay';

      const fields = labels.map((l, i) => `
        <div class="snaptext-field-group">
          <label class="snaptext-field-label">${escapeHtml(l)}</label>
          <input type="text" class="snaptext-field-input" data-label="${escapeHtml(l)}" placeholder="Type a value..." ${i === 0 ? 'autofocus' : ''} />
        </div>
      `).join('');

      overlay.innerHTML = `
        <div class="snaptext-prompt snaptext-prompt-wide">
          <div class="snaptext-prompt-header">Fill in the blanks</div>
          <div class="snaptext-prompt-hint">Press Tab to move between fields, Enter to submit</div>
          ${fields}
          <div class="snaptext-prompt-actions">
            <button class="snaptext-btn snaptext-btn-cancel">Cancel</button>
            <button class="snaptext-btn snaptext-btn-ok">Insert</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const inputs = overlay.querySelectorAll('.snaptext-field-input');
      const btnOk = overlay.querySelector('.snaptext-btn-ok');
      const btnCancel = overlay.querySelector('.snaptext-btn-cancel');

      function getValues() {
        const vals = {};
        inputs.forEach(inp => { vals[inp.dataset.label] = inp.value; });
        return vals;
      }

      function cleanup(vals) { overlay.remove(); resolve(vals); }

      btnOk.addEventListener('click', () => cleanup(getValues()));
      btnCancel.addEventListener('click', () => cleanup(Object.fromEntries(labels.map(l => [l, '']))));

      // Enter on last field submits, Tab moves forward
      inputs.forEach((inp, i) => {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            cleanup(getValues());
          }
          if (e.key === 'Escape') {
            cleanup(Object.fromEntries(labels.map(l => [l, ''])));
          }
        });
      });

      requestAnimationFrame(() => inputs[0]?.focus());
    });
  }

  // ── Dropdown select prompt ───────────────────────────────────────────
  function showSelectPrompt(options) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'snaptext-overlay';

      const optionsHtml = options.map((opt, i) =>
        `<option value="${escapeHtml(opt)}"${i === 0 ? ' selected' : ''}>${escapeHtml(opt)}</option>`
      ).join('');

      overlay.innerHTML = `
        <div class="snaptext-prompt">
          <div class="snaptext-prompt-label">Choose an option</div>
          <select class="snaptext-select-input">${optionsHtml}</select>
          <div class="snaptext-prompt-actions">
            <button class="snaptext-btn snaptext-btn-cancel">Cancel</button>
            <button class="snaptext-btn snaptext-btn-ok">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const select = overlay.querySelector('.snaptext-select-input');
      const btnOk = overlay.querySelector('.snaptext-btn-ok');
      const btnCancel = overlay.querySelector('.snaptext-btn-cancel');

      function cleanup(v) { overlay.remove(); resolve(v); }
      btnOk.addEventListener('click', () => cleanup(select.value));
      btnCancel.addEventListener('click', () => cleanup(''));
      select.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup(select.value);
        if (e.key === 'Escape') cleanup('');
      });
      requestAnimationFrame(() => select.focus());
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Text field helpers ────────────────────────────────────────────────
  function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      return ['text', 'email', 'search', 'url', 'tel', 'password'].includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getCaretPosition(el) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return 0;
      const range = sel.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    }
    return el.selectionStart || 0;
  }

  function setCaretPosition(el, pos) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      let charCount = 0;
      let found = false;

      function walkNodes(node) {
        if (found) return;
        if (node.nodeType === Node.TEXT_NODE) {
          const nextCount = charCount + node.textContent.length;
          if (pos <= nextCount) {
            range.setStart(node, pos - charCount);
            range.collapse(true);
            found = true;
            return;
          }
          charCount = nextCount;
        } else {
          for (const child of node.childNodes) {
            walkNodes(child);
            if (found) return;
          }
        }
      }

      walkNodes(el);
      if (found) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      el.setSelectionRange(pos, pos);
    }
  }

  function getTextContent(el) {
    if (el.isContentEditable) return el.innerText || el.textContent;
    return el.value;
  }

  // ── Undo-friendly text insertion ──────────────────────────────────────
  // Uses modern APIs with execCommand fallback for undo support
  function insertTextUndoable(el, newFullText, caretPos, isRichText, richHtml) {
    if (el.isContentEditable && isRichText && richHtml) {
      // Rich text path for contenteditable
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      // Try modern insertHTML via execCommand (still best for undo in contenteditable)
      if (document.execCommand('insertHTML', false, richHtml)) {
        if (caretPos >= 0) setCaretPosition(el, caretPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // Fallback: direct DOM manipulation (no undo support)
      el.innerHTML = richHtml;
      if (caretPos >= 0) setCaretPosition(el, caretPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (!el.isContentEditable) {
      // Standard input/textarea
      el.focus();
      el.setSelectionRange(0, el.value.length);

      // Try execCommand first (best undo support)
      if (document.execCommand('insertText', false, newFullText)) {
        if (caretPos >= 0) el.setSelectionRange(caretPos, caretPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // Modern fallback using setRangeText (preserves some undo in some browsers)
      try {
        el.setRangeText(newFullText, 0, el.value.length, 'end');
        if (caretPos >= 0) el.setSelectionRange(caretPos, caretPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } catch (e) {
        // Final fallback: direct value assignment (no undo)
        el.value = newFullText;
        if (caretPos >= 0) el.setSelectionRange(caretPos, caretPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      // contenteditable plain text
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      // Try execCommand first
      if (document.execCommand('insertText', false, newFullText)) {
        if (caretPos >= 0) setCaretPosition(el, caretPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // Fallback: direct text assignment
      el.textContent = newFullText;
      if (caretPos >= 0) setCaretPosition(el, caretPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Convert plain text to simple HTML (preserves line breaks)
  function textToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // Convert markdown-like syntax to HTML for rich text macros
  function markdownToHtml(text) {
    let html = escapeHtml(text);

    // Bold: **text** or __text__
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_ (but not if preceded by a letter)
    html = html.replace(/(?<![a-zA-Z])\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/g, '<em>$1</em>');

    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Code: `text`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // ── Usage tracking ────────────────────────────────────────────────────
  async function trackUsage(macro) {
    const { macros: allMacros = [], stats = {}, charsSaved = 0 } =
      await chrome.storage.local.get(['macros', 'stats', 'charsSaved']);
    const m = allMacros.find(x => x.id === macro.id);
    if (m) {
      m.useCount = (m.useCount || 0) + 1;
      m.lastUsed = Date.now();
    }

    const today = new Date().toISOString().slice(0, 10);
    stats[today] = (stats[today] || 0) + 1;

    // Clean stats older than 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const key of Object.keys(stats)) {
      if (key < cutoffStr) delete stats[key];
    }

    const newCharsSaved = charsSaved + Math.max(0, macro.body.length - macro.trigger.length - 1);
    await chrome.storage.local.set({ macros: allMacros, stats, charsSaved: newCharsSaved });
  }

  // ── Expansion logic ───────────────────────────────────────────────────
  async function tryExpand(el, chainDepth = 0) {
    if (isSiteBlocked()) return false;

    const text = getTextContent(el);
    const caret = getCaretPosition(el);
    const textBeforeCaret = text.substring(0, caret);

    // Build dynamic regex for trigger character
    const escapedTrigger = escapeRegex(triggerChar);
    const triggerRegex = new RegExp(escapedTrigger + '([a-zA-Z0-9_.-]+)$');
    const triggerMatch = textBeforeCaret.match(triggerRegex);

    let macro = null;
    let triggerStart = 0;

    if (triggerMatch) {
      // Standard trigger match (;trigger)
      const triggerName = triggerMatch[1].toLowerCase();
      macro = macros.find(
        (m) => m.trigger.toLowerCase() === triggerName && m.enabled !== false && !m.isAbbreviation
      );
      triggerStart = caret - triggerMatch[0].length;
    }

    // Check for abbreviation mode macros (no trigger prefix)
    if (!macro) {
      const abbreviations = macros.filter(m => m.isAbbreviation && m.enabled !== false);
      for (const abbr of abbreviations) {
        const abbrTrigger = abbr.trigger.toLowerCase();
        if (textBeforeCaret.toLowerCase().endsWith(abbrTrigger)) {
          macro = abbr;
          triggerStart = caret - abbr.trigger.length;
          break;
        }
      }
    }

    if (!macro) return false;

    const { text: expanded, cursorOffset, cursorPositions } = await processVariables(macro.body);

    const before = text.substring(0, triggerStart);
    const after = text.substring(caret);
    const newText = before + expanded + after;

    let newCaret;
    if (cursorOffset >= 0) {
      newCaret = triggerStart + cursorOffset;
    } else {
      newCaret = triggerStart + expanded.length;
    }

    // Save for undo reference
    lastExpansion = {
      element: el,
      originalText: text,
      originalCaret: caret,
      expandedText: newText,
      expandedCaret: newCaret
    };

    // Set up multi-cursor positions (adjusted for triggerStart offset)
    if (cursorPositions && cursorPositions.length > 1) {
      multiCursorPositions = cursorPositions.map(pos => triggerStart + pos);
      currentCursorIndex = 0;
      // Add Tab key listener for cycling
      setupMultiCursorTabCycling(el);
    } else {
      multiCursorPositions = [];
      currentCursorIndex = 0;
    }

    // Determine if we should use rich text
    const useRichText = el.isContentEditable;
    const htmlConverter = macro.richText ? markdownToHtml : textToHtml;
    const richHtml = useRichText ? (before ? textToHtml(before) : '') + htmlConverter(expanded) + (after ? textToHtml(after) : '') : null;

    insertTextUndoable(el, newText, newCaret, useRichText, richHtml);
    trackUsage(macro);

    // Handle chaining - execute next macro after a short delay
    if (macro.chainTo && chainDepth < 5) {
      setTimeout(() => {
        executeChainedMacro(el, macro.chainTo, chainDepth + 1);
      }, 100);
    }

    return true;
  }

  // ── Chained Macro Execution ─────────────────────────────────────────────
  async function executeChainedMacro(el, triggerName, chainDepth) {
    const chainedMacro = macros.find(
      m => m.trigger.toLowerCase() === triggerName.toLowerCase() && m.enabled !== false
    );

    if (!chainedMacro) return;

    const { text: expanded, cursorOffset, cursorPositions } = await processVariables(chainedMacro.body);

    const currentText = getTextContent(el);
    const currentCaret = getCaretPosition(el);

    // Insert at current cursor position
    const before = currentText.substring(0, currentCaret);
    const after = currentText.substring(currentCaret);
    const newText = before + expanded + after;

    let newCaret;
    if (cursorOffset >= 0) {
      newCaret = currentCaret + cursorOffset;
    } else {
      newCaret = currentCaret + expanded.length;
    }

    // Set up multi-cursor positions if present
    if (cursorPositions && cursorPositions.length > 1) {
      multiCursorPositions = cursorPositions.map(pos => currentCaret + pos);
      currentCursorIndex = 0;
      setupMultiCursorTabCycling(el);
    }

    // Insert the chained content
    const useRichText = el.isContentEditable;
    const htmlConverter = chainedMacro.richText ? markdownToHtml : textToHtml;
    const richHtml = useRichText ? (before ? textToHtml(before) : '') + htmlConverter(expanded) + (after ? textToHtml(after) : '') : null;

    insertTextUndoable(el, newText, newCaret, useRichText, richHtml);
    trackUsage(chainedMacro);

    // Continue chain if this macro also has a chainTo
    if (chainedMacro.chainTo && chainDepth < 5) {
      setTimeout(() => {
        executeChainedMacro(el, chainedMacro.chainTo, chainDepth + 1);
      }, 100);
    }
  }

  // ── Multi-cursor Tab cycling ────────────────────────────────────────────
  let multiCursorHandler = null;

  function setupMultiCursorTabCycling(el) {
    // Remove any existing handler
    if (multiCursorHandler) {
      document.removeEventListener('keydown', multiCursorHandler, true);
    }

    multiCursorHandler = function(e) {
      // Only handle Tab when we have multiple cursor positions
      if (e.key !== 'Tab' || multiCursorPositions.length <= 1) return;

      // Check if we're still in the same element
      if (document.activeElement !== el && !el.contains(document.activeElement)) {
        clearMultiCursor();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Move to next cursor position
      if (e.shiftKey) {
        // Shift+Tab goes backward
        currentCursorIndex = (currentCursorIndex - 1 + multiCursorPositions.length) % multiCursorPositions.length;
      } else {
        // Tab goes forward
        currentCursorIndex = (currentCursorIndex + 1) % multiCursorPositions.length;
      }

      const newPos = multiCursorPositions[currentCursorIndex];
      setCaretPosition(el, newPos);

      // If we've cycled back to the start, clear after this
      if (currentCursorIndex === 0 && !e.shiftKey) {
        // User has cycled through all cursors
        clearMultiCursor();
      }
    };

    document.addEventListener('keydown', multiCursorHandler, true);

    // Also clear on click elsewhere or Escape
    const clearHandler = function(e) {
      if (e.key === 'Escape' || e.type === 'mousedown') {
        clearMultiCursor();
        document.removeEventListener('keydown', clearHandler, true);
        document.removeEventListener('mousedown', clearHandler, true);
      }
    };
    document.addEventListener('keydown', clearHandler, true);
    document.addEventListener('mousedown', clearHandler, true);
  }

  function clearMultiCursor() {
    multiCursorPositions = [];
    currentCursorIndex = 0;
    if (multiCursorHandler) {
      document.removeEventListener('keydown', multiCursorHandler, true);
      multiCursorHandler = null;
    }
  }

  function setCaretPosition(el, position) {
    if (el.isContentEditable) {
      const range = document.createRange();
      const sel = window.getSelection();

      // Walk through text nodes to find the right position
      let currentPos = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node = walker.nextNode();

      while (node) {
        const nodeLength = node.textContent.length;
        if (currentPos + nodeLength >= position) {
          range.setStart(node, position - currentPos);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        currentPos += nodeLength;
        node = walker.nextNode();
      }

      // If we couldn't find the position, place at end
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.selectionStart = el.selectionEnd = position;
      el.focus();
    }
  }

  // ── Quick Search Overlay (Ctrl+Shift+Space) ───────────────────────────
  function openSearchOverlay() {
    if (searchOverlay) return;
    if (isSiteBlocked()) return;

    const savedActiveEl = document.activeElement;
    const ctx = detectContext();

    const overlay = document.createElement('div');
    overlay.className = 'snaptext-search-overlay';
    overlay.innerHTML = `
      <div class="snaptext-search-box">
        <div class="snaptext-search-input-wrap">
          <svg class="snaptext-search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
          </svg>
          <input type="text" class="snaptext-search-field" placeholder="Search macros..." autofocus />
          ${ctx ? `<span class="snaptext-search-ctx">${escapeHtml(ctx)}</span>` : ''}
        </div>
        <div class="snaptext-search-hint">
          <kbd>Enter</kbd> insert &middot; <kbd>Esc</kbd> close &middot; <kbd>&uarr;&darr;</kbd> navigate${ctx ? ` &middot; <span style="color:#2563EB">${escapeHtml(ctx)} macros boosted</span>` : ''}
        </div>
        <div class="snaptext-search-results"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    searchOverlay = overlay;

    const input = overlay.querySelector('.snaptext-search-field');
    const results = overlay.querySelector('.snaptext-search-results');
    let selectedIndex = 0;
    let currentFiltered = [];

    function getFiltered(q) {
      const sorted = getContextSortedMacros();
      if (!q) return sorted.slice(0, 10);
      return sorted.filter(m =>
        m.trigger.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        (m.folder || '').toLowerCase().includes(q)
      ).slice(0, 10);
    }

    function renderResults(q) {
      currentFiltered = getFiltered(q);

      if (currentFiltered.length === 0) {
        results.innerHTML = '<div class="snaptext-search-empty">No macros found</div>';
        return;
      }

      selectedIndex = Math.min(selectedIndex, currentFiltered.length - 1);

      results.innerHTML = currentFiltered.map((m, i) => {
        // Truncate body for preview
        const bodyPreview = m.body.length > 80 ? m.body.substring(0, 80) + '...' : m.body;
        const isCtxMatch = ctx && (m.folder || '').toLowerCase().includes(ctx.toLowerCase());
        // Show trigger with prefix (or just trigger for abbreviations)
        const triggerDisplay = m.isAbbreviation ? escapeHtml(m.trigger) : escapeHtml(triggerChar) + escapeHtml(m.trigger);
        return `
        <div class="snaptext-search-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
          <span class="snaptext-search-trigger">${triggerDisplay}</span>
          <span class="snaptext-search-body">${escapeHtml(bodyPreview)}</span>
          <span class="snaptext-search-folder ${isCtxMatch ? 'snaptext-ctx-match' : ''}">${escapeHtml(m.folder || '')}</span>
        </div>`;
      }).join('');

      results.querySelectorAll('.snaptext-search-item').forEach(item => {
        item.addEventListener('click', () => {
          const macro = currentFiltered[parseInt(item.dataset.index)];
          if (macro) insertFromSearch(macro, savedActiveEl);
        });
      });
    }

    async function insertFromSearch(macro, targetEl) {
      closeSearchOverlay();
      if (targetEl && isTextInput(targetEl)) {
        targetEl.focus();
        const { text, cursorOffset } = await processVariables(macro.body);
        const current = getTextContent(targetEl);
        const caret = getCaretPosition(targetEl);
        const newText = current.substring(0, caret) + text + current.substring(caret);
        const newCaret = cursorOffset >= 0 ? caret + cursorOffset : caret + text.length;

        const useRichText = targetEl.isContentEditable;
        const htmlConverter = macro.richText ? markdownToHtml : textToHtml;
        const richHtml = useRichText
          ? (current.substring(0, caret) ? textToHtml(current.substring(0, caret)) : '') + htmlConverter(text) + (current.substring(caret) ? textToHtml(current.substring(caret)) : '')
          : null;

        insertTextUndoable(targetEl, newText, newCaret, useRichText, richHtml);
        trackUsage(macro);
      }
    }

    function updateSelection() {
      results.querySelectorAll('.snaptext-search-item').forEach((item, i) => {
        item.classList.toggle('selected', i === selectedIndex);
      });
      const selected = results.querySelector('.selected');
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    renderResults('');

    input.addEventListener('input', () => {
      selectedIndex = 0;
      renderResults(input.value.toLowerCase());
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, currentFiltered.length - 1);
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const macro = currentFiltered[selectedIndex];
        if (macro) insertFromSearch(macro, savedActiveEl);
      } else if (e.key === 'Escape') {
        closeSearchOverlay();
        if (savedActiveEl) savedActiveEl.focus();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeSearchOverlay();
        if (savedActiveEl) savedActiveEl.focus();
      }
    });

    requestAnimationFrame(() => input.focus());
  }

  function closeSearchOverlay() {
    if (searchOverlay) {
      searchOverlay.remove();
      searchOverlay = null;
    }
  }

  // ── Check if keyboard shortcut matches ───────────────────────────────
  function matchesSearchShortcut(e) {
    const s = searchShortcut;
    return (!!s.ctrlKey === e.ctrlKey) &&
           (!!s.shiftKey === e.shiftKey) &&
           (!!s.altKey === e.altKey) &&
           (!!s.metaKey === e.metaKey) &&
           (s.code === e.code);
  }

  // ── Event listeners ───────────────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    // Customizable search overlay shortcut (default: Ctrl+Shift+Space)
    if (matchesSearchShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      searchOverlay ? closeSearchOverlay() : openSearchOverlay();
      return;
    }

    if (searchOverlay) return;

    const el = document.activeElement;
    if (!isTextInput(el)) return;

    // Expand on Space, Tab, Enter
    if (['Space', 'Tab', 'Enter'].includes(e.code)) {
      const expanded = await tryExpand(el);
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  // ── Auto-suggest popup ────────────────────────────────────────────────
  let autoSuggestIndex = 0;
  let autoSuggestMatches = [];
  let autoSuggestAnchorEl = null;

  function showAutoSuggest(el, matches) {
    if (!autoSuggestEnabled || matches.length === 0) return;
    closeAutoSuggest();

    autoSuggestMatches = matches;
    autoSuggestIndex = 0;
    autoSuggestAnchorEl = el;

    const popup = document.createElement('div');
    popup.className = 'snaptext-autosuggest';
    popup.innerHTML = matches.slice(0, 6).map((m, i) => {
      const triggerDisplay = m.isAbbreviation ? escapeHtml(m.trigger) : escapeHtml(triggerChar) + escapeHtml(m.trigger);
      const bodyPreview = m.body.length > 40 ? m.body.substring(0, 40) + '...' : m.body;
      return `<div class="snaptext-autosuggest-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <span class="snaptext-autosuggest-trigger">${triggerDisplay}</span>
        <span class="snaptext-autosuggest-body">${escapeHtml(bodyPreview)}</span>
      </div>`;
    }).join('');

    // Position near cursor
    const rect = el.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';

    document.body.appendChild(popup);
    autoSuggestPopup = popup;

    // Click handlers
    popup.querySelectorAll('.snaptext-autosuggest-item').forEach(item => {
      item.addEventListener('click', () => {
        selectAutoSuggest(parseInt(item.dataset.index));
      });
    });
  }

  function closeAutoSuggest() {
    if (autoSuggestPopup) {
      autoSuggestPopup.remove();
      autoSuggestPopup = null;
    }
    autoSuggestMatches = [];
    autoSuggestIndex = 0;
  }

  function updateAutoSuggestSelection() {
    if (!autoSuggestPopup) return;
    autoSuggestPopup.querySelectorAll('.snaptext-autosuggest-item').forEach((item, i) => {
      item.classList.toggle('selected', i === autoSuggestIndex);
    });
  }

  async function selectAutoSuggest(index) {
    const macro = autoSuggestMatches[index];
    if (!macro || !autoSuggestAnchorEl) return;

    const el = autoSuggestAnchorEl;
    const text = getTextContent(el);
    const caret = getCaretPosition(el);
    const textBeforeCaret = text.substring(0, caret);

    // Find the trigger position to replace
    const escapedTrigger = escapeRegex(triggerChar);
    const triggerRegex = new RegExp(escapedTrigger + '[a-zA-Z0-9_.-]*$');
    const match = textBeforeCaret.match(triggerRegex);
    const triggerStart = match ? caret - match[0].length : caret;

    const { text: expanded, cursorOffset } = await processVariables(macro.body);
    const before = text.substring(0, triggerStart);
    const after = text.substring(caret);
    const newText = before + expanded + after;
    const newCaret = cursorOffset >= 0 ? triggerStart + cursorOffset : triggerStart + expanded.length;

    const useRichText = el.isContentEditable;
    const htmlConverter = macro.richText ? markdownToHtml : textToHtml;
    const richHtml = useRichText ? (before ? textToHtml(before) : '') + htmlConverter(expanded) + (after ? textToHtml(after) : '') : null;

    closeAutoSuggest();
    insertTextUndoable(el, newText, newCaret, useRichText, richHtml);
    trackUsage(macro);
  }

  // Listen for input to show auto-suggest
  document.addEventListener('input', (e) => {
    if (!autoSuggestEnabled) return;
    const el = e.target;
    if (!isTextInput(el)) return;

    const text = getTextContent(el);
    const caret = getCaretPosition(el);
    const textBeforeCaret = text.substring(0, caret);

    // Check if user is typing after trigger character
    const escapedTrigger = escapeRegex(triggerChar);
    const triggerRegex = new RegExp(escapedTrigger + '([a-zA-Z0-9_.-]*)$');
    const match = textBeforeCaret.match(triggerRegex);

    if (match) {
      const partial = match[1].toLowerCase();
      const matches = macros.filter(m =>
        m.enabled !== false &&
        !m.isAbbreviation &&
        m.trigger.toLowerCase().startsWith(partial)
      ).slice(0, 6);

      if (matches.length > 0) {
        showAutoSuggest(el, matches);
      } else {
        closeAutoSuggest();
      }
    } else {
      closeAutoSuggest();
    }
  }, true);

  // Handle keyboard navigation in auto-suggest
  document.addEventListener('keydown', (e) => {
    if (!autoSuggestPopup) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autoSuggestIndex = Math.min(autoSuggestIndex + 1, autoSuggestMatches.length - 1);
      updateAutoSuggestSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autoSuggestIndex = Math.max(autoSuggestIndex - 1, 0);
      updateAutoSuggestSelection();
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (autoSuggestMatches.length > 0) {
        e.preventDefault();
        selectAutoSuggest(autoSuggestIndex);
      }
    } else if (e.key === 'Escape') {
      closeAutoSuggest();
    }
  }, true);

  // Close auto-suggest on blur
  document.addEventListener('focusout', () => {
    setTimeout(closeAutoSuggest, 150);
  });

  // ── Messages from popup/background ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'INSERT_MACRO') {
      const el = document.activeElement;
      if (isTextInput(el)) {
        processVariables(msg.body).then(({ text, cursorOffset }) => {
          const current = getTextContent(el);
          const caret = getCaretPosition(el);
          const newText = current.substring(0, caret) + text + current.substring(caret);
          const newCaret = cursorOffset >= 0 ? caret + cursorOffset : caret + text.length;

          const useRichText = el.isContentEditable;
          const richHtml = useRichText ? textToHtml(newText) : null;
          insertTextUndoable(el, newText, newCaret, useRichText, richHtml);
          sendResponse({ success: true });
        });
        return true;
      }
      sendResponse({ success: false, error: 'No active text field' });
    }
  });
})();
