/**
 * A recording on disk is the .duckdb file plus, optionally, its DuckDB
 * write-ahead log (<file>.duckdb.wal). LMU leaves the WAL next to finished
 * recordings (observed in real samples: WALs for sessions months old), so the
 * WAL is part of the session's data — not a sign that it is still being written.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export function walPath(dbPath: string): string {
    return `${dbPath}.wal`
}

export interface RecordingSnapshot {
    /** Combined size of .duckdb and .wal. */
    size: number
    /** Latest mtime of both files (ms, rounded). */
    mtimeMs: number
    hasWal: boolean
}

export async function statRecording(dbPath: string): Promise<RecordingSnapshot | null> {
    let db
    try {
        db = await stat(dbPath)
        if (!db.isFile()) return null
    } catch {
        return null
    }
    let size = db.size
    let mtimeMs = db.mtimeMs
    let hasWal = false
    try {
        const wal = await stat(walPath(dbPath))
        if (wal.isFile()) {
            hasWal = true
            size += wal.size
            mtimeMs = Math.max(mtimeMs, wal.mtimeMs)
        }
    } catch { /* no WAL */ }
    return { size, mtimeMs: Math.round(mtimeMs), hasWal }
}

/** SHA-256 over the .duckdb bytes followed by the .wal bytes (if present). */
export async function hashRecording(dbPath: string, hasWal: boolean): Promise<string> {
    const hash = createHash('sha256')
    for (const p of hasWal ? [dbPath, walPath(dbPath)] : [dbPath]) {
        await new Promise<void>((resolve, reject) => {
            createReadStream(p, { highWaterMark: 1 << 20 })
                .on('data', chunk => hash.update(chunk))
                .on('error', reject)
                .on('end', resolve)
        })
    }
    return hash.digest('hex')
}
