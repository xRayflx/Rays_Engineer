/**
 * Reads LMU telemetry recordings (.duckdb + optional .wal) — the single reader
 * for files from LMU's folder, the archive and imported .rses/.rlap packages.
 * Schema and time model: docs/SCHEMA.md.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { LapConditions } from '../../shared/analysis'
import type { LapTrace, Wheels } from '../analysis/lap-trace'
import { parseRecordingTime } from '../../shared/format'
import { segmentLaps, type Event, type LapSegment } from './segments'

export const READER_VERSION = 1

export interface ChannelInfo {
    name: string
    frequency: number
    unit: string
    rows: number
    /** value1…value4 (one per wheel) instead of a single value column. */
    wheels: boolean
}

export interface RecordingSession {
    meta: Record<string, string>
    track: string | null
    trackLayout: string | null
    car: string | null
    carClass: string | null
    driver: string | null
    sessionType: string | null
    /** ISO 8601 (from metadata RecordingTime). */
    recordedAt: string | null
    weather: string | null
    setupJson: string | null
    t0: number
    tEnd: number
    trackLengthM: number | null
    channels: ChannelInfo[]
    laps: LapSegment[]
}

export class EmptyRecordingError extends Error {
    constructor() { super('Recording contains no telemetry') }
}

const q = (ident: string) => `"${ident.replaceAll('"', '""')}"`

/** Opens a recording read-only. With a WAL present, both files are copied to a temp dir so the originals are never touched. */
export async function withRecording<T>(path: string, fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    let hasWal = false
    try { hasWal = (await stat(`${path}.wal`)).isFile() } catch { /* no WAL */ }

    let dir: string | null = null
    let openPath = path
    if (hasWal) {
        dir = await mkdtemp(join(tmpdir(), 'rays-rec-'))
        openPath = join(dir, basename(path))
        await copyFile(path, openPath)
        await copyFile(`${path}.wal`, `${openPath}.wal`)
    }
    // A copy with WAL must be opened writable so DuckDB can replay the log.
    const instance = await DuckDBInstance.create(openPath, hasWal ? {} : { access_mode: 'READ_ONLY' })
    const conn = await instance.connect()
    try {
        return await fn(conn)
    } finally {
        conn.closeSync()
        instance.closeSync()
        if (dir) await rm(dir, { recursive: true, force: true })
    }
}

