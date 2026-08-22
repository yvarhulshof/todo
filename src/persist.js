// Layered persistence.
//
//   1. A real file on disk (File System Access API) is the source of truth.
//      Point it at a folder inside OneDrive and you get sync, versioning and
//      backup from storage your employer already sanctions.
//   2. localStorage mirrors state so the app opens instantly, and works at all
//      in browsers without the File System Access API.
//   3. A snapshot ring keeps the last 20 states for recovery from bulk damage.
//
// Clearing site data costs you nothing when a file is attached.

import { migrate, createInitialData } from './model.js';

const CACHE_KEY = 'todo.cache.v1';
const SNAPSHOT_KEY = 'todo.snapshots.v1';
const IDB_NAME = 'todo-handles';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'data-file';
const SNAPSHOT_LIMIT = 20;
const WRITE_DEBOUNCE_MS = 500;

export const supportsFileSystem =
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

// navigator.brave is Brave's own, non-spoofable feature-detection hook (see
// https://github.com/brave/brave-browser/wiki/Detecting-Brave). Brave hides
// its name from the user-agent string on purpose, so this is the only clean
// way to tailor the fallback copy for it without sniffing the UA.
export const isBrave =
  typeof navigator !== 'undefined' && Boolean(navigator.brave);

// ------------------------------------------------------------ localStorage

function safeLocalStorage() {
  try {
    const probe = '__todo_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null; // private mode, or site data blocked by policy
  }
}

const ls = typeof window === 'undefined' ? null : safeLocalStorage();

export function readCache() {
  if (!ls) return null;
  try {
    const raw = ls.getItem(CACHE_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCache(data) {
  if (!ls) return false;
  try {
    ls.setItem(CACHE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // quota exceeded; the file is still the source of truth
  }
}

// --------------------------------------------------------------- snapshots

export function pushSnapshot(data) {
  if (!ls) return;
  try {
    const ring = JSON.parse(ls.getItem(SNAPSHOT_KEY) || '[]');
    ring.push({ at: new Date().toISOString(), data });
    while (ring.length > SNAPSHOT_LIMIT) ring.shift();
    ls.setItem(SNAPSHOT_KEY, JSON.stringify(ring));
  } catch {
    // A full quota must never block the actual save.
  }
}

export function listSnapshots() {
  if (!ls) return [];
  try {
    return JSON.parse(ls.getItem(SNAPSHOT_KEY) || '[]');
  } catch {
    return [];
  }
}

// ------------------------------------------------------- IndexedDB (handle)

function idb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    return undefined;
  });
}

async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- file backing

async function hasPermission(handle, request) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/**
 * Reconnect to a previously chosen file without prompting. Returns the handle
 * only if permission is still granted — Chrome sometimes needs a fresh user
 * gesture after a restart, which the UI handles as a one-click reconnect.
 */
export async function restoreHandle() {
  const handle = await idbGet(HANDLE_KEY);
  if (!handle) return { handle: null, needsPermission: false };
  const granted = await hasPermission(handle, false);
  return { handle: granted ? handle : null, needsPermission: !granted, pending: handle };
}

export async function grantPending(handle) {
  const granted = await hasPermission(handle, true);
  return granted ? handle : null;
}

export async function chooseNewFile(suggestedName = 'todo-data.json') {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'Todo data', accept: { 'application/json': ['.json'] } }],
  });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

export async function chooseExistingFile() {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{ description: 'Todo data', accept: { 'application/json': ['.json'] } }],
  });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

export async function forgetFile() {
  await idbSet(HANDLE_KEY, null);
}

export async function readFile(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  if (!text.trim()) return null;
  return migrate(JSON.parse(text));
}

async function writeFile(handle, data) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// -------------------------------------------------------------- the manager

/**
 * Owns the write-through pipeline and reports status so the UI can never
 * leave the user guessing whether their data is safe.
 *
 * Status: 'idle' | 'saving' | 'saved' | 'cache-only' | 'error'
 */
