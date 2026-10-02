import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LapRow, SessionRow } from '../shared/types'
import { analyseLaps, type LapSource, type TraceCache } from './analysis-service'
import { decodeLapCore, encodeLapCore } from './trace-cache'
import { readRecordingSession } from './telemetry/reader'

const SAMPLES = join(__dirname, '..', '..', '..', 'samples')
const RACE = join(SAMPLES, 'Bahrain International Circuit_R_2026-09-18T14_44_00Z.duckdb')
const QUALI = join(SAMPLES, 'Bahrain International Circuit_Q_2026-09-18T14_34_20Z.duckdb')
const SPA_Q = join(SAMPLES, 'Circuit de Spa-Francorchamps_Q_2026-09-29T16_05_27Z.duckdb')

async function source(path: string, index: number, id: number): Promise<LapSource> {
    const s = await readRecordingSession(path)
    const seg = s.laps[index]!
    const lap: LapRow = {
        id, sessionId: id, lapNumber: seg.index, kind: seg.kind, lapTimeMs: seg.lapTimeMs, sector1Ms: seg.sector1Ms,
        sector2Ms: seg.sector2Ms, sector3Ms: seg.sector3Ms, isValid: seg.isValid, inPits: seg.inPits,
        startTs: seg.startTs, endTs: seg.endTs, isReference: false, note: '',
    }
    const session = { id, fileHash: path, track: s.track, trackLayout: s.trackLayout, car: s.car } as SessionRow
    return { lap, session, path }
}

describe('lap comparison on real laps', () => {
    it('delta at the finish equals the difference of the official lap times', async () => {
        const ref = await source(QUALI, 1, 1)   // 2:02.453
        const lap = await source(RACE, 2, 2)    // 2:04.265
        const r = await analyseLaps([lap, ref], 1)
        expect(r.referenceLapId).toBe(1)
        expect(r.laps[0]!.deltaMs).toBeNull()
        const d = r.laps[1]!.deltaMs!
        const n = Math.min(r.laps[0]!.distM.length, r.laps[1]!.distM.length)
        expect(d[n - 1]! - (124265 - 122453)).toBeLessThan(150)
        expect(d[n - 1]! - (124265 - 122453)).toBeGreaterThan(-150)
        // the two laps share one distance grid and the track map is ~track length
        const a = r.laps[0]!
        let path = 0
        for (let i = 1; i < a.mapX.length; i++) path += Math.hypot(a.mapX[i]! - a.mapX[i - 1]!, a.mapY[i]! - a.mapY[i - 1]!)
        expect(Math.abs(path - r.trackLengthM!) / r.trackLengthM!).toBeLessThan(0.03)
        expect(a.corners.length).toBeGreaterThanOrEqual(8)
    })

    it('places throttle-on and the line apex independently of the slowest point', async () => {
        const r = await analyseLaps([await source(RACE, 2, 31)], 31)
        const corners = r.laps[0]!.corners
        // The driver is usually back on the throttle before the slowest point; it must not just echo the apex.
        const apart = corners.filter(c => c.throttleM !== null && Math.abs(c.throttleM - c.apexM) > 4)
        expect(apart.length).toBeGreaterThan(corners.length / 2)
        // Throttle-on comes after the brake point and near the line apex, not in the braking zone.
        for (const c of corners) {
            if (c.throttleM !== null && c.brakeM !== null) expect(c.throttleM).toBeGreaterThan(c.brakeM)
            expect(Math.abs(c.lineApexM - c.apexM)).toBeLessThanOrEqual(100)
        }
    })

    it('serves repeated comparisons from the trace cache without touching the recording', async () => {
        const store = new Map<number, Uint8Array>()
        const cache: TraceCache = { get: id => store.get(id) ?? null, put: (id, d) => { store.set(id, d) } }
        const ref = await source(QUALI, 1, 11)
        const lap = await source(RACE, 2, 12)
        const t0 = performance.now()
        const first = await analyseLaps([lap, ref], 11, [], cache)
        const cold = performance.now() - t0
        expect([...store.keys()].sort()).toEqual([11, 12])

        // Point both laps at a file that does not exist: only the cache can answer.
        const gone = (s: LapSource): LapSource => ({ ...s, path: '/does/not/exist.duckdb', session: { ...s.session, fileHash: 'gone' } })
        const t1 = performance.now()
        const second = await analyseLaps([gone(lap), gone(ref)], 11, [], cache)
        const warm = performance.now() - t1
        expect(Array.from(second.laps[1]!.deltaMs!)).toEqual(Array.from(first.laps[1]!.deltaMs!))
        expect(Array.from(second.laps[0]!.mapX)).toEqual(Array.from(first.laps[0]!.mapX))
        expect(second.laps[1]!.corners).toEqual(first.laps[1]!.corners)
        expect(second.channels).toEqual(first.channels)
        expect(second.laps[0]!.conditions).toEqual(first.laps[0]!.conditions)
        expect(first.laps[0]!.conditions.weather).toBe('Overcast')
        expect(warm).toBeLessThan(cold / 5)
    })

    it('rejects damaged or foreign cache entries', () => {
        const core = { stepM: 2, n: 3, corners: [], trackLengthM: 100, channels: [], conditions: { timeOfDay: '14:00', weather: null, trackTempC: 30, airTempC: null, wetnessPct: 0, windKmh: null },
            arrays: Object.fromEntries(['timeMs', 'speed', 'throttle', 'brake', 'steer', 'gear', 'gpsLat', 'gpsLon'].map(k => [k, Float32Array.from([1, 2, 3])])) } as never
        const enc = encodeLapCore(core)
        expect(decodeLapCore(enc)?.arrays.speed).toEqual(Float32Array.from([1, 2, 3]))
        expect(decodeLapCore(enc)?.conditions.timeOfDay).toBe('14:00')
        expect(decodeLapCore(enc.subarray(0, enc.length - 4))).toBeNull()
        expect(decodeLapCore(new Uint8Array([1, 2, 3]))).toBeNull()
    })

    it('refuses to compare laps from different tracks', async () => {
        const bahrain = await source(QUALI, 1, 21)
        const spa = await source(SPA_Q, 1, 22)
        await expect(analyseLaps([bahrain, spa], 21)).rejects.toThrow(/different tracks/)
    })
})
