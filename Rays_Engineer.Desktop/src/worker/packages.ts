/**
 * Export / import of .rses (session) and .rlap (lap) packages, see shared/package.ts.
 */
import { DuckDBInstance } from '@duckdb/node-api'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import {
    MANIFEST_FILE,
    PACKAGE_FORMAT_VERSION,
    RECORDING_FILE,
    validateManifest,
    WAL_FILE,
    type ManifestLap,
    type PackageFormat,
    type PackageManifest,
} from '../shared/package'
import type { LapRow, SessionRow } from '../shared/types'
import { walPath } from './indexer/recording-file'
import { readRecordingSession } from './telemetry/reader'

/** Block size of LMU's recordings (pragma_database_size on the samples). */
const LMU_BLOCK_SIZE = 16384

const q = (ident: string) => `"${ident.replaceAll('"', '""')}"`

async function exists(p: string): Promise<boolean> {
    try { await stat(p); return true } catch { return false }
}

function toManifestLap(l: LapRow): ManifestLap {
    return {
        lapNumber: l.lapNumber, lapTimeMs: l.lapTimeMs, isValid: l.isValid,
        sector1Ms: l.sector1Ms, sector2Ms: l.sector2Ms, sector3Ms: l.sector3Ms,
        startTs: l.startTs, endTs: l.endTs,
    }
}

function manifest(format: PackageFormat, appVersion: string, s: SessionRow, laps: LapRow[], hasWal: boolean): PackageManifest {
    return {
        format,
        formatVersion: PACKAGE_FORMAT_VERSION,
        appVersion,
        createdAt: new Date().toISOString(),
        track: s.track,
        trackLayout: s.trackLayout,
        car: s.car,
        carClass: s.carClass,
        sessionType: s.sessionType,
        recordedAt: s.recordedAt,
        laps: laps.map(toManifestLap),
        files: hasWal ? { recording: RECORDING_FILE, wal: WAL_FILE } : { recording: RECORDING_FILE },
    }
}

async function writeZip(target: string, entries: Zippable): Promise<void> {
    const tmp = `${target}.tmp`
    await writeFile(tmp, zipSync(entries, { level: 6 }))
    await rename(tmp, target)
}