export class Persistence extends EventTarget {
  constructor() {
    super();
    this.handle = null;
    this.pendingHandle = null;
    this.status = 'idle';
    this.error = null;
    this.fileName = null;
    this._timer = null;
    this._queued = null;
    this._writing = false;
    this._snapshotAt = 0;
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.dispatchEvent(new CustomEvent('status', { detail: { status, error } }));
  }

  get fileBacked() {
    return Boolean(this.handle);
  }

  async init() {
    // Ask the browser not to evict the cache under disk pressure. Best effort:
    // it does not survive a user or admin clearing site data, which is exactly
    // why the file is the real answer.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* not supported */
    }

    let data = readCache();

    if (supportsFileSystem) {
      const { handle, needsPermission, pending } = await restoreHandle();
      if (handle) {
        this.handle = handle;
        this.fileName = handle.name;
        try {
          const fromFile = await readFile(handle);
          // The file wins: it may have been updated on another machine via
          // OneDrive while this browser held a stale cache.
          if (fromFile) data = fromFile;
        } catch (err) {
          this.setStatus('error', `Could not read ${handle.name}: ${err.message}`);
        }
      } else if (needsPermission) {
        this.pendingHandle = pending;
        this.fileName = pending?.name ?? null;
      }
    }

    if (!data) data = createInitialData();
    if (!this.handle) this.setStatus(supportsFileSystem ? 'cache-only' : 'cache-only');
    else this.setStatus('saved');
    return data;
  }

  /** Attach a file and immediately write current state into it. */
  async attachNew(data, suggestedName) {
    const handle = await chooseNewFile(suggestedName);
    this.handle = handle;
    this.pendingHandle = null;
    this.fileName = handle.name;
    await this.flush(data);
    return handle;
  }

  /** Attach an existing file and adopt its contents. */
  async attachExisting() {
    const handle = await chooseExistingFile();
    const data = await readFile(handle);
    this.handle = handle;
    this.pendingHandle = null;
    this.fileName = handle.name;
    this.setStatus('saved');
    return { handle, data };
  }

  async reconnect() {
    if (!this.pendingHandle) return null;
    const handle = await grantPending(this.pendingHandle);
    if (!handle) return null;
    this.handle = handle;
    this.pendingHandle = null;
    this.fileName = handle.name;
    const data = await readFile(handle);
    this.setStatus('saved');
    return data;
  }

  async detach() {
    await forgetFile();
    this.handle = null;
    this.pendingHandle = null;
    this.fileName = null;
    this.setStatus('cache-only');
  }

  /** Debounced write-through. Safe to call on every keystroke. */
  save(data) {
    writeCache(data);

    // One snapshot a minute at most — enough to recover from bulk damage
    // without churning the ring on every edit.
    const nowMs = Date.now();
    if (nowMs - this._snapshotAt > 60000) {
      this._snapshotAt = nowMs;
      pushSnapshot(data);
    }

    if (!this.handle) {
      this.setStatus('cache-only');
      return;
    }
    this._queued = data;
    this.setStatus('saving');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._drain(), WRITE_DEBOUNCE_MS);
  }

  async _drain() {
    if (this._writing || !this._queued || !this.handle) return;
    this._writing = true;
    const data = this._queued;
    this._queued = null;
    try {
      await writeFile(this.handle, data);
      this.setStatus(this._queued ? 'saving' : 'saved');
    } catch (err) {
      this.setStatus('error', err.message);
    } finally {
      this._writing = false;
      if (this._queued) this._drain();
    }
  }

  /** Write immediately, bypassing the debounce. */
  async flush(data) {
    clearTimeout(this._timer);
    writeCache(data);
    if (!this.handle) {
      this.setStatus('cache-only');
      return;
    }
    this._queued = data;
    await this._drain();
  }
}

// ----------------------------------------------------------- export/import

export function exportBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function parseImport(text) {
  const parsed = JSON.parse(text);
  const data = migrate(parsed);
  if (!data) throw new Error('That file is not a todo export.');
  return data;
}
