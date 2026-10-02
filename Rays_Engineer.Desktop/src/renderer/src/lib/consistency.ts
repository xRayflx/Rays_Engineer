import type { LapAnalysis } from '@shared/analysis'

export const MINI_SECTORS = 24
/** Laps this close to the best count as "within" it. */
export const WITHIN_MS = 500

export function mean(a: number[]): number {
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
}

/** Sample standard deviation; 0 below two values. */
export function stdDev(a: number[]): number {
    if (a.length < 2) return 0
    const m = mean(a)
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

export function median(a: number[]): number {
    if (!a.length) return 0
    const b = [...a].sort((x, y) => x - y)
    const k = b.length >> 1
    return b.length % 2 ? b[k]! : (b[k - 1]! + b[k]!) / 2
}

export interface LapTimeStats {
    best: number
    worst: number
    average: number
    sd: number
    /** Laps within WITHIN_MS of the best. */
    within: number
    count: number
}

export function lapTimeStats(times: number[]): LapTimeStats | null {
    if (!times.length) return null
    const best = Math.min(...times)
    return {
        best,
        worst: Math.max(...times),
        average: mean(times),
        sd: stdDev(times),
        within: times.filter(t => t - best <= WITHIN_MS).length,
        count: times.length,
    }
}

/** Laps in driving order: by recording time, then lap number. */
export function chronological<T extends Pick<LapAnalysis, 'recordedAt' | 'lapNumber'>>(laps: T[]): T[] {
    return [...laps].sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '') || a.lapNumber - b.lapNumber)
}

/**
 * Time per mini-sector of equal length, per lap. Boundaries come from the
 * shortest lap's grid so every lap is cut at the same track positions.
 */
export function miniSectorTimes(laps: Pick<LapAnalysis, 'timeMs'>[], count = MINI_SECTORS): number[][] {
    const n = Math.min(...laps.map(l => l.timeMs.length))
    if (!Number.isFinite(n) || n < count + 1) return laps.map(() => [])
    const bounds = Array.from({ length: count + 1 }, (_, j) => Math.round(j * (n - 1) / count))
    return laps.map(l => bounds.slice(1).map((b, j) => l.timeMs[b]! - l.timeMs[bounds[j]!]!))
}
