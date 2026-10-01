/**
 * Worker-side application state: index database, folder resolution and the
 * indexer. Exposes the operations behind the worker RPC methods.
 */
import { mkdirSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportResult } from '../shared/package'
import type { FolderCandidate, IndexStatus, LapRow, ReferenceLap, SessionRow, TelemetryFolderSetting } from '../shared/types'
import type { WorkerEventName } from '../shared/worker-protocol'
import {
    countSessions,
    deleteSession,
    findSessionByHash,
    getLap,
    getReferenceForSession,
    getSession,
    getSessionManifest,
    getTraceCache,
    getSessionNote,
    insertSession,
    listAllTags,
    putTraceCache,
    refreshAutoReference,
    setSessionManifest,
    setLapNote,
    setSessionNote,
    setSessionTags,
    getSetting,
    listLaps,
    listSessions,
    listSessionsToParse,
    openDb,
    saveParseError,
    saveParsedSession,
    setSetting,
    type Db,
} from './db'
import { Indexer } from './indexer/indexer'
import { describeFolder, findTelemetryFolders, getSteamRoots, pickBestCandidate } from './locate/telemetry-folder'
import { analyseLaps, STEP_M, type LapSource, type TraceCache } from './analysis-service'
import { TRACE_CACHE_VERSION } from './trace-cache'
import { hashRecording, statRecording, walPath } from './indexer/recording-file'
import { exportLap, exportSession, renumberFromManifest, unpackImport } from './packages'
import { EmptyRecordingError, READER_VERSION, readRecordingSession } from './telemetry/reader'

const KEY_FOLDER = 'telemetryFolder'
const KEY_ARCHIVE = 'archiveSessions'
const DEFAULT_FOLDER: TelemetryFolderSetting = { mode: 'auto', path: null }
const DETECT_INTERVAL_MS = 60_000

export class WorkerService {
    private readonly db: Db
    private readonly indexer: Indexer
    private candidates: FolderCandidate[] = []
    private detectTimer: NodeJS.Timeout | null = null
    private parsing: Promise<void> | null = null
    private parseAgain = false

    private readonly importDir: string

    constructor(userDataDir: string, private readonly documentsDir: string | null, private readonly emit: (e: WorkerEventName) => void, private readonly appVersion = '0.0.0') {
        mkdirSync(userDataDir, { recursive: true })
        this.importDir = join(userDataDir, 'imports')
        this.db = openDb(join(userDataDir, 'index.sqlite'))
        this.indexer = new Indexer(this.db, join(userDataDir, 'archive'), {
            sessionsChanged: () => { emit('sessions-changed'); this.parsePending() },
            statusChanged: () => emit('status-changed'),
        })
        this.indexer.archiveEnabled = getSetting(this.db, KEY_ARCHIVE, false)
    }

    async start(): Promise<void> {
        this.parsePending()
        await this.applyFolderSetting()
        // In auto mode keep looking, e.g. LMU gets installed or records for the first time.
        this.detectTimer = setInterval(() => {
            if (this.folderSetting.mode === 'auto') void this.applyFolderSetting()
        }, DETECT_INTERVAL_MS)
    }

    stop(): void {
        if (this.detectTimer) clearInterval(this.detectTimer)
        this.indexer.stop()
        this.db.close()
    }

    get folderSetting(): TelemetryFolderSetting {
        return getSetting(this.db, KEY_FOLDER, DEFAULT_FOLDER)
    }

    async setFolderSetting(setting: TelemetryFolderSetting): Promise<IndexStatus> {
        const clean: TelemetryFolderSetting = setting.mode === 'manual' && setting.path
            ? { mode: 'manual', path: setting.path }
            : DEFAULT_FOLDER
        setSetting(this.db, KEY_FOLDER, clean)
        await this.applyFolderSetting()
        return this.status()
    }

    async setArchive(enabled: boolean): Promise<IndexStatus> {
        setSetting(this.db, KEY_ARCHIVE, enabled)
        await this.indexer.setArchiveEnabled(enabled)
        return this.status()
    }

    async rescan(): Promise<IndexStatus> {
        await this.applyFolderSetting()
        await this.indexer.scan()
        return this.status()
    }

    listSessions() {
        return listSessions(this.db)
    }

