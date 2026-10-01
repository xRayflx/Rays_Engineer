/**
 * Distance-based resampling for lap comparison. Laps are compared by where
 * the car is on track (metres from the finish line), not by elapsed time:
 * every channel is interpolated onto the same absolute distance grid
 * (0, step, 2·step, …), and the time delta to a reference lap is
 * t_lap(d) − t_ref(d).
 */
import type { LapTrace } from './lap-trace'

export interface ResampleInput {
    name: string
    data: ArrayLike<number>
    /** Hold the previous value instead of interpolating (gear). */
    step?: boolean
}

export interface DistanceTrace {
    stepM: number
    /** Grid positions in metres from the finish line: 0, step, 2·step, … */
    distM: Float32Array
    /** Time since the lap start at each grid point. */
    timeMs: Float32Array
    channels: Record<string, Float32Array>
}

/**
 * Keeps only samples where distance strictly increases. Lap distance can
 * stall (standstill) or jitter backwards; interpolation needs a monotonic axis.
 */
export function monotonicIndices(dist: ArrayLike<number>): Uint32Array {
    const idx: number[] = []
    let last = -Infinity
    for (let i = 0; i < dist.length; i++) {
        const d = dist[i]!
        if (Number.isFinite(d) && d > last) { idx.push(i); last = d }
    }
    return Uint32Array.from(idx)
}

/** Interpolates ys(xs) at each grid point (xs increasing); outside the data the end values are held. */
function interpolate(xs: Float32Array, ys: Float32Array, grid: Float32Array, step: boolean): Float32Array {
    const out = new Float32Array(grid.length)
    let j = 0
    for (let g = 0; g < grid.length; g++) {
        const x = grid[g]!
        while (j < xs.length - 2 && xs[j + 1]! < x) j++
        const x0 = xs[j]!, x1 = xs[j + 1] ?? x0
        const y0 = ys[j]!, y1 = ys[j + 1] ?? y0
        if (x <= x0) out[g] = y0
        else if (x >= x1) out[g] = y1
        else out[g] = step ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
    return out
}

export function resampleByDistance(lap: LapTrace, stepM = 1, extra: ResampleInput[] = []): DistanceTrace {
    if (!lap.distM) throw new Error('Lap has no distance channel')
    if (!(stepM > 0)) throw new Error('stepM must be positive')

    const keep = monotonicIndices(lap.distM)
    if (keep.length < 2) throw new Error('Lap has too few distance samples')
    const pick = (arr: ArrayLike<number>) => Float32Array.from(keep, i => arr[i]!)

    const xs = pick(lap.distM)
    const end = xs[xs.length - 1]!
    const n = Math.max(1, Math.floor(end / stepM) + 1)
    const distM = Float32Array.from({ length: n }, (_, k) => k * stepM)

    const inputs: ResampleInput[] = [
        { name: 'speed', data: lap.speed },
        { name: 'throttle', data: lap.throttle },
        { name: 'brake', data: lap.brake },
        { name: 'steer', data: lap.steer },
        ...(lap.gear ? [{ name: 'gear', data: lap.gear, step: true }] : []),
        ...extra,
    ]
    const channels: Record<string, Float32Array> = {}
    for (const c of inputs) channels[c.name] = interpolate(xs, pick(c.data), distM, c.step === true)
    return { stepM, distM, timeMs: interpolate(xs, pick(lap.timeMs), distM, false), channels }
}

/**
 * Time delta (ms) of `lap` against `ref` along the shorter of both grids,
 * both measured from distance 0. Positive = lap is slower at that point.
 */
export function timeDelta(lap: Pick<DistanceTrace, 'stepM' | 'timeMs'>, ref: Pick<DistanceTrace, 'stepM' | 'timeMs'>): Float32Array {
    if (lap.stepM !== ref.stepM) throw new Error('Traces must share the same distance step')
    const n = Math.min(lap.timeMs.length, ref.timeMs.length)
    const out = new Float32Array(n)
    const t0 = lap.timeMs[0]!, r0 = ref.timeMs[0]!
    for (let i = 0; i < n; i++) out[i] = (lap.timeMs[i]! - t0) - (ref.timeMs[i]! - r0)
    return out
}
