import Database from 'better-sqlite3'
import { basename } from 'node:path'
import type { LapRow, ReferenceLap, SessionOrigin, SessionRow, SessionStatus } from '../../shared/types'
import { MIGRATIONS } from './schema'

export type Db = Database.Database

export function openDb(file: string): Db {
    const db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    migrate(db)
    return db
}

function migrate(db: Db): void {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current > MIGRATIONS.length)
        throw new Error(`Index database is newer (v${current}) than this app (v${MIGRATIONS.length})`)
    for (let v = current; v < MIGRATIONS.length; v++) {
        db.transaction(() => {
            db.exec(MIGRATIONS[v]!)
            db.pragma(`user_version = ${v + 1}`)
        })()
    }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSetting<T>(db: Db, key: string, fallback: T): T {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    try { return JSON.parse(row.value) as T } catch { return fallback }
}

export function setSetting(db: Db, key: string, value: unknown): void {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value))
}

// ── Sessions ─────────────────────────────────────────────────────────────────

interface SessionDbRow {
    id: number
    file_path: string
    file_hash: string
    file_size: number
    file_mtime_ms: number
    origin: SessionOrigin
    archived_path: string | null
    file_missing: number
    status: SessionStatus
    error: string | null
    track: string | null
    track_layout: string | null
    car: string | null
    car_class: string | null
    driver: string | null
    session_type: string | null
    weather: string | null
    recorded_at: string | null
    track_length_m: number | null
    lap_count: number | null
    best_lap_ms: number | null
    indexed_at: string
    manifest_json?: string | null
    tags?: string | null
    note?: string | null
    lap_note_count?: number
}

function packageFormat(manifestJson: string | null | undefined): SessionRow['packageFormat'] {
    if (!manifestJson) return null
    try {
        const f = (JSON.parse(manifestJson) as { format?: unknown }).format
        return f === 'rses' || f === 'rlap' ? f : null
    } catch {
        return null
    }
}

function toSessionRow(r: SessionDbRow): SessionRow {
    return {
        id: r.id,
        filePath: r.file_path,
        fileName: basename(r.file_path),
        fileHash: r.file_hash,
        fileSize: r.file_size,
        fileMtimeMs: r.file_mtime_ms,
        origin: r.origin,
        packageFormat: packageFormat(r.manifest_json),
        archivedPath: r.archived_path,
        fileMissing: r.file_missing !== 0,
        status: r.status,
        error: r.error,
        track: r.track,
        trackLayout: r.track_layout,
        car: r.car,
        carClass: r.car_class,
        driver: r.driver,
        sessionType: r.session_type,
        weather: r.weather,
        recordedAt: r.recorded_at,
        trackLengthM: r.track_length_m,
        lapCount: r.lap_count,
        bestLapMs: r.best_lap_ms,
        indexedAt: r.indexed_at,
        note: r.note ?? '',
        lapNoteCount: r.lap_note_count ?? 0,
        tags: r.tags ? r.tags.split('\u001f') : [],
    }
}

export function listSessions(db: Db): SessionRow[] {
    const rows = db.prepare(
        `SELECT s.*, (SELECT group_concat(t.name, char(31)) FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE st.session_id = s.id) AS tags,
                (SELECT n.body FROM notes n WHERE n.session_id = s.id AND n.lap_id IS NULL) AS note,
                (SELECT COUNT(*) FROM notes n WHERE n.session_id = s.id AND n.lap_id IS NOT NULL) AS lap_note_count
         FROM sessions s ORDER BY COALESCE(s.recorded_at, datetime(s.file_mtime_ms / 1000, 'unixepoch')) DESC, s.id DESC`,
    ).all() as SessionDbRow[]
    return rows.map(toSessionRow)
}

export function countSessions(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n
}

export function findSessionByPath(db: Db, filePath: string): SessionRow | null {
    const r = db.prepare('SELECT * FROM sessions WHERE file_path = ?').get(filePath) as SessionDbRow | undefined
    return r ? toSessionRow(r) : null
}

export function findSessionByHash(db: Db, hash: string): SessionRow | null {
    const r = db.prepare('SELECT * FROM sessions WHERE file_hash = ?').get(hash) as SessionDbRow | undefined
    return r ? toSessionRow(r) : null
}

export interface NewSessionFile {
    filePath: string
    fileHash: string
    fileSize: number
    fileMtimeMs: number
    origin: SessionOrigin
}

