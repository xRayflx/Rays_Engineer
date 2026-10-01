/**
 * Builds lap comparisons: reads lap traces, resamples them onto a shared
 * distance grid and derives delta time, track map and corners.
 */
import type { AnalysisResult, CornerInfo, LapAnalysis } from '../shared/analysis'
import type { LapRow, SessionRow } from '../shared/types'
import { detectCorners } from './analysis/corners'
import type { LapTrace } from './analysis/lap-trace'
import { resampleByDistance, timeDelta } from './analysis/resample'
import { decodeLapCore, encodeLapCore, type LapCore } from './trace-cache'
import { readChannelTraces, readLapConditions, readLapTrace, readRecordingSession, type RecordingSession } from './telemetry/reader'

export const STEP_M = 2
const TRACE_HZ = 50     // inputs are recorded at up to 50–100 Hz
const ANALYSIS_HZ = 10  // corner detection is tuned for 10 Hz
const CACHE_SIZE = 12

export interface LapSource {
    lap: LapRow
    session: SessionRow
    path: string
}

class Lru<V> {
    private readonly map = new Map<string, V>()
    constructor(private readonly size: number) {}
    async get(key: string, make: () => Promise<V>): Promise<V> {
        const hit = this.map.get(key)
        if (hit !== undefined) {
            this.map.delete(key)
            this.map.set(key, hit)
            return hit
        }
        const v = await make()
        this.map.set(key, v)
        while (this.map.size > this.size) this.map.delete(this.map.keys().next().value!)
        return v
    }
}

const sessions = new Lru<RecordingSession>(CACHE_SIZE)
const traces = new Lru<LapTrace>(CACHE_SIZE * 2)

function recording(src: LapSource): Promise<RecordingSession> {
    return sessions.get(`${src.path}#${src.session.fileHash}`, () => readRecordingSession(src.path))
}

function trace(src: LapSource, rec: RecordingSession, hz: number): Promise<LapTrace> {
    return traces.get(`${src.session.fileHash}#${src.lap.lapNumber}@${hz}`, () =>
        readLapTrace(src.path, rec, { startTs: src.lap.startTs, endTs: src.lap.endTs }, hz))
}

export interface TraceCache {
    get(lapId: number): Uint8Array | null
    put(lapId: number, data: Uint8Array): void
}

