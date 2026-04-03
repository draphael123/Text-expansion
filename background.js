/**
 * SnapText Background Service Worker v3
 *
 * Features:
 * - Default macros including {{macro:}} demo
 * - Firebase Firestore sync with conflict resolution (updated_at comparison)
 * - Usage tracking support
 * - Domain blocklist in settings
 * - Cloud share links via Firestore shared_snippets collection
 * - Legacy Base64 share code support
 * - CSV and JSON export
 * - Folder CRUD (create, rename, delete)
 */

// Firebase configuration
const FIREBASE_CONFIG = {
  projectId: 'snaptext-d1b3f',
  apiKey: 'AIzaSyBHyvKlLYZARXAKwG6Uk1_XGP4a7Gwp3k',
  authDomain: 'snaptext-d1b3f.firebaseapp.com'
};

// Firebase API endpoints
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const FIREBASE_FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ── Default starter macros ──────────────────────────────────────────────
const DEFAULT_MACROS = [
  {
    id: 'default-1',
    trigger: 'sig',
    body: 'Best regards,\n{{input:Your Name}}',
    folder: 'Email',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-2',
    trigger: 'today',
    body: '{{date}}',
    folder: 'Dates',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-3',
    trigger: 'now',
    body: '{{time}}',
    folder: 'Dates',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-4',
    trigger: 'cb',
    body: '{{clipboard}}',
    folder: 'Utility',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-5',
    trigger: 'reply',
    body: 'Hi {{input:Name}},\n\nThank you for reaching out. {{cursor}}\n\nBest,\n{{macro:sig}}',
    folder: 'Email',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-6',
    trigger: 'ack',
    body: 'Thanks for reporting this. I\'m looking into it now and will follow up within 24 hours.',
    folder: 'Support',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'default-7',
    trigger: 'meeting',
    body: 'Hi {{input:Name}},\n\nCould we schedule a quick call on {{input:Date/Time}}? I\'d like to discuss {{input:Topic}}.\n\nLet me know what works.\n\n{{macro:sig}}',
    folder: 'Email',
    enabled: true, useCount: 0,
    createdAt: Date.now(), updatedAt: Date.now()
  }
];

// ── Initialize on install ───────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { macros } = await chrome.storage.local.get(['macros']);
    if (!macros || macros.length === 0) {
      await chrome.storage.local.set({ macros: DEFAULT_MACROS });
    }
    await chrome.storage.local.set({
      settings: {
        triggerChar: ';',
        expandOn: ['Space', 'Tab', 'Enter'],
        syncEnabled: false,
        blockedDomains: []
      },
      stats: {},
      charsSaved: 0,
      conflicts: [],
      folders: []
    });
  }
});

