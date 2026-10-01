/**
 * Watches the LMU telemetry folder and keeps the SQLite index in sync.
 *
 * - fs.watch triggers a debounced scan; a periodic scan is the safety net
 *   (fs.watch can miss events, and the folder may not exist yet).
 * - New/changed files are only indexed once stable (LMU writes the .duckdb
 *   during the whole session). A recording is the .duckdb plus its .wal,
 *   which LMU leaves in place after the session (see recording-file.ts).
 * - Content hash dedupes: a file moved/copied/imported twice is one session.
 * - Optional archive copies each session to %APPDATA% so it survives deletion.
 */
import { watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
    deleteSession,
    findSessionByHash,
    findSessionByPath,
    insertSession,
    listSessionsInFolder,
    relocateSession,
    setArchivedPath,
    setFileMissing,
    updateSessionFile,
    type Db,
} from '../db'
import { isDuckDbName } from '../locate/telemetry-folder'
import { hashRecording, statRecording, walPath } from './recording-file'
import { StabilityTracker } from './stability'

const STABLE_MS = 10_000
const PENDING_POLL_MS = 3_000
const PERIODIC_SCAN_MS = 30_000
const WATCH_DEBOUNCE_MS = 1_000

export interface IndexerEvents {
    sessionsChanged(): void
    statusChanged(): void
}

export class Indexer {
    private folder: string | null = null
    private watcher: FSWatcher | null = null
    private periodic: NodeJS.Timeout | null = null
    private pendingTimer: NodeJS.Timeout | null = null
    private debounce: NodeJS.Timeout | null = null
    private scanning: Promise<void> | null = null
    private rescanRequested = false
    private readonly stability = new StabilityTracker(STABLE_MS)

    archiveEnabled = false
    lastScanAt: string | null = null
    lastError: string | null = null
    folderExists = false

    constructor(
        private readonly db: Db,
        private readonly archiveDir: string,
        private readonly events: IndexerEvents,
    ) {}

    get activeFolder(): string | null {
        return this.folder
    }

    get pendingFiles(): number {
        return this.stability.size
    }

    setFolder(folder: string | null): void {
        if (folder === this.folder) return
        this.stopWatching()
        this.folder = folder
        this.stability.retain(new Set())
        if (folder) {
            this.periodic = setInterval(() => void this.scan(), PERIODIC_SCAN_MS)
            void this.scan()
        }
        this.events.statusChanged()
    }

    stop(): void {
        this.stopWatching()
        this.folder = null
    }

    /** Runs a scan; concurrent calls coalesce into one follow-up scan. */
    scan(): Promise<void> {
        if (this.scanning) {
            this.rescanRequested = true
            return this.scanning
        }
        this.scanning = (async () => {
            try {
                do {
                    this.rescanRequested = false
                    await this.scanOnce()
                } while (this.rescanRequested)
            } finally {
                this.scanning = null
            }
        })()
        return this.scanning
    }

    async setArchiveEnabled(enabled: boolean): Promise<void> {
        this.archiveEnabled = enabled
        if (enabled) await this.archiveAll()
    }

    // ── internals ────────────────────────────────────────────────────────────

    private stopWatching(): void {
        this.watcher?.close()
        this.watcher = null
        for (const t of [this.periodic, this.pendingTimer, this.debounce]) if (t) clearTimeout(t)
        this.periodic = this.pendingTimer = this.debounce = null
    }

    private ensureWatcher(folder: string): void {
        if (this.watcher) return
        try {
            this.watcher = watch(folder, { persistent: false }, () => {
                if (this.debounce) clearTimeout(this.debounce)
                this.debounce = setTimeout(() => void this.scan(), WATCH_DEBOUNCE_MS)
            })
            this.watcher.on('error', () => {
                this.watcher?.close()
                this.watcher = null // re-created by the next periodic scan
            })
        } catch {
            this.watcher = null
        }
    }

