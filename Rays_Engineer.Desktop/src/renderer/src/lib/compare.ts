/**
 * Pure helpers for the sessions table, the compare basket and the channel picker.
 * No React / browser APIs here, so vitest can run them in node.
 */
import type { ChannelOption } from '../../../shared/analysis'
import { parseRecordingTime } from '../../../shared/format'
import type { SessionRow } from '../../../shared/types'

/** Session type as shown in the UI: imported single laps (.rlap) read "Lap". */
export function sessionTypeLabel(s: Pick<SessionRow, 'sessionType' | 'packageFormat'>): string | null {
    return s.packageFormat === 'rlap' ? 'Lap' : s.sessionType
}

// ── Sessions table sort ──────────────────────────────────────────────────────

export type SortKey = 'recorded' | 'track' | 'session' | 'car' | 'driver' | 'laps' | 'best'
export interface SessionSort { key: SortKey; dir: 'asc' | 'desc' }

export const DEFAULT_SORT: SessionSort = { key: 'recorded', dir: 'desc' }

/** First click on a column: newest / most laps first for numbers, A→Z / fastest first otherwise. */
export function nextSort(cur: SessionSort, key: SortKey): SessionSort {
    if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
    return { key, dir: key === 'recorded' || key === 'laps' ? 'desc' : 'asc' }
}

export function recordedMs(s: SessionRow): number {
    const iso = s.recordedAt ?? parseRecordingTime(s.fileName)
    const t = iso ? Date.parse(iso) : NaN
    return Number.isNaN(t) ? s.fileMtimeMs : t
}

function sortValue(s: SessionRow, key: SortKey): string | number | null {
    const parsed = s.status === 'parsed'
    switch (key) {
        case 'recorded': return recordedMs(s)
        case 'track': return parsed ? (s.trackLayout ?? s.track) : null
        case 'session': return parsed ? sessionTypeLabel(s) : null
        case 'car': return parsed ? s.car : null
        // Only imported sessions name someone else; own recordings sort last.
        case 'driver': return parsed && s.origin === 'import' ? (s.driver ?? '') : null
        case 'laps': return parsed ? (s.lapCount ?? 0) : null
        case 'best': return parsed ? s.bestLapMs : null
    }
}

/** Stable sort; rows without a value (unparsed, no best lap) always go last. */
export function sortSessions(rows: SessionRow[], sort: SessionSort): SessionRow[] {
    const sign = sort.dir === 'asc' ? 1 : -1
    return rows
        .map((s, i) => ({ s, i, v: sortValue(s, sort.key) }))
        .sort((a, b) => {
            if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1
            const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))
            return c !== 0 ? c * sign : a.i - b.i
        })
        .map(x => x.s)
}

// ── Compare basket ───────────────────────────────────────────────────────────

export interface CompareLap {
    lapId: number
    sessionId: number
    track: string | null
    trackLayout: string | null
    car: string | null
    lapNumber: number
    lapTimeMs: number | null
    isValid: boolean
    sessionType: string | null
    recordedAt: string | null
}

const trackKey = (l: Pick<CompareLap, 'track' | 'trackLayout'>) => `${l.track ?? ''}\u001f${l.trackLayout ?? ''}`

/** Laps whose track or layout differs from the first picked lap. */
export function mismatchedLaps(laps: CompareLap[]): Set<number> {
    const first = laps[0]
    return new Set(first ? laps.filter(l => trackKey(l) !== trackKey(first)).map(l => l.lapId) : [])
}

/** The chosen reference if it is still in the basket, else the fastest valid lap, else the first. */
export function basketReference(laps: CompareLap[], chosen: number | null): number | null {
    if (chosen !== null && laps.some(l => l.lapId === chosen)) return chosen
    const timed = laps.filter(l => l.isValid && l.lapTimeMs !== null)
    if (timed.length) return timed.reduce((a, l) => (l.lapTimeMs! < a.lapTimeMs! ? l : a)).lapId
    return laps[0]?.lapId ?? null
}

// ── Channel picker ───────────────────────────────────────────────────────────

export interface ExtraChart {
    channel: string
    /** Wheel index for value1…value4 channels. */
    wheel: number
}

/** A wheel channel can be shown once per wheel, any other channel once. */
export const channelLimit = (c: Pick<ChannelOption, 'wheels'>) => (c.wheels ? 4 : 1)

export function channelUses(charts: ExtraChart[], name: string): number {
    return charts.filter(e => e.channel === name).length
}

/** First wheel of `name` not shown yet (0 if all are, which the picker prevents). */
export function freeWheel(charts: ExtraChart[], name: string): number {
    const used = new Set(charts.filter(e => e.channel === name).map(e => e.wheel))
    for (let w = 0; w < 4; w++) if (!used.has(w)) return w
    return 0
}