function requireExtension(target: string, ext: string): void {
    if (extname(target).toLowerCase() !== ext) throw new Error(`Target must be a ${ext} file`)
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportSession(source: string, session: SessionRow, laps: LapRow[], appVersion: string, target: string): Promise<void> {
    requireExtension(target, '.rses')
    const hasWal = await exists(walPath(source))
    const entries: Zippable = {
        [MANIFEST_FILE]: strToU8(JSON.stringify(manifest('rses', appVersion, session, laps.filter(l => l.kind === 'lap'), hasWal), null, 2)),
        [RECORDING_FILE]: new Uint8Array(await readFile(source)),
    }
    if (hasWal) entries[WAL_FILE] = new Uint8Array(await readFile(walPath(source)))
    await writeZip(target, entries)
}

/**
 * Writes a recording that only contains the lap's time window, in LMU's schema.
 * The window starts a whole number of seconds after the recording start, so
 * every channel (integer frequencies) begins exactly at the same instant and
 * "t0 + rowid / frequency" stays valid. Event tables get a state row at the
 * window start, like LMU writes at recording start. Timestamps are unchanged.
 */
export async function writeLapRecording(source: string, lap: Pick<LapRow, 'startTs' | 'endTs'>, target: string): Promise<void> {
    const session = await readRecordingSession(source)
    const work = await mkdtemp(join(tmpdir(), 'rays-rlap-'))
    try {
        // With a WAL, attach a copy so DuckDB may replay it without touching the original.
        let attachPath = source
        let attachMode = ' (READ_ONLY)'
        if (await exists(walPath(source))) {
            attachPath = join(work, 'src.duckdb')
            await copyFile(source, attachPath)
            await copyFile(walPath(source), walPath(attachPath))
            attachMode = ''
        }
        const out = join(work, RECORDING_FILE)
        const lit = (p: string) => `'${p.replaceAll("'", "''")}'`
        const db = await DuckDBInstance.create(':memory:')
        const conn = await db.connect()
        try {
            await conn.run(`ATTACH ${lit(attachPath)} AS src${attachMode}`)
            // LMU writes 16 KB blocks; with DuckDB's default 256 KB every one of the ~100 tables would take ≥ 256 KB.
            await conn.run(`ATTACH ${lit(out)} AS dst (BLOCK_SIZE ${LMU_BLOCK_SIZE})`)
            const t0 = session.t0
            const T = t0 + Math.max(0, Math.floor(lap.startTs - t0 - 1e-6))
            const Tend = Math.min(t0 + Math.ceil(lap.endTs - t0) + 1, session.tEnd)
            const channels = new Map(session.channels.map(c => [c.name, c]))
            const events = new Set(
                (await conn.runAndReadAll(`SELECT eventName FROM src.eventsList`)).getRowObjectsJS().map(r => String(r['eventName'])),
            )
            const tables = (await conn.runAndReadAll(
                `SELECT table_name FROM information_schema.tables WHERE table_catalog = 'src' AND table_schema = 'main'`,
            )).getRowObjectsJS().map(r => String(r['table_name']))

            for (const name of tables) {
                const t = q(name)
                const ch = channels.get(name)
                if (ch) {
                    const a = Math.round((T - t0) * ch.frequency)
                    const b = Math.ceil((Tend - t0) * ch.frequency)
                    await conn.run(`CREATE TABLE dst.${t} AS SELECT * FROM src.${t} WHERE rowid BETWEEN ${a} AND ${b} ORDER BY rowid`)
                } else if (events.has(name)) {
                    await conn.run(`CREATE TABLE dst.${t} AS SELECT * FROM (
                        SELECT * REPLACE (${T}::DOUBLE AS ts) FROM (SELECT * FROM src.${t} WHERE ts <= ${T} ORDER BY ts DESC, rowid DESC LIMIT 1)
                        UNION ALL
                        SELECT * FROM src.${t} WHERE ts > ${T} AND ts <= ${Tend}
                    ) ORDER BY ts`)
                } else {
                    await conn.run(`CREATE TABLE dst.${t} AS SELECT * FROM src.${t}`) // metadata, channelsList, eventsList
                }
            }
            await conn.run('DETACH src')
            await conn.run('DETACH dst')
        } finally {
            conn.closeSync()
            db.closeSync()
        }
        await copyFile(out, target)
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}

export async function exportLap(source: string, session: SessionRow, lap: LapRow, appVersion: string, target: string): Promise<void> {
    requireExtension(target, '.rlap')
    if (lap.kind !== 'lap') throw new Error('Only complete laps can be exported')
    const work = await mkdtemp(join(tmpdir(), 'rays-rlap-out-'))
    try {
        const rec = join(work, RECORDING_FILE)
        await writeLapRecording(source, lap, rec)
        await writeZip(target, {
            [MANIFEST_FILE]: strToU8(JSON.stringify(manifest('rlap', appVersion, session, [lap], false), null, 2)),
            [RECORDING_FILE]: new Uint8Array(await readFile(rec)),
        })
    } finally {
        await rm(work, { recursive: true, force: true })
    }
}

// ── Import ───────────────────────────────────────────────────────────────────

export const IMPORT_EXTENSIONS = ['.rses', '.rlap', '.duckdb'] as const

/**
 * Extracts a package (or copies a plain .duckdb, with its WAL) to
 * `<dir>/<random>.duckdb[.wal]` and returns that path. The caller hashes,
 * deduplicates and indexes it.
 */
export async function unpackImport(file: string, dir: string): Promise<{ path: string; manifest: PackageManifest | null }> {
    const ext = extname(file).toLowerCase()
    if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`Unsupported file type: ${basename(file)}`)
    await mkdir(dir, { recursive: true })
    const target = join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.duckdb`)

    if (ext === '.duckdb') {
        await copyFile(file, target)
        if (await exists(walPath(file))) await copyFile(walPath(file), walPath(target))
        return { path: target, manifest: null }
    }

    const zip = unzipSync(new Uint8Array(await readFile(file)), {
        filter: f => f.name === MANIFEST_FILE || f.name === RECORDING_FILE || f.name === WAL_FILE,
    })
    const rawManifest = zip[MANIFEST_FILE]
    if (!rawManifest) throw new Error('Not a Rays Engineer package (manifest.json missing)')
    const m = validateManifest(JSON.parse(strFromU8(rawManifest)))
    if (m.format !== ext.slice(1)) throw new Error(`File extension does not match package format "${m.format}"`)
    const rec = zip[m.files.recording === RECORDING_FILE ? RECORDING_FILE : '']
    if (!rec) throw new Error('Package contains no recording')
    await writeFile(target, rec)
    if (m.files.wal && zip[WAL_FILE]) await writeFile(walPath(target), zip[WAL_FILE])
    return { path: target, manifest: m }
}

/**
 * An .rlap holds one lap cut out of a longer recording; restore the lap
 * number it had there (neighbouring partial segments get the numbers around it).
 */
export function renumberFromManifest<L extends { index: number; kind: string; startTs: number }>(laps: L[], manifestJson: string | null): L[] {
    if (!manifestJson) return laps
    let manifest: PackageManifest
    try { manifest = JSON.parse(manifestJson) as PackageManifest } catch { return laps }
    if (manifest.format !== 'rlap' || manifest.laps.length !== 1) return laps
    const exported = manifest.laps[0]!
    const k = laps.findIndex(l => l.kind === 'lap' && Math.abs(l.startTs - exported.startTs) < 0.01)
    if (k < 0) return laps
    return laps.map((l, i) => ({ ...l, index: exported.lapNumber + (i - k) }))
}
