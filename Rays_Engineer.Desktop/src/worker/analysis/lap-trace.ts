/**
 * Game-agnostic per-lap telemetry as parallel typed arrays (one entry per
 * sample). TypeScript successor of the C# ILapData interface: analysis code
 * only reads through this shape, the DuckDB reader (phase 2) produces it.
 *
 * Units: speed km/h, throttle/brake 0..1, steer −100..100 % (> 0 = right),
 * gLat in G (> 0 = right-hand corner), gLon in G (> 0 = braking),
 * timeMs since lap start, norPos 0..1 along the lap, distM metres along the lap.
 */
export type Wheels = readonly [Float32Array, Float32Array, Float32Array, Float32Array] // FL, FR, RL, RR

export interface LapTrace {
    track: string
    count: number
    timeMs: Float64Array
    norPos: Float32Array
    distM?: Float32Array
    speed: Float32Array
    throttle: Float32Array
    brake: Float32Array
    steer: Float32Array
    gear?: Float32Array
    rpm?: Float32Array
    gLon?: Float32Array
    gLat?: Float32Array
    gVert?: Float32Array
    gpsLat?: Float32Array
    gpsLon?: Float32Array
    wheelSpeed?: Wheels   // m/s
    slipAngle?: Wheels
}

const SCALAR_KEYS = [
    'timeMs', 'norPos', 'distM', 'speed', 'throttle', 'brake', 'steer',
    'gear', 'rpm', 'gLon', 'gLat', 'gVert', 'gpsLat', 'gpsLon',
] as const
const WHEEL_KEYS = ['wheelSpeed', 'slipAngle'] as const

/** Zero-copy view over samples [start, start + length). */
export function sliceLap(lap: LapTrace, start: number, length: number): LapTrace {
    const end = start + length
    const out: LapTrace = { ...lap, count: length }
    for (const k of SCALAR_KEYS) {
        const arr = lap[k]
        if (arr) (out as unknown as Record<string, unknown>)[k] = arr.subarray(start, end)
    }
    for (const k of WHEEL_KEYS) {
        const w = lap[k]
        if (w) out[k] = w.map(a => a.subarray(start, end)) as unknown as Wheels
    }
    return out
}

/** Value of an optional channel, 0 when absent (mirrors the C# SafeGet behaviour). */
export function at(arr: Float32Array | Float64Array | undefined, i: number): number {
    return arr && i >= 0 && i < arr.length ? arr[i]! : 0
}

/**
 * GPS → approximate local metres for the track map. Longitude is scaled by
 * cos(latitude). Returns null where no fix is available (0/0).
 */
export function contactPoint(lap: LapTrace, i: number): { x: number; z: number } | null {
    const lat = at(lap.gpsLat, i)
    const lon = at(lap.gpsLon, i)
    if (lat === 0 && lon === 0) return null
    const cosLat = Math.cos(lat * (Math.PI / 180))
    return { x: -(lon * 111_320 * cosLat), z: lat * 110_540 }
}