export function insertSession(db: Db, f: NewSessionFile): number {
    const res = db.prepare(
        `INSERT INTO sessions (file_path, file_hash, file_size, file_mtime_ms, origin)
         VALUES (@filePath, @fileHash, @fileSize, @fileMtimeMs, @origin)`,
    ).run(f)
    return Number(res.lastInsertRowid)
}

/** Points an existing session (same content hash) at a new location of its file. */
export function relocateSession(db: Db, id: number, filePath: string, fileSize: number, fileMtimeMs: number): void {
    db.prepare('UPDATE sessions SET file_path = ?, file_size = ?, file_mtime_ms = ?, file_missing = 0 WHERE id = ?')
        .run(filePath, fileSize, fileMtimeMs, id)
}

/** Content at a known path changed: new hash, back to unparsed so the reader runs again. */
export function updateSessionFile(db: Db, id: number, hash: string, fileSize: number, fileMtimeMs: number): void {
    db.prepare(
        `UPDATE sessions SET file_hash = ?, file_size = ?, file_mtime_ms = ?, file_missing = 0,
         status = 'unparsed', parser_version = 0, error = NULL WHERE id = ?`,
    ).run(hash, fileSize, fileMtimeMs, id)
}

export function deleteSession(db: Db, id: number): void {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function setFileMissing(db: Db, id: number, missing: boolean): void {
    db.prepare('UPDATE sessions SET file_missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
}

export function setArchivedPath(db: Db, id: number, archivedPath: string): void {
    db.prepare('UPDATE sessions SET archived_path = ? WHERE id = ?').run(archivedPath, id)
}

export function listSessionsInFolder(db: Db, origin: SessionOrigin): SessionRow[] {
    const rows = db.prepare('SELECT * FROM sessions WHERE origin = ?').all(origin) as SessionDbRow[]
    return rows.map(toSessionRow)
}

export function getSession(db: Db, id: number): SessionRow | null {
    const r = db.prepare(
        `SELECT s.*, (SELECT group_concat(t.name, char(31)) FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE st.session_id = s.id) AS tags
         FROM sessions s WHERE s.id = ?`,
    ).get(id) as SessionDbRow | undefined
    return r ? toSessionRow(r) : null
}

// ── Parsing results ──────────────────────────────────────────────────────────

/** Sessions the reader still has to process (new, failed with an older reader, or parsed by an older reader). */
export function listSessionsToParse(db: Db, readerVersion: number): SessionRow[] {
    const rows = db.prepare(
        `SELECT * FROM sessions WHERE parser_version < ? AND (file_missing = 0 OR archived_path IS NOT NULL) ORDER BY id`,
    ).all(readerVersion) as SessionDbRow[]
    return rows.map(toSessionRow)
}

export interface ParsedSession {
    track: string | null
    trackLayout: string | null
    car: string | null
    carClass: string | null
    driver: string | null
    sessionType: string | null
    weather: string | null
    recordedAt: string | null
    setupJson: string | null
    trackLengthM: number | null
    laps: {
        index: number
        kind: 'lap' | 'partial'
        startTs: number
        endTs: number
        lapTimeMs: number | null
        isValid: boolean
        sector1Ms: number | null
        sector2Ms: number | null
        sector3Ms: number | null
        inPits: boolean
    }[]
}

export function saveParsedSession(db: Db, id: number, p: ParsedSession, readerVersion: number): void {
    const complete = p.laps.filter(l => l.kind === 'lap')
    const valid = complete.filter(l => l.isValid && l.lapTimeMs !== null)
    const best = valid.length ? Math.min(...valid.map(l => l.lapTimeMs!)) : null
    db.transaction(() => {
        db.prepare(
            `UPDATE sessions SET track = @track, track_layout = @trackLayout, car = @car, car_class = @carClass,
             driver = @driver, session_type = @sessionType, weather = @weather, recorded_at = @recordedAt,
             setup_json = @setupJson, track_length_m = @trackLengthM, lap_count = @lapCount, best_lap_ms = @best,
             status = 'parsed', parser_version = @readerVersion, error = NULL WHERE id = @id`,
        ).run({ ...p, lapCount: complete.length, best, readerVersion, id })
        // Laps are rebuilt; their notes (deleted with them) are carried over by lap number.
        const lapNotes = db.prepare(
            `SELECT l.lap_number, n.body, n.created_at FROM notes n JOIN laps l ON l.id = n.lap_id WHERE n.session_id = ?`,
        ).all(id) as { lap_number: number; body: string; created_at: string }[]
        db.prepare('DELETE FROM laps WHERE session_id = ?').run(id)
        const ins = db.prepare(
            `INSERT INTO laps (session_id, lap_number, kind, lap_time_ms, sector1_ms, sector2_ms, sector3_ms, is_valid, in_pits, start_ts, end_ts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const l of p.laps)
            ins.run(id, l.index, l.kind, l.lapTimeMs, l.sector1Ms, l.sector2Ms, l.sector3Ms, l.isValid ? 1 : 0, l.inPits ? 1 : 0, l.startTs, l.endTs)
        const restore = db.prepare(
            `INSERT INTO notes (session_id, lap_id, body, created_at)
             SELECT ?, id, ?, ? FROM laps WHERE session_id = ? AND lap_number = ?`,
        )
        for (const n of lapNotes) restore.run(id, n.body, n.created_at, id, n.lap_number)
        const key = referenceKey(p.trackLayout ?? p.track, p.car)
        if (key) refreshAutoReference(db, key.track, key.car)
    })()
}

export function saveParseError(db: Db, id: number, message: string, readerVersion: number): void {
    db.prepare(`UPDATE sessions SET status = 'error', error = ?, parser_version = ? WHERE id = ?`).run(message, readerVersion, id)
}

// ── Laps ─────────────────────────────────────────────────────────────────────

interface LapDbRow {
    id: number
    session_id: number
    lap_number: number
    kind: 'lap' | 'partial'
    lap_time_ms: number | null
    sector1_ms: number | null
    sector2_ms: number | null
    sector3_ms: number | null
    is_valid: number
    in_pits: number
    start_ts: number
    end_ts: number
    is_reference: number
    note: string | null
}

export function listLaps(db: Db, sessionId: number): LapRow[] {
    const rows = db.prepare(
        `SELECT l.*, EXISTS (SELECT 1 FROM reference_laps r WHERE r.lap_id = l.id) AS is_reference,
                (SELECT n.body FROM notes n WHERE n.lap_id = l.id) AS note
         FROM laps l WHERE l.session_id = ? ORDER BY l.lap_number`,
    ).all(sessionId) as LapDbRow[]
    return rows.map(r => ({
        id: r.id,
        sessionId: r.session_id,
        lapNumber: r.lap_number,
        kind: r.kind,
        lapTimeMs: r.lap_time_ms,
        sector1Ms: r.sector1_ms,
        sector2Ms: r.sector2_ms,
        sector3Ms: r.sector3_ms,
        isValid: r.is_valid !== 0,
        inPits: r.in_pits !== 0,
        startTs: r.start_ts,
        endTs: r.end_ts,
        isReference: r.is_reference !== 0,
        note: r.note ?? '',
    }))
}

// ── Reference laps (best valid lap per track + car) ─────────────────────────

function referenceKey(track: string | null, car: string | null): { track: string; car: string } | null {
    return track && car ? { track, car } : null
}

/** Sets the reference to the fastest valid lap of the track + car. */
export function refreshAutoReference(db: Db, track: string, car: string): void {
    const best = db.prepare(
        `SELECT l.id FROM laps l JOIN sessions s ON s.id = l.session_id
         WHERE COALESCE(s.track_layout, s.track) = ? AND s.car = ? AND l.kind = 'lap' AND l.is_valid = 1 AND l.lap_time_ms IS NOT NULL
         ORDER BY l.lap_time_ms, l.id LIMIT 1`,
    ).get(track, car) as { id: number } | undefined
    if (!best) {
        db.prepare('DELETE FROM reference_laps WHERE track = ? AND car = ?').run(track, car)
        return
    }
    db.prepare(
        `INSERT INTO reference_laps (track, car, lap_id, is_manual, updated_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(track, car) DO UPDATE SET lap_id = excluded.lap_id, is_manual = 0, updated_at = excluded.updated_at`,
    ).run(track, car, best.id)
}

export function getReferenceForSession(db: Db, sessionId: number): ReferenceLap | null {
    const r = db.prepare(
        `SELECT r.track, r.car, r.lap_id, l.lap_time_ms, l.session_id
         FROM sessions s JOIN reference_laps r ON r.track = COALESCE(s.track_layout, s.track) AND r.car = s.car
         JOIN laps l ON l.id = r.lap_id WHERE s.id = ?`,
    ).get(sessionId) as { track: string; car: string; lap_id: number; lap_time_ms: number | null; session_id: number } | undefined
    return r ? { track: r.track, car: r.car, lapId: r.lap_id, lapTimeMs: r.lap_time_ms, sessionId: r.session_id } : null
}

export function getLap(db: Db, lapId: number): LapRow | null {
    const r = db.prepare(
        `SELECT l.*, EXISTS (SELECT 1 FROM reference_laps r WHERE r.lap_id = l.id) AS is_reference FROM laps l WHERE l.id = ?`,
    ).get(lapId) as LapDbRow | undefined
    if (!r) return null
    return listLaps(db, r.session_id).find(l => l.id === lapId) ?? null
}

// ── Notes & tags ─────────────────────────────────────────────────────────────

/** One free-text note per session (lap_id NULL). */
export function getSessionNote(db: Db, sessionId: number): string {
    const r = db.prepare('SELECT body FROM notes WHERE session_id = ? AND lap_id IS NULL').get(sessionId) as { body: string } | undefined
    return r?.body ?? ''
}

export function setSessionNote(db: Db, sessionId: number, body: string): void {
    db.transaction(() => {
        const existing = db.prepare('SELECT id FROM notes WHERE session_id = ? AND lap_id IS NULL').get(sessionId) as { id: number } | undefined
        if (!body.trim()) {
            if (existing) db.prepare('DELETE FROM notes WHERE id = ?').run(existing.id)
        } else if (existing) {
            db.prepare(`UPDATE notes SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(body, existing.id)
        } else {
            db.prepare('INSERT INTO notes (session_id, lap_id, body) VALUES (?, NULL, ?)').run(sessionId, body)
        }
    })()
}

/** One free-text note per lap; an empty body removes it. Returns false if the lap does not exist. */
export function setLapNote(db: Db, lapId: number, body: string): boolean {
    return db.transaction(() => {
        const lap = db.prepare('SELECT session_id FROM laps WHERE id = ?').get(lapId) as { session_id: number } | undefined
        if (!lap) return false
        const existing = db.prepare('SELECT id FROM notes WHERE lap_id = ?').get(lapId) as { id: number } | undefined
        if (!body.trim()) {
            if (existing) db.prepare('DELETE FROM notes WHERE id = ?').run(existing.id)
        } else if (existing) {
            db.prepare(`UPDATE notes SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(body, existing.id)
        } else {
            db.prepare('INSERT INTO notes (session_id, lap_id, body) VALUES (?, ?, ?)').run(lap.session_id, lapId, body)
        }
        return true
    })()
}

export function setSessionTags(db: Db, sessionId: number, tags: string[]): void {
    const clean = [...new Map(tags.map(t => t.trim()).filter(Boolean).map(t => [t.toLowerCase(), t.slice(0, 40)])).values()]
    db.transaction(() => {
        db.prepare('DELETE FROM session_tags WHERE session_id = ?').run(sessionId)
        for (const name of clean) {
            db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name)
            const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
            db.prepare('INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)').run(sessionId, tag.id)
        }
        db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM session_tags)').run()
    })()
}

export function listAllTags(db: Db): string[] {
    return (db.prepare('SELECT name FROM tags ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map(r => r.name)
}

export function setSessionManifest(db: Db, id: number, manifestJson: string): void {
    db.prepare('UPDATE sessions SET manifest_json = ? WHERE id = ?').run(manifestJson, id)
}

export function getSessionManifest(db: Db, id: number): string | null {
    const r = db.prepare('SELECT manifest_json FROM sessions WHERE id = ?').get(id) as { manifest_json: string | null } | undefined
    return r?.manifest_json ?? null
}

// ── Trace cache ──────────────────────────────────────────────────────────────
// Rows are tied to laps (ON DELETE CASCADE), so re-parsing or deleting a session clears them.

export function getTraceCache(db: Db, lapId: number, version: number): Uint8Array | null {
    const r = db.prepare('SELECT data FROM trace_cache WHERE lap_id = ? AND cache_version = ?').get(lapId, version) as { data: Buffer } | undefined
    return r ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) : null
}

export function putTraceCache(db: Db, lapId: number, version: number, stepM: number, data: Uint8Array): void {
    db.prepare(
        `INSERT INTO trace_cache (lap_id, cache_version, step_m, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(lap_id) DO UPDATE SET cache_version = excluded.cache_version, step_m = excluded.step_m,
         data = excluded.data, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run(lapId, version, stepM, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}