/** Distance-resampled core traces + corners of one lap, from the cache or freshly computed. */
async function lapCore(src: LapSource, cache: TraceCache | null): Promise<LapCore> {
    const hit = cache?.get(src.lap.id)
    const decoded = hit ? decodeLapCore(hit) : null
    if (decoded && decoded.stepM === STEP_M) return decoded

    const rec = await recording(src)
    const fine = await trace(src, rec, TRACE_HZ)
    const coarse = await trace(src, rec, ANALYSIS_HZ)
    const d = resampleByDistance(fine, STEP_M, [
        { name: 'gpsLat', data: fine.gpsLat ?? new Float32Array(fine.count) },
        { name: 'gpsLon', data: fine.gpsLon ?? new Float32Array(fine.count) },
    ])
    const core: LapCore = {
        stepM: STEP_M,
        n: d.distM.length,
        arrays: {
            timeMs: d.timeMs,
            speed: d.channels['speed']!,
            throttle: d.channels['throttle']!,
            brake: d.channels['brake']!,
            steer: d.channels['steer']!,
            gear: d.channels['gear'] ?? new Float32Array(d.distM.length),
            gpsLat: d.channels['gpsLat']!,
            gpsLon: d.channels['gpsLon']!,
        },
        corners: detectCorners(coarse),
        trackLengthM: rec.trackLengthM,
        channels: rec.channels
            .filter(c => c.rows > 0)
            .map(c => ({ name: c.name, unit: c.unit, wheels: c.wheels }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        conditions: await readLapConditions(src.path, rec, { startTs: src.lap.startTs, endTs: src.lap.endTs }),
    }
    try { cache?.put(src.lap.id, encodeLapCore(core)) } catch { /* cache is optional */ }
    return core
}

function mean(a: Float32Array): number {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i]!
    return a.length ? s / a.length : 0
}

export async function analyseLaps(sources: LapSource[], referenceLapId: number, extraChannels: string[] = [], cache: TraceCache | null = null): Promise<AnalysisResult> {
    if (sources.length === 0) throw new Error('No laps selected')
    const trackOf = (s: LapSource) => `${s.session.track ?? ''}${s.session.trackLayout ?? ''}`
    if (new Set(sources.map(trackOf)).size > 1) throw new Error('Laps are from different tracks or layouts')
    const ordered = [...sources].sort((a, b) => (a.lap.id === referenceLapId ? -1 : b.lap.id === referenceLapId ? 1 : 0))

    const cores: LapCore[] = []
    for (const src of ordered) {
        if (src.lap.kind !== 'lap') throw new Error(`Lap ${src.lap.lapNumber} is not a complete lap`)
        cores.push(await lapCore(src, cache))
    }

    // One cos(latitude) for every lap keeps the maps congruent.
    const cosLat = Math.cos(mean(cores[0]!.arrays.gpsLat) * (Math.PI / 180))
    const trackLengthM = cores[0]!.trackLengthM
    const refTime = { stepM: STEP_M, timeMs: cores[0]!.arrays.timeMs }

    const laps: LapAnalysis[] = []
    for (let i = 0; i < ordered.length; i++) {
        const src = ordered[i]!
        const c = cores[i]!
        const n = c.n
        const distM = Float32Array.from({ length: n }, (_, k) => k * STEP_M)

        // Extra channels are read on demand (not cached) and resampled onto the same grid.
        const extra: Record<string, Float32Array[]> = {}
        if (extraChannels.length) {
            const rec = await recording(src)
            const fine = await trace(src, rec, TRACE_HZ)
            const raw = await readChannelTraces(src.path, rec, { startTs: src.lap.startTs, endTs: src.lap.endTs }, TRACE_HZ, extraChannels)
            const inputs = [...raw].flatMap(([name, arrays]) => arrays.map((data, w) => ({ name: `x:${w}:${name}`, data })))
            const d = resampleByDistance(fine, STEP_M, inputs)
            for (const [name, arrays] of raw) extra[name] = arrays.map((_, w) => fitLength(d.channels[`x:${w}:${name}`]!, n))
        }

        const L = c.trackLengthM ?? 0
        const toM = (norPos: number) => norPos * L
        laps.push({
            lapId: src.lap.id,
            sessionId: src.session.id,
            lapNumber: src.lap.lapNumber,
            lapTimeMs: src.lap.lapTimeMs,
            isValid: src.lap.isValid,
            track: src.session.trackLayout ?? src.session.track,
            car: src.session.car,
            sessionType: src.session.packageFormat === 'rlap' ? 'Lap' : src.session.sessionType,
            recordedAt: src.session.recordedAt,
            stepM: STEP_M,
            distM,
            timeMs: c.arrays.timeMs,
            speed: c.arrays.speed,
            throttle: c.arrays.throttle,
            brake: c.arrays.brake,
            steer: c.arrays.steer,
            gear: c.arrays.gear,
            mapX: Float32Array.from(c.arrays.gpsLon, v => v * 111_320 * cosLat),
            mapY: Float32Array.from(c.arrays.gpsLat, v => v * 110_540),
            deltaMs: i === 0 ? null : timeDelta({ stepM: STEP_M, timeMs: c.arrays.timeMs }, refTime),
            corners: c.corners.map((k): CornerInfo => ({
                number: k.number,
                entryM: toM(k.entryNorPos),
                apexM: toM(k.apexNorPos),
                exitM: toM(k.exitNorPos),
                minSpeedKmh: k.minSpeedKmh,
                entrySpeedKmh: k.entrySpeedKmh,
                exitSpeedKmh: k.exitSpeedKmh,
                brakeM: k.brakePointNorPos === null ? null : toM(k.brakePointNorPos),
                throttleM: k.throttleOpenNorPos === null ? null : toM(k.throttleOpenNorPos),
                isLeft: k.isLeft,
                peakGLat: k.peakGLat,
            })),
            conditions: c.conditions,
            extra,
        })
    }
    return { trackLengthM, referenceLapId: ordered[0]!.lap.id, laps, channels: cores[0]!.channels }
}

/** Grids are built from the same lap distance, so lengths match; guard anyway. */
function fitLength(a: Float32Array, n: number): Float32Array {
    if (a.length === n) return a
    const out = new Float32Array(n)
    out.set(a.subarray(0, n))
    if (a.length < n) out.fill(a[a.length - 1] ?? 0, a.length)
    return out
}
