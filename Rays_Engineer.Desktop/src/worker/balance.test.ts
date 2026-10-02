import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { balanceMoments, balanceTrace, classify, cornerPhases, fitSteerModel, pathCurvature } from '../shared/balance'
import type { LapRow, SessionRow } from '../shared/types'
import { analyseLaps, type LapSource } from './analysis-service'
import { readRecordingSession } from './telemetry/reader'

const SAMPLES = join(__dirname, '..', '..', '..', 'samples')
const RACE = join(SAMPLES, 'Bahrain International Circuit_R_2026-09-18T14_44_00Z.duckdb')

async function source(path: string, index: number, id: number): Promise<LapSource> {
    const s = await readRecordingSession(path)
    const seg = s.laps[index]!
    const lap = {
        id, sessionId: id, lapNumber: seg.index, kind: seg.kind, lapTimeMs: seg.lapTimeMs, sector1Ms: null, sector2Ms: null, sector3Ms: null,
        isValid: seg.isValid, inPits: seg.inPits, startTs: seg.startTs, endTs: seg.endTs, isReference: false, note: '',
    } as LapRow
    return { lap, session: { id, fileHash: path, track: s.track, trackLayout: s.trackLayout, car: s.car } as SessionRow, path }
}

describe('balance on synthetic input', () => {
    // A 100 m-radius right-hander driven at constant speed and steering.
    const n = 400
    const stepM = 2
    const circle = (steer: (i: number) => number) => ({
        stepM,
        speed: new Float32Array(n).fill(100),
        steer: Float32Array.from({ length: n }, (_, i) => steer(i)),
        mapX: Float32Array.from({ length: n }, (_, i) => 100 * Math.cos(-i * stepM / 100)),
        mapY: Float32Array.from({ length: n }, (_, i) => 100 * Math.sin(-i * stepM / 100)),
    })

    it('reads a clockwise path as a right-hand curve', () => {
        const k = pathCurvature(circle(() => 20).mapX, circle(() => 20).mapY, stepM)
        expect(k[200]!).toBeCloseTo(0.01, 3)
    })

    it('is zero on the fitted lap and flags extra or missing lock', () => {
        const model = { a: 2000, b: 0, c: 0 } // 20 % lock at R 100
        expect(balanceTrace(circle(() => 20), model)[200]!).toBeCloseTo(0, 1)
        expect(balanceTrace(circle(() => 32), model)[200]!).toBeCloseTo(-12, 1)
        expect(classify(balanceTrace(circle(() => 5), model)[200]!)).toBe('over')
    })

    it('finds sustained moments and splits corners into phases', () => {
        const b = new Float32Array(100).fill(0)
        for (let i = 20; i < 30; i++) b[i] = 15        // 20 m of oversteer
        for (let i = 60; i < 62; i++) b[i] = -20       // 4 m blip: too short
        expect(balanceMoments(b, 2)).toEqual([{ kind: 'over', atM: 40, fromM: 40, toM: 58, peak: 15 }])
        b.fill(NaN, 0, 10)
        // entry 0–63 m: indices 10–32 are measured, 10 of them at 15; mid 65–95 m is all zero
        const p = cornerPhases(b, 2, { entryM: 0, apexM: 80, exitM: 160 })
        expect(p.entry).toBeCloseTo(150 / 23, 5)
        expect(p.mid).toBe(0)
    })
})

describe('balance on real laps', () => {
    it('agrees with steering direction and catches the lap 1 snap at Bahrain T9', async () => {
        const r = await analyseLaps([await source(RACE, 2, 1), await source(RACE, 1, 2)], 1)
        const [ref, lap1] = r.laps
        const model = fitSteerModel(ref!)!
        expect(model).not.toBeNull()

        // Clean reference lap: most of the cornering is close to the car's baseline.
        const b = Array.from(balanceTrace(ref!, model)).filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y)
        expect(b[b.length >> 1]!).toBeLessThan(5)

        // Lap 1: opposite lock at the last corner while the car still turns right.
        const t9 = ref!.corners[ref!.corners.length - 1]!
        const moments = balanceMoments(balanceTrace(lap1!, model), lap1!.stepM)
        expect(moments.some(m => m.kind === 'over' && Math.abs(m.atM - t9.apexM) < 60 && m.peak > 25)).toBe(true)
    })
})
