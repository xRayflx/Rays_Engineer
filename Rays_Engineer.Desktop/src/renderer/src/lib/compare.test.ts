import { describe, expect, it } from 'vitest'
import type { SessionRow } from '../../../shared/types'
import { basketReference, channelUses, freeWheel, mismatchedLaps, nextSort, sessionTypeLabel, sortSessions, type CompareLap } from './compare'

const row = (id: number, p: Partial<SessionRow>): SessionRow => ({
    id, fileName: `f${id}.duckdb`, fileMtimeMs: id, status: 'parsed', recordedAt: null, track: null, trackLayout: null,
    car: null, sessionType: null, packageFormat: null, lapCount: 0, bestLapMs: null, ...p,
}) as SessionRow

describe('sessions table sort', () => {
    const rows = [
        row(1, { bestLapMs: 125000, trackLayout: 'Spa', lapCount: 3, recordedAt: '2026-09-02T10:00:00Z' }),
        row(2, { bestLapMs: null, trackLayout: 'Bahrain', lapCount: 0, recordedAt: '2026-09-03T10:00:00Z' }),
        row(3, { bestLapMs: 120000, trackLayout: 'bahrain b', lapCount: 7, recordedAt: '2026-09-01T10:00:00Z' }),
        row(4, { status: 'unparsed' }),
    ]
    const ids = (r: SessionRow[]) => r.map(s => s.id)

    it('sorts by best lap with missing values last in both directions', () => {
        expect(ids(sortSessions(rows, { key: 'best', dir: 'asc' }))).toEqual([3, 1, 2, 4])
        expect(ids(sortSessions(rows, { key: 'best', dir: 'desc' }))).toEqual([1, 3, 2, 4])
    })

    it('sorts text and dates', () => {
        expect(ids(sortSessions(rows, { key: 'track', dir: 'asc' }))).toEqual([2, 3, 1, 4])
        expect(ids(sortSessions(rows, { key: 'recorded', dir: 'desc' }))).toEqual([2, 1, 3, 4])
    })

    it('sorts imported sessions by driver, own recordings last', () => {
        const mixed = [
            row(1, { origin: 'lmu', driver: 'Me' }),
            row(2, { origin: 'import', driver: 'Zoe' }),
            row(3, { origin: 'import', driver: 'Alex' }),
        ]
        expect(ids(sortSessions(mixed, { key: 'driver', dir: 'asc' }))).toEqual([3, 2, 1])
        expect(ids(sortSessions(mixed, { key: 'driver', dir: 'desc' }))).toEqual([2, 3, 1])
    })

    it('toggles direction on the same column, picks a sensible default on a new one', () => {
        expect(nextSort({ key: 'best', dir: 'asc' }, 'best')).toEqual({ key: 'best', dir: 'desc' })
        expect(nextSort({ key: 'best', dir: 'asc' }, 'laps')).toEqual({ key: 'laps', dir: 'desc' })
        expect(nextSort({ key: 'laps', dir: 'asc' }, 'car')).toEqual({ key: 'car', dir: 'asc' })
    })

    it('labels imported single laps as "Lap"', () => {
        expect(sessionTypeLabel({ sessionType: 'Race', packageFormat: 'rlap' })).toBe('Lap')
        expect(sessionTypeLabel({ sessionType: 'Race', packageFormat: 'rses' })).toBe('Race')
    })
})

describe('compare basket', () => {
    const lap = (lapId: number, trackLayout: string, lapTimeMs: number | null, isValid = true): CompareLap => ({
        lapId, sessionId: lapId, track: trackLayout, trackLayout, car: 'GT3', lapNumber: 1, lapTimeMs, isValid, sessionType: 'Race', recordedAt: null,
    })

    it('flags laps on a different track or layout than the first one', () => {
        expect(mismatchedLaps([lap(1, 'Bahrain', 1), lap(2, 'Bahrain', 2)]).size).toBe(0)
        expect([...mismatchedLaps([lap(1, 'Bahrain', 1), lap(2, 'Spa', 2), lap(3, 'Bahrain', 3)])]).toEqual([2])
        expect([...mismatchedLaps([lap(1, 'Bahrain', 1), { ...lap(2, 'Bahrain', 2), trackLayout: 'Bahrain Outer' }])]).toEqual([2])
    })

    it('uses the chosen reference, else the fastest valid lap', () => {
        const laps = [lap(1, 'A', 125000), lap(2, 'A', 120000, false), lap(3, 'A', 122000)]
        expect(basketReference(laps, null)).toBe(3)
        expect(basketReference(laps, 1)).toBe(1)
        expect(basketReference(laps, 99)).toBe(3)
        expect(basketReference([], null)).toBeNull()
    })
})

describe('channel picker limits', () => {
    it('counts uses and finds the next free wheel', () => {
        const charts = [{ channel: 'Brakes Temp', wheel: 0 }, { channel: 'Brakes Temp', wheel: 2 }, { channel: 'Clutch RPM', wheel: 0 }]
        expect(channelUses(charts, 'Brakes Temp')).toBe(2)
        expect(freeWheel(charts, 'Brakes Temp')).toBe(1)
        expect(freeWheel(charts, 'Tyres Wear')).toBe(0)
    })
})
