// ─────────────────────────────────────────────────────────────────────────
// Imported-file store — persists user-picked `.md` in the WebView's IndexedDB.
//
// Why IndexedDB (not localStorage): the library is text-heavy and may grow past
// localStorage's ~5 MB; IndexedDB is async, origin-private (stays ON the phone),
// and survives WebView reloads and app restarts — so an imported library is
// available fully offline once installed as an `.ehpk`.
//
// We store only the RAW file text keyed by `id` (parsing is cheap and is done
// in `load.makeEntry` on read), so the record is just `{ id, raw, name }`.
// Everything is best-effort: if IndexedDB is unavailable (private mode / a host
// that blocks it), every call resolves empty/no-op and the library is simply
// empty for that session.
// ─────────────────────────────────────────────────────────────────────────

import { makeEntry, type LibraryEntry } from './load'

const DB_NAME = 'g2reader'
const STORE = 'imported'
const DB_VERSION = 1

interface ImportedRecord {
  /** Entry id — primary key. */
  id: string
  /** Original filename (becomes the entry `path`, and the stem fallback). */
  name: string
  /** Raw `.md` text, frontmatter included. */
  raw: string
}

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
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

/** All imported files, parsed into entries (best-effort; [] if unavailable). */
export async function loadImported(): Promise<LibraryEntry[]> {
  const db = await openDb()
  if (!db) return []
  const records = await new Promise<ImportedRecord[]>(resolve => {
    const req = tx(db, 'readonly').getAll()
    req.onsuccess = () => resolve(req.result as ImportedRecord[])
    req.onerror = () => resolve([])
  })
  db.close()
  const stem = (name: string) => name.replace(/\.md$/i, '')
  return records.map(r => makeEntry(r.raw, stem(r.name), r.name))
}

/** Persist one imported file. Returns the parsed entry. */
export async function putImported(name: string, raw: string): Promise<LibraryEntry> {
  const stem = name.replace(/\.md$/i, '')
  const entry = makeEntry(raw, stem, name)
  const db = await openDb()
  if (db) {
    await new Promise<void>(resolve => {
      const req = tx(db, 'readwrite').put({ id: entry.id, name, raw } as ImportedRecord)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
    db.close()
  }
  return entry
}

/** Remove one imported file by id (no-op if absent or store unavailable). */
export async function deleteImported(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>(resolve => {
    const req = tx(db, 'readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
  db.close()
}