async function rows(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
    return (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[]
}

async function tableNames(conn: DuckDBConnection): Promise<Set<string>> {
    const r = await rows(conn, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`)
    return new Set(r.map(x => String(x['table_name'])))
}

async function readEvents(conn: DuckDBConnection, tables: Set<string>, name: string, column = 'value'): Promise<Event[]> {
    if (!tables.has(name)) return []
    const r = await rows(conn, `SELECT ts, ${q(column)} AS v FROM ${q(name)} ORDER BY ts, rowid`)
    return r.map(x => ({ ts: Number(x['ts']), value: Number(x['v']) }))
}

export async function readRecordingSession(path: string): Promise<RecordingSession> {
    return withRecording(path, async conn => {
        const tables = await tableNames(conn)
        if (!tables.has('metadata') || !tables.has('channelsList')) throw new EmptyRecordingError()

        const meta: Record<string, string> = {}
        for (const r of await rows(conn, 'SELECT key, value FROM metadata')) meta[String(r['key'])] = String(r['value'] ?? '')

        const wheelTables = new Set((await rows(conn,
            `SELECT table_name FROM information_schema.columns WHERE table_schema = 'main' AND column_name = 'value1'`,
        )).map(r => String(r['table_name'])))
        const channels: ChannelInfo[] = []
        for (const r of await rows(conn, 'SELECT channelName, frequency, unit FROM channelsList')) {
            const name = String(r['channelName'])
            if (!tables.has(name)) continue
            const n = Number((await rows(conn, `SELECT COUNT(*) AS n FROM ${q(name)}`))[0]?.['n'] ?? 0)
            channels.push({ name, frequency: Number(r['frequency']), unit: String(r['unit'] ?? ''), rows: n, wheels: wheelTables.has(name) })
        }

        const t0 = await recordingStart(conn, tables)
        const tEnd = channels.reduce((m, c) => (c.rows > 0 && c.frequency > 0 ? Math.max(m, t0 + (c.rows - 1) / c.frequency) : m), t0)

        const laps = segmentLaps({
            t0,
            tEnd,
            currentSector: await readEvents(conn, tables, 'Current Sector'),
            lapTime: await readEvents(conn, tables, 'Lap Time'),
            lastSector1: await readEvents(conn, tables, 'Last Sector1'),
            lastSector2: await readEvents(conn, tables, 'Last Sector2'),
            inPits: await readEvents(conn, tables, 'In Pits'),
        })

        let trackLengthM: number | null = null
        if (tables.has('Lap Dist')) {
            const v = (await rows(conn, `SELECT MAX(value) AS m FROM "Lap Dist"`))[0]?.['m']
            trackLengthM = typeof v === 'number' && v > 100 ? v : null
        }

        const nonEmpty = (k: string) => (meta[k] ? meta[k] : null)
        return {
            meta,
            track: nonEmpty('TrackName'),
            trackLayout: nonEmpty('TrackLayout') ?? nonEmpty('TrackName'),
            car: nonEmpty('CarName'),
            carClass: nonEmpty('CarClass'),
            driver: nonEmpty('DriverName'),
            sessionType: nonEmpty('SessionType'),
            recordedAt: parseRecordingTime(meta['RecordingTime']),
            weather: nonEmpty('WeatherConditions'),
            setupJson: nonEmpty('CarSetup'),
            t0,
            tEnd,
            trackLengthM,
            channels,
            laps,
        }
    })
}

/** Recording start on the session clock: first "GPS Time" value, else the earliest event. */
async function recordingStart(conn: DuckDBConnection, tables: Set<string>): Promise<number> {
    if (tables.has('GPS Time')) {
        const v = (await rows(conn, `SELECT value FROM "GPS Time" ORDER BY rowid LIMIT 1`))[0]?.['value']
        if (typeof v === 'number') return v
    }
    for (const e of ['Current Sector', 'Lap', 'Gear']) {
        if (!tables.has(e)) continue
        const v = (await rows(conn, `SELECT MIN(ts) AS m FROM ${q(e)}`))[0]?.['m']
        if (typeof v === 'number') return v
    }
    throw new EmptyRecordingError()
}

// ── Lap traces ───────────────────────────────────────────────────────────────

export interface LapWindow {
    startTs: number
    endTs: number
}

interface ChannelRead {
    name: string
    frequency: number
    firstRow: number
    columns: Float64Array[]
}

async function readChannelWindow(conn: DuckDBConnection, ch: ChannelInfo, t0: number, from: number, to: number, cols: string[]): Promise<ChannelRead> {
    const first = Math.max(0, Math.floor((from - t0) * ch.frequency) - 1)
    const last = Math.min(ch.rows - 1, Math.ceil((to - t0) * ch.frequency) + 1)
    const sel = cols.map(c => q(c)).join(', ')
    const reader = await conn.runAndReadAll(`SELECT ${sel} FROM ${q(ch.name)} WHERE rowid BETWEEN ${first} AND ${last} ORDER BY rowid`)
    const columns = cols.map((_, ci) => Float64Array.from(reader.getColumns()[ci] ?? [], v => (v === null ? NaN : Number(v))))
    return { name: ch.name, frequency: ch.frequency, firstRow: first, columns }
}

/** Linear interpolation of a channel column at time t. */
function sampleChannel(ch: ChannelRead, col: number, t0: number, t: number): number {
    const data = ch.columns[col]!
    const pos = (t - t0) * ch.frequency - ch.firstRow
    if (data.length === 0) return 0
    if (pos <= 0) return data[0]!
    if (pos >= data.length - 1) return data[data.length - 1]!
    const i = Math.floor(pos)
    const f = pos - i
    return data[i]! + (data[i + 1]! - data[i]!) * f
}

/**
 * Lap Dist resets to 0 at the finish line. Makes the raw samples continuous
 * (adding L after each reset) and shifts them so the lap start is ≈ 0 — before
 * interpolating, so no values are blended across the reset.
 * `startPos` is the fractional sample position of the lap start.
 */
export function unwrapLapDistance(d: Float64Array, L: number, startPos: number): void {
    let offset = 0
    for (let i = 1; i < d.length; i++) {
        const prev = d[i - 1]! - offset
        if (d[i]! - prev < -L / 2) offset += L
        d[i]! += offset
    }
    const k = Math.min(d.length - 1, Math.max(0, Math.round(startPos)))
    const shift = L * Math.round(d[k]! / L)
    for (let i = 0; i < d.length; i++) d[i]! -= shift
}

/** Every gear change passes through 0 for ~43 ms (docs/SCHEMA.md); keep the previous gear across such blips. */
const SHIFT_NEUTRAL_MAX_S = 0.2
export function withoutShiftNeutral(gear: Event[]): Event[] {
    return gear.filter((e, i) => !(e.value === 0 && i > 0 && i + 1 < gear.length && gear[i + 1]!.ts - e.ts < SHIFT_NEUTRAL_MAX_S))
}

function stepEvents(events: Event[], times: Float64Array, fallback = 0): Float32Array {
    const out = new Float32Array(times.length)
    let j = 0
    let v = fallback
    for (let k = 0; k < times.length; k++) {
        while (j < events.length && events[j]!.ts <= times[k]!) v = events[j++]!.value
        out[k] = v
    }
    return out
}

/**
 * Lap telemetry resampled to a uniform `hz` timeline from window start to end.
 * Lap distance is unwrapped across the finish line so it increases through the lap.
 */
export async function readLapTrace(path: string, session: Pick<RecordingSession, 't0' | 'channels' | 'track' | 'trackLengthM'>, lap: LapWindow, hz = 10): Promise<LapTrace> {
    return withRecording(path, async conn => {
        const tables = await tableNames(conn)
        const byName = new Map(session.channels.map(c => [c.name, c]))
        const n = Math.max(2, Math.ceil((lap.endTs - lap.startTs) * hz) + 1)
        const times = Float64Array.from({ length: n }, (_, k) => Math.min(lap.startTs + k / hz, lap.endTs))

        const scalar = async (name: string, scale = 1): Promise<Float32Array | undefined> => {
            const ch = byName.get(name)
            if (!ch || ch.rows === 0) return undefined
            const r = await readChannelWindow(conn, ch, session.t0, lap.startTs, lap.endTs, ['value'])
            return Float32Array.from(times, t => sampleChannel(r, 0, session.t0, t) * scale)
        }
        const wheels = async (name: string): Promise<Wheels | undefined> => {
            const ch = byName.get(name)
            if (!ch || ch.rows === 0) return undefined
            const r = await readChannelWindow(conn, ch, session.t0, lap.startTs, lap.endTs, ['value1', 'value2', 'value3', 'value4'])
            return [0, 1, 2, 3].map(c => Float32Array.from(times, t => sampleChannel(r, c, session.t0, t))) as unknown as Wheels
        }

        const zeros = () => new Float32Array(n)
        const L = session.trackLengthM
        let distM: Float32Array | undefined
        const lapDist = byName.get('Lap Dist')
        if (lapDist && lapDist.rows > 0) {
            const raw = await readChannelWindow(conn, lapDist, session.t0, lap.startTs, lap.endTs, ['value'])
            if (L) unwrapLapDistance(raw.columns[0]!, L, (lap.startTs - session.t0) * lapDist.frequency - raw.firstRow)
            distM = Float32Array.from(times, t => sampleChannel(raw, 0, session.t0, t))
        }
        const norPos = distM && L ? Float32Array.from(distM, d => Math.min(1, Math.max(0, d / L))) : Float32Array.from(times, t => (t - lap.startTs) / (lap.endTs - lap.startTs))

        const gear = tables.has('Gear')
            ? stepEvents(withoutShiftNeutral(await readEvents(conn, tables, 'Gear')), times)
            : undefined

        return {
            track: session.track ?? '',
            count: n,
            timeMs: Float64Array.from(times, t => (t - lap.startTs) * 1000),
            norPos,
            distM,
            speed: (await scalar('Ground Speed')) ?? zeros(),
            throttle: (await scalar('Throttle Pos', 0.01)) ?? zeros(),
            brake: (await scalar('Brake Pos', 0.01)) ?? zeros(),
            steer: (await scalar('Steering Pos')) ?? zeros(),
            gear,
            rpm: await scalar('Engine RPM'),
            // LMU's channel names are swapped (docs/SCHEMA.md): "G Force Lat" is longitudinal,
            // "G Force Long" is lateral. Normalised here: gLat > 0 = right-hand corner, gLon > 0 = braking.
            gLon: await scalar('G Force Lat'),
            gLat: await scalar('G Force Long', -1),
            gVert: await scalar('G Force Vert'),
            gpsLat: await scalar('GPS Latitude'),
            gpsLon: await scalar('GPS Longitude'),
            wheelSpeed: await wheels('Wheel Speed'),
        }
    })
}

/** Any continuous channel on the same uniform timeline as readLapTrace (1 or 4 arrays). */
export async function readChannelTraces(path: string, session: Pick<RecordingSession, 't0' | 'channels'>, lap: LapWindow, hz: number, names: string[]): Promise<Map<string, Float32Array[]>> {
    return withRecording(path, async conn => {
        const byName = new Map(session.channels.map(c => [c.name, c]))
        const n = Math.max(2, Math.ceil((lap.endTs - lap.startTs) * hz) + 1)
        const times = Float64Array.from({ length: n }, (_, k) => Math.min(lap.startTs + k / hz, lap.endTs))
        const out = new Map<string, Float32Array[]>()
        for (const name of names) {
            const ch = byName.get(name)
            if (!ch || ch.rows === 0) continue
            const cols = ch.wheels ? ['value1', 'value2', 'value3', 'value4'] : ['value']
            const r = await readChannelWindow(conn, ch, session.t0, lap.startTs, lap.endTs, cols)
            out.set(name, cols.map((_, c) => Float32Array.from(times, t => sampleChannel(r, c, session.t0, t))))
        }
        return out
    })
}

// ── Conditions ───────────────────────────────────────────────────────────────

/** "HH:MM:SS" + seconds → "HH:MM" (wraps at midnight); null for anything else. */
export function addTimeOfDay(hms: string | undefined, seconds: number): string | null {
    const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(hms ?? '')
    if (!m) return null
    const day = 24 * 3600
    const t = (((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Math.floor(seconds)) % day) + day) % day
    return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`
}

/**
 * Weather, temperatures, wetness and in-game time of day of one lap.
 * Metadata "SessionTime" is the in-game clock at the recording start (t0), see docs/SCHEMA.md.
 */
export async function readLapConditions(path: string, session: Pick<RecordingSession, 'meta' | 't0' | 'channels' | 'weather'>, lap: LapWindow): Promise<LapConditions> {
    return withRecording(path, async conn => {
        const tables = await tableNames(conn)
        const byName = new Map(session.channels.map(c => [c.name, c]))
        const mean = async (name: string): Promise<number | null> => {
            const ch = byName.get(name)
            if (!ch || ch.rows === 0) return null
            const v = (await readChannelWindow(conn, ch, session.t0, lap.startTs, lap.endTs, ['value'])).columns[0]!.filter(x => Number.isFinite(x))
            return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
        }
        // Events hold the state from their ts on: the one in effect at the start plus every change during the lap.
        const wet = (await readEvents(conn, tables, 'Minimum Path Wetness')).filter((e, i, all) =>
            e.ts <= lap.endTs && (e.ts >= lap.startTs || (all[i + 1]?.ts ?? Infinity) > lap.startTs))
        const wind = await mean('Wind Speed')
        return {
            timeOfDay: addTimeOfDay(session.meta['SessionTime'], lap.startTs - session.t0),
            weather: session.weather,
            trackTempC: await mean('Track Temperature'),
            airTempC: await mean('Ambient Temperature'),
            wetnessPct: wet.length ? Math.max(...wet.map(e => e.value)) : null,
            windKmh: wind === null ? null : wind * 3.6,
        }
    })
}