    getSessionDetail(id: number): { session: SessionRow; laps: LapRow[]; reference: ReferenceLap | null; note: string; allTags: string[] } {
        const session = getSession(this.db, id)
        if (!session) throw new Error('Session not found')
        return {
            session,
            laps: listLaps(this.db, id),
            reference: getReferenceForSession(this.db, id),
            note: getSessionNote(this.db, id),
            allTags: listAllTags(this.db),
        }
    }

    setNote(sessionId: number, body: string): void {
        if (!getSession(this.db, sessionId)) throw new Error('Session not found')
        setSessionNote(this.db, sessionId, String(body).slice(0, 20_000))
    }

    setLapNote(lapId: number, body: string): void {
        if (!setLapNote(this.db, lapId, String(body).slice(0, 2_000))) throw new Error('Lap not found')
    }

    setTags(sessionId: number, tags: string[]): void {
        if (!getSession(this.db, sessionId)) throw new Error('Session not found')
        setSessionTags(this.db, sessionId, tags.map(String))
        this.emit('sessions-changed')
    }

    private requireRecording(sessionId: number): { session: SessionRow; path: string } {
        const session = getSession(this.db, sessionId)
        if (!session) throw new Error('Session not found')
        const path = this.recordingPath(session)
        if (!path) throw new Error('Recording file is no longer available')
        return { session, path }
    }

    async exportSession(sessionId: number, target: string): Promise<void> {
        const { session, path } = this.requireRecording(sessionId)
        await exportSession(path, session, listLaps(this.db, sessionId), this.appVersion, target)
    }

    async exportLap(lapId: number, target: string): Promise<void> {
        const lap = getLap(this.db, lapId)
        if (!lap) throw new Error('Lap not found')
        const { session, path } = this.requireRecording(lap.sessionId)
        await exportLap(path, session, lap, this.appVersion, target)
    }

    /**
     * Files belonging to a session. `lmuFiles` are LMU's own recordings (moved to the
     * Recycle Bin by the main process); `appFiles` are copies owned by the app.
     */
    async sessionFiles(sessionId: number): Promise<{ lmuFiles: string[]; appFiles: string[] }> {
        const s = getSession(this.db, sessionId)
        if (!s) throw new Error('Session not found')
        const present = async (p: string) => {
            const snap = await statRecording(p)
            return snap ? (snap.hasWal ? [p, walPath(p)] : [p]) : []
        }
        const lmuFiles = s.origin === 'lmu' && !s.fileMissing ? await present(s.filePath) : []
        const appFiles = [
            ...(s.origin === 'import' ? await present(s.filePath) : []),
            ...(s.archivedPath ? await present(s.archivedPath) : []),
        ]
        return { lmuFiles, appFiles }
    }

    /** Removes a session from the index and deletes the app's own copies. LMU's files are handled by the caller. */
    async removeSession(sessionId: number): Promise<void> {
        const s = getSession(this.db, sessionId)
        if (!s) return
        const { appFiles } = await this.sessionFiles(sessionId)
        for (const f of appFiles) await rm(f, { force: true })
        deleteSession(this.db, sessionId)
        const track = s.trackLayout ?? s.track
        if (track && s.car) refreshAutoReference(this.db, track, s.car)
        this.emit('sessions-changed')
        this.emit('status-changed')
    }