    private async scanOnce(): Promise<void> {
        const folder = this.folder
        if (!folder) return

        let names: string[]
        try {
            names = (await readdir(folder)).filter(isDuckDbName)
            if (!this.folderExists) { this.folderExists = true; this.events.statusChanged() }
            this.ensureWatcher(folder)
        } catch {
            if (this.folderExists) { this.folderExists = false; this.events.statusChanged() }
            this.watcher?.close()
            this.watcher = null
            return
        }

        let changed = false
        const present = new Set<string>()
        const now = Date.now()
        const pendingBefore = this.stability.size

        for (const name of names) {
            const path = join(folder, name)
            const snap = await statRecording(path)
            if (!snap) continue
            present.add(path)

            const known = findSessionByPath(this.db, path)
            if (known && known.fileSize === snap.size && known.fileMtimeMs === snap.mtimeMs) {
                this.stability.forget(path)
                if (known.fileMissing) { setFileMissing(this.db, known.id, false); changed = true }
                continue
            }

            if (!this.stability.observe(path, snap, now)) continue
            if (!(await canOpenForRead(path))) continue // still locked by LMU

            try {
                changed = (await this.indexFile(path, snap.size, snap.mtimeMs, snap.hasWal)) || changed
                this.stability.forget(path)
            } catch (err) {
                this.lastError = `${name}: ${err instanceof Error ? err.message : String(err)}`
            }
        }
        this.stability.retain(present)

        // Mark LMU sessions whose original vanished from this folder.
        for (const s of listSessionsInFolder(this.db, 'lmu')) {
            if (dirname(s.filePath) !== folder) continue
            const missing = !present.has(s.filePath)
            if (missing !== s.fileMissing) { setFileMissing(this.db, s.id, missing); changed = true }
        }

        this.lastScanAt = new Date().toISOString()
        if (changed) this.events.sessionsChanged()
        if (changed || pendingBefore !== this.stability.size) this.events.statusChanged()
        this.schedulePendingPoll()
    }

    private schedulePendingPoll(): void {
        if (this.pendingTimer) clearTimeout(this.pendingTimer)
        this.pendingTimer = null
        if (this.stability.size > 0)
            this.pendingTimer = setTimeout(() => void this.scan(), PENDING_POLL_MS)
    }

    /** Returns true if the index changed. */
    private async indexFile(path: string, size: number, mtimeMs: number, hasWal: boolean): Promise<boolean> {
        const hash = await hashRecording(path, hasWal)
        const byHash = findSessionByHash(this.db, hash)
        const byPath = findSessionByPath(this.db, path)
        let id: number
        if (byPath && byPath.fileHash !== hash) {
            // The recording at this path changed (e.g. WAL grew or was checkpointed).
            if (byHash) {
                deleteSession(this.db, byPath.id) // content now equals another known session
                return true
            }
            updateSessionFile(this.db, byPath.id, hash, size, mtimeMs)
            id = byPath.id
        } else if (byHash) {
            if (byHash.filePath === path && !byHash.fileMissing) return false
            // Same content seen elsewhere: adopt the new location if the old one is gone.
            const oldGone = byHash.fileMissing || !(await exists(byHash.filePath))
            if (!oldGone) return false
            relocateSession(this.db, byHash.id, path, size, mtimeMs)
            id = byHash.id
        } else {
            id = insertSession(this.db, { filePath: path, fileHash: hash, fileSize: size, fileMtimeMs: mtimeMs, origin: 'lmu' })
        }
        if (this.archiveEnabled) await this.archive(id, path, hash)
        return true
    }

    /** Copies .duckdb (+ .wal) to <archiveDir>/<hash>.duckdb[.wal]. */
    private async archive(id: number, source: string, hash: string): Promise<void> {
        const target = join(this.archiveDir, `${hash}.duckdb`)
        if (!(await exists(target))) {
            await mkdir(this.archiveDir, { recursive: true })
            const pairs: [string, string][] = [[source, target]]
            if (await exists(walPath(source))) pairs.unshift([walPath(source), walPath(target)])
            // WAL first, main file last: the main file's presence marks a complete archive.
            for (const [from, to] of pairs) await copyAtomic(from, to)
        }
        setArchivedPath(this.db, id, target)
    }

    private async archiveAll(): Promise<void> {
        let changed = false
        for (const s of listSessionsInFolder(this.db, 'lmu')) {
            if (s.archivedPath || s.fileMissing) continue
            try {
                await this.archive(s.id, s.filePath, s.fileHash)
                changed = true
            } catch (err) {
                this.lastError = `Archive ${s.fileName}: ${err instanceof Error ? err.message : String(err)}`
            }
        }
        if (changed) this.events.sessionsChanged()
    }
}

async function exists(path: string): Promise<boolean> {
    try { await stat(path); return true } catch { return false }
}

async function copyAtomic(from: string, to: string): Promise<void> {
    const tmp = `${to}.tmp`
    try {
        await copyFile(from, tmp)
        await rename(tmp, to)
    } catch (err) {
        await unlink(tmp).catch(() => {})
        throw err
    }
}

async function canOpenForRead(path: string): Promise<boolean> {
    try {
        const fh = await open(path, 'r')
        await fh.close()
        return true
    } catch {
        return false
    }
}
