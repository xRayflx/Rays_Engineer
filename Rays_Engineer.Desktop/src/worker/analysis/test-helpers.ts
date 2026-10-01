import type { LapTrace } from './lap-trace'

/** Builds a synthetic lap sampled at 10 Hz from per-sample generator functions. */
export function makeLap(count: number, f: Partial<Record<keyof LapTrace, (i: number, t: number) => number>> = {}, extra: Partial<LapTrace> = {}): LapTrace {
    const gen = (fn: ((i: number, t: number) => number) | undefined, dflt: (i: number, t: number) => number) =>
        Float32Array.from({ length: count }, (_, i) => (fn ?? dflt)(i, i / count))
    return {
        track: 'Test Track',
        count,
        timeMs: Float64Array.from({ length: count }, (_, i) => (f.timeMs ?? ((k: number) => k * 100))(i, i / count)),
        norPos: gen(f.norPos, (_i, t) => t),
        speed: gen(f.speed, () => 200),
        throttle: gen(f.throttle, () => 1),
        brake: gen(f.brake, () => 0),
        steer: gen(f.steer, () => 0),
        gLat: gen(f.gLat, () => 0),
        ...(f.distM ? { distM: gen(f.distM, () => 0) } : {}),
        ...(f.gear ? { gear: gen(f.gear, () => 0) } : {}),
        ...extra,
    }
}
