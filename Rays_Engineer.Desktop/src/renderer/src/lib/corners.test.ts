import type { CornerInfo, LapAnalysis } from '@shared/analysis'
import { describe, expect, it } from 'vitest'
import { cornerLapStats, cornerWindow, matchCorner } from './corners'

const corner = (p: Partial<CornerInfo>): CornerInfo => ({
    number: 1, entryM: 300, apexM: 400, lineApexM: 400, exitM: 500, minSpeedKmh: 90, entrySpeedKmh: 250, exitSpeedKmh: 180,
    brakeM: 280, throttleM: 420, isLeft: false, peakGLat: 2, ...p,
})

/** 1000 m lap on a 2 m grid; brake 0.8 from 280 m to 390 m, delta grows by 100 ms between 280 m and 500 m. */
function lap(corners: CornerInfo[], withDelta: boolean): LapAnalysis {
    const n = 501
    const brake = new Float32Array(n)
    for (let i = 140; i < 195; i++) brake[i] = i === 150 ? 0.95 : 0.8
    const deltaMs = withDelta ? Float32Array.from({ length: n }, (_, i) => (i <= 140 ? 0 : i >= 250 ? 100 : (i - 140) / 110 * 100)) : null
    return {
        stepM: 2, distM: Float32Array.from({ length: n }, (_, i) => i * 2), speed: Float32Array.from({ length: n }, () => 150),
        brake, deltaMs, corners,
    } as unknown as LapAnalysis
}

describe('corner matching', () => {
    it('picks the closest apex within 120 m', () => {
        const cs = [corner({ number: 1, apexM: 300 }), corner({ number: 2, apexM: 430 }), corner({ number: 3, apexM: 900 })]
        expect(matchCorner(cs, 400)?.number).toBe(2)
        expect(matchCorner(cs, 700)).toBeNull()
    })
})

describe('corner lap stats', () => {
    const ref = corner({})

    it('measures brake and throttle points relative to the reference apex', () => {
        const other = corner({ apexM: 410, lineApexM: 395, brakeM: 270, throttleM: 450, minSpeedKmh: 86 })
        const s = cornerLapStats(lap([other], true), ref, false)
        expect(s.apexKmh).toBe(86)
        expect(s.brakeBeforeM).toBe(130)
        expect(s.throttleAfterM).toBe(50)
        expect(s.peakBrake).toBeCloseTo(0.95)
        expect(s.exitKmh).toBe(150)
        expect(s.timeMs).toBeCloseTo(100)
    })

    it('has no time for the reference and no points when the corner is missing', () => {
        expect(cornerLapStats(lap([ref], false), ref, true).timeMs).toBeNull()
        const s = cornerLapStats(lap([], true), ref, false)
        expect(s.apexKmh).toBeNull()
        expect(s.brakeBeforeM).toBeNull()
        expect(s.exitKmh).toBe(150)
    })

    it('widens the window to every lap\'s brake and throttle point', () => {
        const stats = [cornerLapStats(lap([ref], false), ref, true), cornerLapStats(lap([corner({ brakeM: 200, throttleM: 560 })], true), ref, false)]
        expect(cornerWindow(ref, stats, 1000)).toEqual({ fromM: 140, toM: 620 })
        expect(cornerWindow(ref, stats, 600).toM).toBe(600)
    })
})