    /** Imports .rses / .rlap / .duckdb files into the app's data folder and indexes them. */
    async importFiles(files: string[]): Promise<ImportResult & { sessionIds: number[] }> {
        const result: ImportResult & { sessionIds: number[] } = { imported: 0, duplicates: 0, errors: [], sessionIds: [] }
        for (const file of files) {
            let unpacked: string | null = null
            try {
                const pkg = await unpackImport(file, this.importDir)
                unpacked = pkg.path
                const snap = await statRecording(unpacked)
                if (!snap) throw new Error('Package contains no readable recording')
                const hash = await hashRecording(unpacked, snap.hasWal)
                const existing = findSessionByHash(this.db, hash)
                if (existing && !(existing.fileMissing && !existing.archivedPath)) {
                    result.duplicates++
                    result.sessionIds.push(existing.id)
                    await rm(unpacked, { force: true })
                    await rm(walPath(unpacked), { force: true })
                    continue
                }
                if (existing) deleteSession(this.db, existing.id) // original gone and not archived: replace by the import
                const final = join(this.importDir, `${hash}.duckdb`)
                await rename(unpacked, final)
                if (snap.hasWal) await rename(walPath(unpacked), walPath(final))
                unpacked = null
                const id = insertSession(this.db, { filePath: final, fileHash: hash, fileSize: snap.size, fileMtimeMs: snap.mtimeMs, origin: 'import' })
                if (pkg.manifest) setSessionManifest(this.db, id, JSON.stringify(pkg.manifest))
                result.imported++
                result.sessionIds.push(id)
            } catch (err) {
                result.errors.push({ file, error: err instanceof Error ? err.message : String(err) })
                if (unpacked) {
                    await rm(unpacked, { force: true })
                    await rm(walPath(unpacked), { force: true })
                }
            }
        }
        if (result.imported) {
            this.emit('sessions-changed')
            this.parsePending()
        }
        return result
    }

    async analyse(lapIds: number[], referenceLapId: number | null, extraChannels: string[] = []) {
        const ids = [...new Set(lapIds.map(Number))].slice(0, 5)
        const sources: LapSource[] = ids.map(id => {
            const lap = getLap(this.db, id)
            if (!lap) throw new Error(`Lap ${id} not found`)
            const session = getSession(this.db, lap.sessionId)!
            const path = this.recordingPath(session)
            if (!path) throw new Error('Recording file is no longer available')
            return { lap, session, path }
        })
        const cache: TraceCache = {
            get: lapId => getTraceCache(this.db, lapId, TRACE_CACHE_VERSION),
            put: (lapId, data) => putTraceCache(this.db, lapId, TRACE_CACHE_VERSION, STEP_M, data),
        }
        return analyseLaps(sources, referenceLapId ?? ids[0]!, extraChannels.map(String).slice(0, 8), cache)
    }

    /** Readable location of a session's recording (original, else archived copy). */
    recordingPath(s: SessionRow): string | null {
        if (!s.fileMissing) return s.filePath
        return s.archivedPath
    }

    /** Runs the telemetry reader over every session that needs it; calls coalesce. */
    parsePending(): void {
        if (this.parsing) { this.parseAgain = true; return }
        this.parsing = (async () => {
            do {
                this.parseAgain = false
                for (const s of listSessionsToParse(this.db, READER_VERSION)) {
                    const path = this.recordingPath(s)
                    if (!path) continue
                    try {
                        const r = await readRecordingSession(path)
                        saveParsedSession(this.db, s.id, { ...r, laps: renumberFromManifest(r.laps, getSessionManifest(this.db, s.id)) }, READER_VERSION)
                    } catch (err) {
                        const msg = err instanceof EmptyRecordingError ? err.message : `Could not read recording: ${err instanceof Error ? err.message : String(err)}`
                        saveParseError(this.db, s.id, msg, READER_VERSION)
                    }
                    this.emit('sessions-changed')
                }
            } while (this.parseAgain)
        })().finally(() => { this.parsing = null })
    }

    status(): IndexStatus {
        return {
            folderSetting: this.folderSetting,
            activeFolder: this.indexer.activeFolder,
            activeFolderExists: this.indexer.activeFolder !== null && this.indexer.folderExists,
            candidates: this.candidates,
            pendingFiles: this.indexer.pendingFiles,
            sessionCount: countSessions(this.db),
            archiveSessions: this.indexer.archiveEnabled,
            lastScanAt: this.indexer.lastScanAt,
            lastError: this.indexer.lastError,
        }
    }

    private async applyFolderSetting(): Promise<void> {
        this.candidates = await findTelemetryFolders({ steamRoots: await getSteamRoots(), documentsDir: this.documentsDir })
        const setting = this.folderSetting
        if (setting.mode === 'manual' && setting.path) {
            const manual = await describeFolder(setting.path, 'manual')
            if (!this.candidates.some(c => c.path === manual.path)) this.candidates = [manual, ...this.candidates]
            this.indexer.setFolder(setting.path)
        } else {
            this.indexer.setFolder(pickBestCandidate(this.candidates)?.path ?? null)
        }
    }
}

