// ─────────────────────────────────────────────────────────────────────────
// Imported-file store — persists user-picked `.md` so it survives restarts.
//
// TWO backends behind one tiny string KV interface (`KVBackend`):
//   • HOST KV (the real one on hardware) — the Even Hub native key-value store
//     reached via the SDK bridge (`setLocalStorage`/`getLocalStorage`). It lives
//     in the PHONE app's native storage, NOT in the WebView, so it survives the
//     WebView being torn down / reloaded and the app being restarted. The
//     WebView's own IndexedDB/localStorage is wiped between launches inside the
//     packaged `.ehpk` (opaque/ephemeral origin) — which is why imported files
//     used to vanish after one session. `main.ts` installs this backend via
//     `setStorageBackend` once the bridge is up.
//   • IndexedDB (the default) — used for desktop-browser dev, where the origin
//     is stable so IndexedDB persists normally and there's no host bridge.
//
// Both are addressed as a flat string→string KV. Because the host KV can't
// enumerate keys, we keep an explicit INDEX key (`g2reader:index`, a JSON list
// of {id,name}) plus one key per file (`g2reader:file:<id>` → raw `.md`). We
// store only RAW text; parsing is cheap and done in `load.makeEntry` on read.
//
// Everything is best-effort: if storage is unavailable every call resolves
// empty/no-op and the library is simply empty for that session.
// ─────────────────────────────────────────────────────────────────────────

import { makeEntry, type LibraryEntry } from './load'

/** Minimal async string KV. Missing key → null. Deletion = set('') (host KV
 *  has no delete; an empty value is treated as absent on read). */
export interface KVBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

const INDEX_KEY = 'g2reader:index'
const fileKey = (id: string) => `g2reader:file:${id}`

interface IndexRecord {
  /** Entry id — also the file-key suffix. */
  id: string
  /** Original filename (becomes the entry `path`, and the stem fallback). */
  name: string
}

// ── Backend selection ────────────────────────────────────────────────────────

let backend: KVBackend = makeDefaultBackend()

/**
 * Swap in a different KV backend (host-native storage on real hardware). Call
 * this once the glasses bridge is up; subsequent load/put/delete go to it, so
 * imports persist in the phone's native store instead of the WebView's
 * disposable IndexedDB. Idempotent.
 */
export function setStorageBackend(b: KVBackend): void {
  backend = b
}

function makeDefaultBackend(): KVBackend {
  return typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend()
}

// ── Public API ───────────────────────────────────────────────────────────────

/** All imported files, parsed into entries (best-effort; [] if unavailable). */
export async function loadImported(): Promise<LibraryEntry[]> {
  const index = await readIndex()
  const entries: LibraryEntry[] = []
  for (const rec of index) {
    const raw = await backend.get(fileKey(rec.id))
    if (!raw) continue // missing or tombstoned (empty) — skip
    const stem = rec.name.replace(/\.md$/i, '')
    entries.push(makeEntry(raw, stem, rec.name))
  }
  return entries
}

/** Persist one imported file (and index it). Returns the parsed entry. */
export async function putImported(name: string, raw: string): Promise<LibraryEntry> {
  const stem = name.replace(/\.md$/i, '')
  const entry = makeEntry(raw, stem, name)
  await backend.set(fileKey(entry.id), raw)
  const index = await readIndex()
  const next = index.filter(r => r.id !== entry.id)
  next.push({ id: entry.id, name })
  await writeIndex(next)
  return entry
}

/** Remove one imported file by id (no-op if absent or store unavailable). */
export async function deleteImported(id: string): Promise<void> {
  const index = await readIndex()
  await writeIndex(index.filter(r => r.id !== id))
  await backend.set(fileKey(id), '') // host KV has no delete; '' reads as absent
}

// ── Index helpers ────────────────────────────────────────────────────────────

async function readIndex(): Promise<IndexRecord[]> {
  const raw = await backend.get(INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as IndexRecord[]) : []
  } catch {
    return []
  }
}

async function writeIndex(records: IndexRecord[]): Promise<void> {
  await backend.set(INDEX_KEY, JSON.stringify(records))
}

// ── IndexedDB backend (desktop dev / stable-origin fallback) ─────────────────

const DB_NAME = 'g2reader'
const STORE = 'kv'
const DB_VERSION = 2

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function idbBackend(): KVBackend {
  return {
    async get(key) {
      const db = await openDb()
      if (!db) return null
      return new Promise<string | null>(resolve => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
        req.onsuccess = () => {
          db.close()
          const rec = req.result as { k: string; v: string } | undefined
          resolve(rec ? rec.v : null)
        }
        req.onerror = () => {
          db.close()
          resolve(null)
        }
      })
    },
    async set(key, value) {
      const db = await openDb()
      if (!db) return
      await new Promise<void>(resolve => {
        const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put({ k: key, v: value })
        req.onsuccess = () => {
          db.close()
          resolve()
        }
        req.onerror = () => {
          db.close()
          resolve()
        }
      })
    },
  }
}

// ── In-memory backend (no IndexedDB and no host bridge — session-only) ───────

function memoryBackend(): KVBackend {
  const m = new Map<string, string>()
  return {
    async get(key) {
      return m.has(key) ? m.get(key)! : null
    },
    async set(key, value) {
      m.set(key, value)
    },
  }
}
