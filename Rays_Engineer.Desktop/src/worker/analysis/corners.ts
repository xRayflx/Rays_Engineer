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
const THROTTLE_HOLD_M = 20
/** Assumed speed-based spacing when a trace has no distance channel: metres between samples at ~10 Hz. */
const FALLBACK_SAMPLE_M = 5

function distanceBetween(lap: LapTrace, a: number, b: number): number {
    return lap.distM ? lap.distM[b]! - lap.distM[a]! : (b - a) * FALLBACK_SAMPLE_M
}

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
    /** Throttle rising again after its lowest point in the corner; null if the corner is taken flat. */
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
        let brakeI = -1
        for (let i = from; i <= apex; i++) if (lap.brake[i]! > BRAKE_THRESHOLD) { brakeI = i; brake = lap.norPos[i]!; break }

        // Throttle on = the first application above the corner's lowest throttle that is held off the brake for
        // THROTTLE_HOLD_M. The driver is often back on the throttle before the slowest point (searching from the
        // apex would just find the apex); downshift blips while braking and single spikes don't count.
        let throttle: number | null = null
        const lowFrom = brakeI >= 0 ? brakeI : entry
        let low = Infinity
        for (let i = lowFrom; i <= exit; i++) low = Math.min(low, lap.throttle[i]!)
        if (low < FULL_THROTTLE) {
            const on = (i: number) => lap.throttle[i]! > low + THROTTLE_THRESHOLD && lap.brake[i]! <= BRAKE_THRESHOLD
            for (let i = lowFrom; i <= exit && throttle === null; i++) {
                if (!on(i)) continue
                let j = i
                while (j + 1 < n && on(j + 1) && distanceBetween(lap, i, j + 1) < THROTTLE_HOLD_M) j++
                if (j + 1 < n && distanceBetween(lap, i, j + 1) >= THROTTLE_HOLD_M && on(j + 1)) throttle = lap.norPos[i]!
                else i = j
            }
        }

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
