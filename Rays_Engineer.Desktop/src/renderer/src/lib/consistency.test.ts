import { describe, expect, it } from 'vitest'
import { chronological, lapTimeStats, median, miniSectorTimes, stdDev } from './consistency'

describe('consistency stats', () => {
    it('computes sample standard deviation and median', () => {
        expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
        expect(stdDev([5])).toBe(0)
        expect(median([3, 1, 2])).toBe(2)
        expect(median([4, 1, 3, 2])).toBe(2.5)
    })

    it('summarises lap times', () => {
        expect(lapTimeStats([95_500, 95_900, 96_200])).toMatchObject({ best: 95_500, worst: 96_200, within: 2, count: 3 })
        expect(lapTimeStats([])).toBeNull()
    })

    it('orders laps by recording time, then lap number', () => {
        const laps = [
            { recordedAt: '2026-10-02T10:00:00Z', lapNumber: 7 },
            { recordedAt: '2026-10-01T10:00:00Z', lapNumber: 9 },
            { recordedAt: '2026-10-02T10:00:00Z', lapNumber: 3 },
        ]
        expect(chronological(laps).map(l => l.lapNumber)).toEqual([9, 3, 7])
    })
})

describe('mini-sectors', () => {
    it('cuts every lap at the same grid points and sums to the lap time', () => {
        const a = { timeMs: Float32Array.from({ length: 9 }, (_, i) => i * 100) }
        const b = { timeMs: Float32Array.from({ length: 10 }, (_, i) => i * 120) }
        const [ta, tb] = miniSectorTimes([a, b], 4)
        expect(ta).toEqual([200, 200, 200, 200])
        expect(tb).toEqual([240, 240, 240, 240])
    })

    it('returns nothing for laps too short to split', () => {
        expect(miniSectorTimes([{ timeMs: new Float32Array(3) }], 4)).toEqual([[]])
    })
})