// ── Firebase Auth REST API Helpers ──────────────────────────────────────
async function firebaseSignUp(email, password) {
  try {
    const response = await fetch(`${FIREBASE_AUTH_URL}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
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

    await chrome.storage.local.set({ session });
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
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
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

    await chrome.storage.local.set({ session });
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
    const session = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      localId: data.user_id,
      expiresAt: Date.now() + (data.expires_in * 1000)
    };

    // Preserve email if available
    const { session: oldSession } = await chrome.storage.local.get(['session']);
    if (oldSession?.email) {
      session.email = oldSession.email;
    }

    await chrome.storage.local.set({ session });
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function firebaseSignOut() {
  await chrome.storage.local.set({ session: null });
  return { success: true };
}

async function getValidSession() {
  const { session } = await chrome.storage.local.get(['session']);
  if (!session) return null;

  // Check if token is expired or about to expire (within 1 minute)
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
    if (session.refreshToken) {
      const result = await firebaseRefreshToken(session.refreshToken);
      if (result.success) {
        return result.session;
      }
    }
    // Token refresh failed, clear session
    await chrome.storage.local.set({ session: null });
    return null;
  }

  return session;
}

// ── Firestore Value Conversion Helpers ──────────────────────────────────
function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue)
      }
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: toFirestoreDoc(value)
      }
    };
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

// ── Firestore REST API Helpers ──────────────────────────────────────────
async function firestoreGet(collection, docId, idToken) {
  try {
    const response = await fetch(
      `${FIREBASE_FIRESTORE_URL}/${collection}/${docId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      return null;
    }

    const doc = await response.json();
    return {
      id: doc.name.split('/').pop(),
      ...fromFirestoreDoc(doc.fields || {})
    };
  } catch (error) {
    console.error('Firestore GET error:', error);
    return null;
  }
}

async function firestoreQuery(collection, filters, idToken) {
  try {
    const structuredQuery = {
      from: [{ collectionId: collection }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: filters
        }
      }
    };

    const response = await fetch(
      `${FIREBASE_FIRESTORE_URL}:runQuery`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          structuredQuery
        })
      }
    );

    if (!response.ok) return [];

    const text = await response.text();
    if (!text) return [];

    // Parse newline-delimited JSON
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
        } catch (e) {
          // Skip malformed lines
        }
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

    const response = await fetch(
      `${FIREBASE_FIRESTORE_URL}/${docPath}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: toFirestoreDoc(data)
        })
      }
    );

    if (!response.ok) return null;

    const doc = await response.json();
    return {
      id: doc.name.split('/').pop(),
      ...fromFirestoreDoc(doc.fields || {})
    };
  } catch (error) {
    console.error('Firestore SET error:', error);
    return null;
  }
}

async function firestoreDelete(collection, docId, idToken) {
  try {
    const response = await fetch(
      `${FIREBASE_FIRESTORE_URL}/${collection}/${docId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Firestore DELETE error:', error);
    return false;
  }
}

// ── Sync with conflict resolution ───────────────────────────────────────
async function syncWithConflictResolution() {
  const { macros: localMacros = [], session } = await chrome.storage.local.get(['macros', 'session']);
  if (!session?.idToken || !session?.localId) return { success: false };

  // Validate and refresh session if needed
  const validSession = await getValidSession();
  if (!validSession) return { success: false };

  // Query macros where user_id == session.localId
  const filters = [
    {
      fieldFilter: {
        field: { fieldPath: 'user_id' },
        op: 'EQUAL',
        value: { stringValue: validSession.localId }
      }
    }
  ];

  const cloudData = await firestoreQuery('macros', filters, validSession.idToken);
  if (!cloudData) return { success: false };

  const cloudMap = new Map();
  for (const m of cloudData) {
    cloudMap.set(m.id, {
      id: m.id,
      trigger: m.trigger,
      body: m.body,
      folder: m.folder,
      enabled: m.enabled,
      updatedAt: m.updatedAt
    });
  }

  const localMap = new Map();
  for (const m of localMacros) {
    localMap.set(m.id, m);
  }

  const merged = [];
  const conflicts = [];
  const processedIds = new Set();

  for (const local of localMacros) {
    processedIds.add(local.id);
    const cloud = cloudMap.get(local.id);

    if (!cloud) {
      merged.push(local);
    } else if (local.updatedAt === cloud.updatedAt) {
      merged.push(local);
    } else if (local.updatedAt > cloud.updatedAt) {
      merged.push(local);
    } else if (cloud.updatedAt > local.updatedAt) {
      const bodyDiffers = local.body !== cloud.body || local.trigger !== cloud.trigger;
      if (bodyDiffers && local.updatedAt > local.createdAt) {
        conflicts.push({
          id: local.id,
          trigger: local.trigger,
          localBody: local.body,
          cloudBody: cloud.body,
          localUpdated: local.updatedAt,
          cloudUpdated: cloud.updatedAt
        });
        merged.push({
          ...local,
          trigger: cloud.trigger,
          body: cloud.body,
          folder: cloud.folder,
          enabled: cloud.enabled,
          updatedAt: cloud.updatedAt
        });
      } else {
        merged.push({
          ...local,
          trigger: cloud.trigger,
          body: cloud.body,
          folder: cloud.folder,
          enabled: cloud.enabled,
          updatedAt: cloud.updatedAt
        });
      }
    }
  }

  for (const [id, cloud] of cloudMap) {
    if (!processedIds.has(id)) {
      merged.push({
        id: cloud.id,
        trigger: cloud.trigger,
        body: cloud.body,
        folder: cloud.folder,
        enabled: cloud.enabled,
        useCount: 0,
        createdAt: cloud.updatedAt,
        updatedAt: cloud.updatedAt
      });
    }
  }

  await chrome.storage.local.set({ macros: merged });

  if (conflicts.length > 0) {
    await chrome.storage.local.set({ conflicts });
  }

  await pushMacrosToCloud(merged, validSession);

  return { success: true, conflicts: conflicts.length };
}

