import { describe, expect, it } from 'vitest'
import { detectCorners } from './corners'
import { cleanLap, formatLapTime, miniSectorTimes, SECTOR_COUNT } from './lap-utils'
import { monotonicIndices, resampleByDistance, timeDelta } from './resample'
import { makeLap } from './test-helpers'

describe('lap utils', () => {
    it('trims wrap-around samples at both ends', () => {
        // 3 samples from the previous lap (norPos ~0.99), 100 real, 2 from the next lap.
        const np = [0.98, 0.99, 0.995, ...Array.from({ length: 100 }, (_, i) => i / 100), 0.001, 0.002]
        const lap = cleanLap(makeLap(np.length, { norPos: i => np[i]! }))
        expect(lap.count).toBe(100)
        expect(lap.norPos[0]).toBe(0)
        expect(lap.norPos[99]).toBeCloseTo(0.99)
        expect(lap.speed.length).toBe(100)
    })

    it('mini-sector times add up to the lap time', () => {
        const lap = makeLap(900)
        const sectors = miniSectorTimes(lap)
        expect(sectors).toHaveLength(SECTOR_COUNT)
        expect(sectors.reduce((a, b) => a + b, 0)).toBe(lap.timeMs[899]! - lap.timeMs[0]!)
    })

    it('formats lap times', () => {
        expect(formatLapTime(83_456)).toBe('1:23.456')
        expect(formatLapTime(null)).toBe('—')
    })
})

describe('corner detection', () => {
    // Two corners: a right-hander around t=0.25 and a left-hander around t=0.7.
    const bump = (t: number, c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w)
    const lap = makeLap(1000, {
        gLat: (_i, t) => 1.5 * bump(t, 0.25, 0.03) - 1.2 * bump(t, 0.7, 0.03),
        speed: (_i, t) => 250 - 150 * bump(t, 0.25, 0.04) - 120 * bump(t, 0.7, 0.04),
        brake: (_i, t) => (t > 0.2 && t < 0.24) || (t > 0.65 && t < 0.69) ? 0.8 : 0,
        throttle: (_i, t) => (t > 0.2 && t < 0.255) || (t > 0.65 && t < 0.705) ? 0 : 1,
    })

    it('detects corners at speed minima, direction from lateral G', () => {
        const corners = detectCorners(lap)
        expect(corners).toHaveLength(2)
        // positive lateral G = right-hand corner
        expect(corners[0]).toMatchObject({ number: 1, isLeft: false })
        expect(corners[1]).toMatchObject({ number: 2, isLeft: true })
        expect(corners[0]!.apexNorPos).toBeCloseTo(0.25, 1)
        expect(corners[0]!.minSpeedKmh).toBeLessThan(120)
        expect(corners[0]!.brakePointNorPos).toBeCloseTo(0.201, 2)
        expect(corners[0]!.throttleOpenNorPos!).toBeGreaterThan(corners[0]!.apexNorPos)
    })

})

describe('distance resampling', () => {
    it('ignores stalled and backward distance samples', () => {
        expect(Array.from(monotonicIndices(Float32Array.from([0, 1, 1, 0.5, 2, NaN, 3])))).toEqual([0, 1, 4, 6])
    })

    it('interpolates onto a metre grid and holds gear as a step', () => {
        // 50 m/s at 10 Hz → 5 m per sample
        const lap = makeLap(100, { distM: i => i * 5, speed: i => i, gear: i => (i < 50 ? 3 : 4) })
        const d = resampleByDistance(lap, 1)
        expect(d.distM.length).toBe(496) // 0 … 495 m
        expect(d.distM[10]).toBe(10)
        expect(d.timeMs[10]).toBeCloseTo(200)
        expect(d.channels.speed[12]).toBeCloseTo(2.4)
        expect(d.channels.gear[249]).toBe(3)
        expect(d.channels.gear[251]).toBe(4)
    })

    it('computes the time delta against a reference by distance', () => {
        const ref = resampleByDistance(makeLap(100, { distM: i => i * 5 }), 1)   // 50 m/s
        const slow = resampleByDistance(makeLap(110, { distM: i => i * 4.5 }), 1) // 45 m/s
        const delta = timeDelta(slow, ref)
        expect(delta.length).toBe(Math.min(ref.distM.length, slow.distM.length))
        expect(delta[0]).toBe(0)
        // after 450 m: 10 s vs 9 s
        expect(delta[450]).toBeCloseTo(1000, -1)
    })
})
