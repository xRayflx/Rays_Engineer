/**
 * Corner detection from the speed trace (expects ~10 Hz samples).
 *
 * A corner is a local speed minimum with a real slow-down before it — what a
 * driver perceives as a braking zone + corner. Lateral G gives the direction
 * (normalised by the reader: gLat > 0 = right-hand corner, verified against
 * steering and real corner directions at Bahrain and Spa).
 *
 * Replaces the lateral-G threshold detection ported from the web app, which
 * merged neighbouring corners and missed half of them on real LMU laps.
 */
import { at, type LapTrace } from './lap-trace'

const SMOOTH_HALF = 2          // 5-sample moving average
const MIN_WINDOW = 10          // a minimum must be the lowest within ±1 s
const MIN_DROP_KMH = 12        // slow-down needed before the minimum
const MERGE_RISE_KMH = 10      // two minima without this much speed in between are one corner
const BRAKE_THRESHOLD = 0.05
const THROTTLE_THRESHOLD = 0.10
const FULL_THROTTLE = 0.95
const STRAIGHT_G = 0.4         // exit: back on full throttle with |lateral G| below this
const BRAKE_LOOKBACK_M = 400

export interface DetectedCorner {
    number: number
    entryNorPos: number
    apexNorPos: number
    exitNorPos: number
    /** Signed peak lateral G between entry and exit; positive = right-hand corner. */
    peakGLat: number
    minSpeedKmh: number
    entrySpeedKmh: number
    exitSpeedKmh: number
    /** First brake application after the top speed before the corner (max 400 m before the apex); null if none. */
    brakePointNorPos: number | null
    /** First throttle application after the apex; null if none. */
    throttleOpenNorPos: number | null
    isLeft: boolean
}

function smooth(v: Float32Array): Float32Array {
    const n = v.length
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - SMOOTH_HALF)
        const hi = Math.min(n - 1, i + SMOOTH_HALF)
        let s = 0
        for (let j = lo; j <= hi; j++) s += v[j]!
        out[i] = s / (hi - lo + 1)
    }
    return out
}

function argMax(v: Float32Array, from: number, to: number): number {
    let best = from
    for (let i = from; i <= to; i++) if (v[i]! > v[best]!) best = i
    return best
}

export function detectCorners(lap: LapTrace): DetectedCorner[] {
    const n = lap.count
    if (n < 2 * MIN_WINDOW + 1) return []
    const s = smooth(lap.speed)

    // 1. local minima
    let minima: number[] = []
    for (let i = 1; i < n - 1; i++) {
        let lowest = true
        for (let j = Math.max(0, i - MIN_WINDOW); j <= Math.min(n - 1, i + MIN_WINDOW) && lowest; j++) {
            if (s[j]! < s[i]! || (s[j] === s[i] && j < i)) lowest = false
        }
        if (lowest) minima.push(i)
    }

    // 2. merge minima that are not separated by a real speed rise (keep the slower one)
    const merged: number[] = []
    for (const m of minima) {
        const prev = merged[merged.length - 1]
        if (prev !== undefined && s[argMax(s, prev, m)]! - Math.max(s[prev]!, s[m]!) < MERGE_RISE_KMH) {
            if (s[m]! < s[prev]!) merged[merged.length - 1] = m
        } else merged.push(m)
    }
    minima = merged

    // 3. build corners
    const out: DetectedCorner[] = []
    let prevExit = 0
    for (let k = 0; k < minima.length; k++) {
        const apex = minima[k]!
        const entry = argMax(s, prevExit, apex)
        if (s[entry]! - s[apex]! < MIN_DROP_KMH) continue
        const nextApex = minima[k + 1] ?? n - 1
        let exit = argMax(s, apex, nextApex)
        // exit = back on full throttle with the car straight again, if that comes earlier
        for (let i = apex + 1; i < exit; i++) {
            if (lap.throttle[i]! >= FULL_THROTTLE && Math.abs(at(lap.gLat, i)) < STRAIGHT_G) { exit = i; break }
        }

        let brake: number | null = null
        let from = entry
        if (lap.distM) {
            const limit = lap.distM[apex]! - BRAKE_LOOKBACK_M
            while (from < apex && lap.distM[from]! < limit) from++
        }
        for (let i = from; i <= apex; i++) if (lap.brake[i]! > BRAKE_THRESHOLD) { brake = lap.norPos[i]!; break }

        let throttle: number | null = null
        for (let i = apex; i <= exit; i++) if (lap.throttle[i]! > THROTTLE_THRESHOLD) { throttle = lap.norPos[i]!; break }

        // Direction from the strongest lateral load; at the slowest point of a hairpin G is ~0.
        let peak = 0
        for (let i = entry; i <= exit; i++) if (Math.abs(at(lap.gLat, i)) > Math.abs(peak)) peak = at(lap.gLat, i)

        out.push({
            number: out.length + 1,
            entryNorPos: lap.norPos[entry]!,
            apexNorPos: lap.norPos[apex]!,
            exitNorPos: lap.norPos[exit]!,
            peakGLat: peak,
            minSpeedKmh: lap.speed[apex]!,
            entrySpeedKmh: lap.speed[entry]!,
            exitSpeedKmh: lap.speed[exit]!,
            brakePointNorPos: brake,
            throttleOpenNorPos: throttle,
            isLeft: peak < 0,
        })
        prevExit = exit
    }
    return out
}
