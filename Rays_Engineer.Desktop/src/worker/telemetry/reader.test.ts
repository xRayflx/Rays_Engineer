import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectCorners } from '../analysis/corners'
import { addTimeOfDay, EmptyRecordingError, readLapConditions, readLapTrace, readRecordingSession } from './reader'

const SAMPLES = join(__dirname, '..', '..', '..', '..', 'samples')
const sample = (name: string) => join(SAMPLES, `${name}.duckdb`)
const RACE = sample('Bahrain International Circuit_R_2026-09-18T14_44_00Z')
const QUALI = sample('Bahrain International Circuit_Q_2026-09-18T14_34_20Z')
const SPA_Q = sample('Circuit de Spa-Francorchamps_Q_2026-09-29T16_05_27Z')

describe('reader on real LMU recordings', () => {
    it('reads metadata', async () => {
        const s = await readRecordingSession(RACE)
        expect(s).toMatchObject({
            track: 'Bahrain International Circuit',
            sessionType: 'Race',
            car: 'Team WRT 2024 #46:LM',
            carClass: 'GT3',
            recordedAt: '2026-09-18T14:44:00Z',
            t0: 17.96,
        })
        expect(JSON.parse(s.setupJson!)['VM_BRAKE_BALANCE']).toBeTruthy()
        expect(s.trackLengthM).toBeGreaterThan(5380)
        expect(s.channels.find(c => c.name === 'Throttle Pos')?.frequency).toBe(50)
    })

    it('segments a race including the rolling start', async () => {
        const { laps } = await readRecordingSession(RACE)
        expect(laps.map(l => l.kind)).toEqual(['partial', 'lap', 'lap', 'lap', 'lap', 'lap', 'partial'])
        expect(laps[0]).toMatchObject({ startTs: 17.96, endTs: 128.625 }) // formation lap
        expect(laps.slice(1, 6).map(l => [l.lapTimeMs, l.isValid])).toEqual([
            [132247, true], [124265, true], [124454, true], [123568, true], [123720, false],
        ])
        expect(laps[1]).toMatchObject({ sector1Ms: 42734, sector2Ms: 55337, sector3Ms: 34176 })
        expect(laps[5]).toMatchObject({ sector1Ms: null, sector2Ms: null, sector3Ms: null })
    })

    it('handles invalid laps and sectors in qualifying', async () => {
        const { laps } = await readRecordingSession(QUALI)
        expect(laps.map(l => l.kind)).toEqual(['partial', 'lap', 'lap', 'lap', 'partial'])
        expect(laps[0]!.inPits).toBe(true)
        expect(laps[1]).toMatchObject({ lapTimeMs: 122453, isValid: true })
        expect(laps[2]).toMatchObject({ isValid: false, sector1Ms: 37965, sector2Ms: null })
        expect(laps[3]).toMatchObject({ isValid: false, sector1Ms: null })
    })

    it('reads a Spa lap with cumulative sector 2', async () => {
        const { laps } = await readRecordingSession(SPA_Q)
        expect(laps.filter(l => l.kind === 'lap')).toHaveLength(1)
        expect(laps[1]).toMatchObject({ lapTimeMs: 165316, isValid: true, sector1Ms: 43540, sector2Ms: 74604, sector3Ms: 47172 })
    })

    it('treats short recordings as one partial segment and rejects empty files', async () => {
        const { laps } = await readRecordingSession(sample('Bahrain International Circuit_Q_2026-09-18T14_33_56Z'))
        expect(laps.map(l => l.kind)).toEqual(['partial'])
        await expect(readRecordingSession(sample('Circuit de Spa-Francorchamps_R_2026-09-29T16_14_46Z'))).rejects.toBeInstanceOf(EmptyRecordingError)
    })

    it('reads a lap trace aligned to lap distance', async () => {
        const s = await readRecordingSession(RACE)
        const lap = s.laps[2]!
        const t = await readLapTrace(RACE, s, lap, 10)
        expect(t.count).toBe(Math.ceil((lap.endTs - lap.startTs) * 10) + 1)
        expect(Math.abs(t.timeMs[t.count - 1]! - lap.lapTimeMs!)).toBeLessThan(15)
        expect(t.distM![0]).toBeLessThan(15)
        expect(t.distM![t.count - 1]).toBeGreaterThan(5360)
        expect(Math.max(...t.speed)).toBeGreaterThan(240)
        expect(Math.max(...t.throttle)).toBeLessThanOrEqual(1)
        expect(Math.min(...t.gear!)).toBeGreaterThanOrEqual(1)
    })

    it('detects corners at the real speed minima of a Bahrain lap', async () => {
        const s = await readRecordingSession(RACE)
        const t = await readLapTrace(RACE, s, s.laps[2]!, 10)
        const corners = detectCorners(t)
        expect(corners.length).toBeGreaterThanOrEqual(9)
        let prevExit = 0
        for (const c of corners) {
            // the slowest point of the corner lies within 3 % of the lap around the detected apex
            let iMin = 0
            for (let i = 0; i < t.count; i++) {
                if (t.norPos[i]! >= c.entryNorPos && t.norPos[i]! <= c.exitNorPos && t.speed[i]! < t.speed[iMin]! + (iMin === 0 ? Infinity : 0)) iMin = i
            }
            expect(Math.abs(t.norPos[iMin]! - c.apexNorPos)).toBeLessThan(0.03)
            if (c.brakePointNorPos !== null) {
                expect(c.brakePointNorPos).toBeGreaterThanOrEqual(prevExit)
                expect(c.brakePointNorPos).toBeLessThanOrEqual(c.apexNorPos)
            }
            prevExit = c.exitNorPos
        }
    })

    it('normalises the swapped G channels: gLat follows steering, gLon follows braking', async () => {
        const s = await readRecordingSession(QUALI)
        const t = await readLapTrace(QUALI, s, s.laps[1]!, 10)
        const corr = (a: Float32Array, b: Float32Array) => {
            let ma = 0, mb = 0
            for (let i = 0; i < a.length; i++) { ma += a[i]!; mb += b[i]! }
            ma /= a.length; mb /= b.length
            let ab = 0, aa = 0, bb = 0
            for (let i = 0; i < a.length; i++) { const x = a[i]! - ma, y = b[i]! - mb; ab += x * y; aa += x * x; bb += y * y }
            return ab / Math.sqrt(aa * bb)
        }
        const steerV2 = Float32Array.from(t.steer, (st, i) => st * (t.speed[i]! / 3.6) ** 2)
        expect(corr(t.gLat!, steerV2)).toBeGreaterThan(0.9)
        expect(corr(t.gLon!, t.brake)).toBeGreaterThan(0.9)
    })

    it('gets corner directions right (T1 Bahrain and La Source are right-handers)', async () => {
        for (const [path, idx] of [[RACE, 2], [SPA_Q, 1]] as const) {
            const s = await readRecordingSession(path)
            const corners = detectCorners(await readLapTrace(path, s, s.laps[idx]!, 10))
            expect(corners[0]!.isLeft).toBe(false)
            expect(corners.some(c => c.isLeft)).toBe(true)
        }
    })

    it('reads the conditions of a wet Spa lap', async () => {
        const s = await readRecordingSession(SPA_Q)
        const lap = s.laps[1]!
        const c = await readLapConditions(SPA_Q, s, lap)
        // SessionTime 14:46:43 is the in-game clock at t0
        expect(c.timeOfDay).toBe(addTimeOfDay('14:46:43', lap.startTs - s.t0))
        expect(c.weather).toBe('Overcast & Light Rain')
        expect(c.wetnessPct).toBeCloseTo(12.5)
        expect(c.airTempC).toBeCloseTo(16.02, 1)
        expect(c.trackTempC).toBeGreaterThan(17)
        expect(c.trackTempC).toBeLessThan(20)
        expect(c.windKmh).toBeCloseTo(25.2)
    })

    it('adds seconds to an in-game time of day', () => {
        expect(addTimeOfDay('14:46:43', 100)).toBe('14:48')
        expect(addTimeOfDay('23:59:30', 60)).toBe('00:00')
        expect(addTimeOfDay('', 0)).toBeNull()
    })
})