async function pushMacrosToCloud(macrosList, session) {
  if (!macrosList) {
    const data = await chrome.storage.local.get(['macros', 'session']);
    macrosList = data.macros;
    session = data.session;
  }

  if (!session?.idToken || !session?.localId || !macrosList) return;

  // Validate and refresh session if needed
  const validSession = await getValidSession();
  if (!validSession) return;

  // Push each macro individually (or use batch write endpoint if preferred)
  for (const m of macrosList) {
    const cloudMacro = {
      id: m.id,
      user_id: validSession.localId,
      trigger: m.trigger,
      body: m.body,
      folder: m.folder || 'General',
      enabled: m.enabled !== false,
      created_at: m.createdAt || Date.now(),
      updated_at: m.updatedAt || Date.now()
    };

    await firestoreSet('macros', m.id, cloudMacro, validSession.idToken);
  }
}

// ── Share code generation (legacy Base64) ───────────────────────────────
function generateShareCode(macrosList) {
  const payload = macrosList.map(m => ({
    trigger: m.trigger,
    body: m.body,
    folder: m.folder || 'General'
  }));
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function parseShareCode(code) {
  try {
    const json = decodeURIComponent(escape(atob(code)));
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(m => ({
      id: 'shared-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      trigger: m.trigger,
      body: m.body,
      folder: m.folder || 'Imported',
      enabled: true,
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));
  } catch {
    return null;
  }
}

// ── Cloud sharing (Firestore shared_snippets) ───────────────────────────
function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function publishToCloud(title, description, macrosList, isPublic) {
  const { session } = await chrome.storage.local.get(['session']);
  if (!session?.idToken || !session?.localId) {
    return { success: false, error: 'Sign in to share via cloud' };
  }

  const validSession = await getValidSession();
  if (!validSession) return { success: false, error: 'Session expired' };

  const shareCode = generateShortCode();
  const docId = 'share-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const payload = {
    share_code: shareCode,
    author_id: validSession.localId,
    author_name: validSession.email?.split('@')[0] || 'Anonymous',
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

  const result = await firestoreSet('shared_snippets', docId, payload, validSession.idToken);

  if (result) {
    return { success: true, shareCode, id: docId };
  }
  return { success: false, error: 'Failed to publish' };
}

async function importFromCloud(shareCode) {
  const session = await getValidSession();

  // Query shared_snippets where share_code == shareCode
  const filters = [
    {
      fieldFilter: {
        field: { fieldPath: 'share_code' },
        op: 'EQUAL',
        value: { stringValue: shareCode }
      }
    }
  ];

  // For public queries, we need to make an unauthenticated request
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

  // Increment download counter: read current value, increment, update
  if (session?.idToken && shared.id) {
    const currentDoc = await firestoreGet('shared_snippets', shared.id, session.idToken);
    if (currentDoc) {
      const newCount = (currentDoc.download_count || 0) + 1;
      await firestoreSet('shared_snippets', shared.id, {
        ...currentDoc,
        download_count: newCount,
        updated_at: Date.now()
      }, session.idToken);
    }
  }

  const { macros: existing = [] } = await chrome.storage.local.get(['macros']);
  await chrome.storage.local.set({ macros: [...existing, ...imported] });

  return {
    success: true,
    count: imported.length,
    title: shared.title,
    author: shared.author_name
  };
}

async function browsePublicShares(searchQuery) {
  // Query shared_snippets where is_public == true
  const filters = [
    {
      fieldFilter: {
        field: { fieldPath: 'is_public' },
        op: 'EQUAL',
        value: { booleanValue: true }
      }
    }
  ];

  if (searchQuery) {
    // Note: Firestore doesn't support full-text search via REST API
    // This is a simple substring match in the title/description
    // For production, consider using a separate search service
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'title' },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { stringValue: searchQuery }
      }
    });
  }

  // For public queries without auth
  const data = await firestoreQuery('shared_snippets', filters, '');
  return data || [];
}

