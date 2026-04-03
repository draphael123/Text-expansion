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
  let searchOverlay = null;
  let lastExpansion = null; // for undo

  // ── Load from storage ─────────────────────────────────────────────────
  function loadAll() {
    chrome.storage.local.get(['macros', 'settings'], (result) => {
      macros = result.macros || [];
      settings = result.settings || {};
      blockedDomains = (settings.blockedDomains || []).map(d => d.toLowerCase().trim());
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.macros) macros = changes.macros.newValue || [];
      if (changes.settings) {
        settings = changes.settings.newValue || {};
        blockedDomains = (settings.blockedDomains || []).map(d => d.toLowerCase().trim());
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

  async function getClipboard() {
    try { return await navigator.clipboard.readText(); }
    catch { return '[clipboard unavailable]'; }
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

    // Step 2: simple variables
    result = result.replace(/\{\{date\}\}/gi, getFormattedDate());
    result = result.replace(/\{\{time\}\}/gi, getFormattedTime());

    if (/\{\{clipboard\}\}/i.test(result)) {
      const clip = await getClipboard();
      result = result.replace(/\{\{clipboard\}\}/gi, clip);
    }

    // Step 3: collect all {{input:Label}} prompts
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

    // Step 5: cursor positioning
    let cursorOffset = -1;
    const cursorMatch = result.indexOf('{{cursor}}');
    if (cursorMatch !== -1) {
      cursorOffset = cursorMatch;
      result = result.replace(/\{\{cursor\}\}/i, '');
    }

    return { text: result, cursorOffset };
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
  // Uses execCommand('insertText') for <input>/<textarea> so Ctrl+Z works.
  // For contenteditable, uses insertHTML for rich text support.
  function insertTextUndoable(el, newFullText, caretPos, isRichText, richHtml) {
    if (el.isContentEditable && isRichText && richHtml) {
      // Rich text path: select all content, then insertHTML
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertHTML', false, richHtml);
      // Position cursor
      if (caretPos >= 0) setCaretPosition(el, caretPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (!el.isContentEditable) {
      // Standard input/textarea: select all, insertText (undo-friendly)
      el.focus();
      el.setSelectionRange(0, el.value.length);
      document.execCommand('insertText', false, newFullText);
      if (caretPos >= 0) el.setSelectionRange(caretPos, caretPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable plain text fallback
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, newFullText);
      if (caretPos >= 0) setCaretPosition(el, caretPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Convert plain text to simple HTML (preserves line breaks)
  function textToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
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
  async function tryExpand(el) {
    if (isSiteBlocked()) return false;

    const text = getTextContent(el);
    const caret = getCaretPosition(el);

    const textBeforeCaret = text.substring(0, caret);
    const triggerMatch = textBeforeCaret.match(/;([a-zA-Z0-9_.-]+)$/);
    if (!triggerMatch) return false;

    const triggerName = triggerMatch[1].toLowerCase();
    const macro = macros.find(
      (m) => m.trigger.toLowerCase() === triggerName && m.enabled !== false
    );
    if (!macro) return false;

    const triggerStart = caret - triggerMatch[0].length;
    const { text: expanded, cursorOffset } = await processVariables(macro.body);

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

    // Determine if we should use rich text
    const useRichText = el.isContentEditable;
    const richHtml = useRichText ? (before ? textToHtml(before) : '') + textToHtml(expanded) + (after ? textToHtml(after) : '') : null;

    insertTextUndoable(el, newText, newCaret, useRichText, richHtml);
    trackUsage(macro);
    return true;
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
        return `
        <div class="snaptext-search-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
          <span class="snaptext-search-trigger">;${escapeHtml(m.trigger)}</span>
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
        const richHtml = useRichText
          ? (current.substring(0, caret) ? textToHtml(current.substring(0, caret)) : '') + textToHtml(text) + (current.substring(caret) ? textToHtml(current.substring(caret)) : '')
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

  // ── Event listeners ───────────────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    // Ctrl+Shift+Space → search overlay
    if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
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
