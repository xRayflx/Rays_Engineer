import type { CornerInfo, LapAnalysis } from '@shared/analysis'

/** Apexes further apart than this are different corners. */
const MATCH_M = 120

/** The corner of another lap that is the same corner as the reference's (closest apex within 120 m), or null. */
export function matchCorner(corners: CornerInfo[], apexM: number): CornerInfo | null {
    let best: CornerInfo | null = null
    for (const c of corners) if (Math.abs(c.apexM - apexM) < MATCH_M && (!best || Math.abs(c.apexM - apexM) < Math.abs(best.apexM - apexM))) best = c
    return best
}

/** Grid index of a distance, clamped to the lap. */
export function indexAt(l: LapAnalysis, m: number): number {
    return Math.max(0, Math.min(l.distM.length - 1, Math.round(m / l.stepM)))
}

export function deltaAt(l: LapAnalysis, m: number): number | null {
    if (!l.deltaMs) return null
    const i = Math.round(m / l.stepM)
    return i >= 0 && i < l.deltaMs.length ? l.deltaMs[i]! : null
}

/**
 * One lap through one reference corner. Distances are relative to the reference
 * lap's line apex (tightest point of its GPS line) so laps compare by track position.
 */
export interface CornerLapStats {
    /** The lap's own line apex, metres from the finish line; null if the corner wasn't found in this lap. */
    apexM: number | null
    /** Minimum speed in the corner. */
    apexKmh: number | null
    /** First brake application, metres before the reference apex. */
    brakeBeforeM: number | null
    /** Highest brake pressure between the brake point and the slowest point, 0–1. */
    peakBrake: number | null
    /** Throttle rising again after its lowest point, metres after the reference apex (negative = before it). */
    throttleAfterM: number | null
    /** Speed at the reference corner's exit point. */
    exitKmh: number | null
    /** Time gained (−) or lost (+) against the reference from its brake point to its exit; null for the reference. */
    timeMs: number | null
}

export function cornerLapStats(lap: LapAnalysis, ref: CornerInfo, isRef: boolean): CornerLapStats {
    const c = isRef ? ref : matchCorner(lap.corners, ref.apexM)
    const exitI = indexAt(lap, ref.exitM)
    const exitKmh = exitI < lap.speed.length ? lap.speed[exitI]! : null
    let timeMs: number | null = null
    if (!isRef) {
        const dIn = deltaAt(lap, Math.min(ref.entryM, ref.brakeM ?? ref.entryM))
        const dOut = deltaAt(lap, ref.exitM)
        timeMs = dIn !== null && dOut !== null ? dOut - dIn : null
    }
    if (!c) return { apexM: null, apexKmh: null, brakeBeforeM: null, peakBrake: null, throttleAfterM: null, exitKmh, timeMs }

    let peakBrake: number | null = null
    if (c.brakeM !== null) {
        peakBrake = 0
        for (let i = indexAt(lap, c.brakeM); i <= indexAt(lap, c.apexM); i++) peakBrake = Math.max(peakBrake, lap.brake[i]!)
    }
    return {
        apexM: c.lineApexM,
        apexKmh: c.minSpeedKmh,
        brakeBeforeM: c.brakeM === null ? null : ref.lineApexM - c.brakeM,
        peakBrake,
        throttleAfterM: c.throttleM === null ? null : c.throttleM - ref.lineApexM,
        exitKmh,
        timeMs,
    }
}

/** Distance range shown for a corner: from before the earliest brake point to after the exit and the latest throttle point. */
export function cornerWindow(ref: CornerInfo, stats: CornerLapStats[], lapLengthM: number): { fromM: number; toM: number } {
    let from = Math.min(ref.entryM, ref.brakeM ?? ref.entryM)
    let to = ref.exitM
    for (const s of stats) {
        if (s.brakeBeforeM !== null) from = Math.min(from, ref.lineApexM - s.brakeBeforeM)
        if (s.throttleAfterM !== null) to = Math.max(to, ref.lineApexM + s.throttleAfterM)
    }
    return { fromM: Math.max(0, from - 60), toM: Math.min(lapLengthM, to + 60) }
}