async function getMyShares() {
  const { session } = await chrome.storage.local.get(['session']);
  if (!session?.idToken || !session?.localId) return [];

  const validSession = await getValidSession();
  if (!validSession) return [];

  const filters = [
    {
      fieldFilter: {
        field: { fieldPath: 'author_id' },
        op: 'EQUAL',
        value: { stringValue: validSession.localId }
      }
    }
  ];

  const data = await firestoreQuery('shared_snippets', filters, validSession.idToken);
  return data || [];
}

async function deleteShare(shareId) {
  const { session } = await chrome.storage.local.get(['session']);
  if (!session?.idToken) return { success: false };

  const validSession = await getValidSession();
  if (!validSession) return { success: false };

  const result = await firestoreDelete('shared_snippets', shareId, validSession.idToken);
  return { success: result };
}

// ── Export helpers ───────────────────────────────────────────────────────
function macrosToCSV(macrosList) {
  const header = 'trigger,body,folder,enabled,useCount';
  const rows = macrosList.map(m => {
    const body = '"' + (m.body || '').replace(/"/g, '""') + '"';
    const folder = '"' + (m.folder || 'General').replace(/"/g, '""') + '"';
    return `"${m.trigger}",${body},${folder},${m.enabled !== false},${m.useCount || 0}`;
  });
  return header + '\n' + rows.join('\n');
}

function macrosToJSON(macrosList) {
  return JSON.stringify(macrosList.map(m => ({
    trigger: m.trigger,
    body: m.body,
    folder: m.folder || 'General',
    enabled: m.enabled !== false
  })), null, 2);
}

function parseCSVImport(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  // Skip header
  const macros = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row && row.length >= 2) {
      macros.push({
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
  return macros.length > 0 ? macros : null;
}

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'; i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current); current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ── Folder management ───────────────────────────────────────────────────
async function createFolder(name) {
  const { macros: m = [] } = await chrome.storage.local.get(['macros']);
  const existingFolders = [...new Set(m.map(x => (x.folder || 'General').toLowerCase()))];
  if (existingFolders.includes(name.toLowerCase())) {
    return { success: false, error: 'Folder already exists' };
  }
  // We track folders implicitly via macros, but also store explicit folder list
  const { folders = [] } = await chrome.storage.local.get(['folders']);
  if (!folders.find(f => f.name.toLowerCase() === name.toLowerCase())) {
    folders.push({ name, createdAt: Date.now() });
    await chrome.storage.local.set({ folders });
  }
  return { success: true };
}

async function renameFolder(oldName, newName) {
  const { macros: m = [] } = await chrome.storage.local.get(['macros']);
  const updated = m.map(macro => {
    if ((macro.folder || 'General') === oldName) {
      return { ...macro, folder: newName, updatedAt: Date.now() };
    }
    return macro;
  });
  await chrome.storage.local.set({ macros: updated });

  // Update explicit folder list too
  const { folders = [] } = await chrome.storage.local.get(['folders']);
  const updatedFolders = folders.map(f => f.name === oldName ? { ...f, name: newName } : f);
  await chrome.storage.local.set({ folders: updatedFolders });

  return { success: true, macros: updated };
}

async function deleteFolder(name) {
  const { macros: m = [] } = await chrome.storage.local.get(['macros']);
  // Move macros in this folder to General
  const updated = m.map(macro => {
    if ((macro.folder || 'General') === name) {
      return { ...macro, folder: 'General', updatedAt: Date.now() };
    }
    return macro;
  });
  await chrome.storage.local.set({ macros: updated });

  const { folders = [] } = await chrome.storage.local.get(['folders']);
  await chrome.storage.local.set({ folders: folders.filter(f => f.name !== name) });

  return { success: true, macros: updated };
}

// ── Message handling ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FIREBASE_SIGN_UP') {
    firebaseSignUp(msg.email, msg.password).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'FIREBASE_SIGN_IN') {
    firebaseSignIn(msg.email, msg.password).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'FIREBASE_SIGN_OUT') {
    firebaseSignOut().then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'FIREBASE_GET_SESSION') {
    getValidSession().then(session => sendResponse({ session }));
    return true;
  }

  if (msg.type === 'SYNC_PUSH') {
    pushMacrosToCloud().then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'SYNC_PULL' || msg.type === 'SYNC_FULL') {
    syncWithConflictResolution().then((result) => sendResponse(result));
    return true;
  }

  if (msg.type === 'GET_MACROS') {
    chrome.storage.local.get(['macros'], async (result) => {
      let macros = result.macros || [];
      // Seed defaults if storage is empty (e.g. reload without fresh install)
      if (macros.length === 0) {
        macros = DEFAULT_MACROS;
        await chrome.storage.local.set({ macros });
      }
      sendResponse({ macros });
    });
    return true;
  }

  // Legacy Base64 share codes
  if (msg.type === 'GENERATE_SHARE_CODE') {
    const code = generateShareCode(msg.macros || []);
    sendResponse({ code });
    return true;
  }

  if (msg.type === 'IMPORT_SHARE_CODE') {
    const imported = parseShareCode(msg.code || '');
    if (!imported) {
      sendResponse({ success: false, error: 'Invalid share code' });
    } else {
      chrome.storage.local.get(['macros'], async (result) => {
        const existing = result.macros || [];
        await chrome.storage.local.set({ macros: [...existing, ...imported] });
        sendResponse({ success: true, count: imported.length });
      });
    }
    return true;
  }

  // Cloud sharing
  if (msg.type === 'PUBLISH_TO_CLOUD') {
    publishToCloud(msg.title, msg.description, msg.macros, msg.isPublic)
      .then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'IMPORT_FROM_CLOUD') {
    importFromCloud(msg.shareCode).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'BROWSE_PUBLIC') {
    browsePublicShares(msg.query).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'GET_MY_SHARES') {
    getMyShares().then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'DELETE_SHARE') {
    deleteShare(msg.shareId).then(r => sendResponse(r));
    return true;
  }

  // Export
  if (msg.type === 'EXPORT_CSV') {
    const csv = macrosToCSV(msg.macros || []);
    sendResponse({ csv });
    return true;
  }

  if (msg.type === 'EXPORT_JSON') {
    const json = macrosToJSON(msg.macros || []);
    sendResponse({ json });
    return true;
  }

  // Import CSV
  if (msg.type === 'IMPORT_CSV') {
    const imported = parseCSVImport(msg.csv || '');
    if (!imported) {
      sendResponse({ success: false, error: 'Invalid CSV format' });
    } else {
      chrome.storage.local.get(['macros'], async (result) => {
        const existing = result.macros || [];
        await chrome.storage.local.set({ macros: [...existing, ...imported] });
        sendResponse({ success: true, count: imported.length });
      });
    }
    return true;
  }

  // Folder management
  if (msg.type === 'CREATE_FOLDER') {
    createFolder(msg.name).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'RENAME_FOLDER') {
    renameFolder(msg.oldName, msg.newName).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'DELETE_FOLDER') {
    deleteFolder(msg.name).then(r => sendResponse(r));
    return true;
  }

  if (msg.type === 'RESOLVE_CONFLICT') {
    chrome.storage.local.get(['conflicts'], async (result) => {
      const conflicts = (result.conflicts || []).filter(c => c.id !== msg.macroId);
      await chrome.storage.local.set({ conflicts });
      sendResponse({ success: true, remaining: conflicts.length });
    });
    return true;
  }
});

// ── Periodic sync with token refresh ────────────────────────────────────
chrome.alarms.create('syncMacros', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncMacros') {
    const { session, settings } = await chrome.storage.local.get(['session', 'settings']);

    if (session?.idToken && settings?.syncEnabled) {
      // Validate session and refresh token if needed
      const validSession = await getValidSession();
      if (validSession) {
        await syncWithConflictResolution();
      }
    }
  }
});
