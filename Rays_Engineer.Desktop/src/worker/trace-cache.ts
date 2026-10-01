/**
 * Binary encoding of a lap's distance-resampled core traces for the SQLite
 * trace_cache table: [u32 header length][JSON header][padding to 4][Float32 arrays].
 */
import type { ChannelOption, LapConditions } from '../shared/analysis'
import type { DetectedCorner } from './analysis/corners'

/** Bump when the cached content or its computation changes; old rows are ignored and rebuilt. */
export const TRACE_CACHE_VERSION = 2

export const CORE_ARRAYS = ['timeMs', 'speed', 'throttle', 'brake', 'steer', 'gear', 'gpsLat', 'gpsLon'] as const
export type CoreArray = (typeof CORE_ARRAYS)[number]

export interface LapCore {
    stepM: number
    /** Number of grid points (distance = index · stepM). */
    n: number
    arrays: Record<CoreArray, Float32Array>
    /** Corners detected on the lap (norPos-based). */
    corners: DetectedCorner[]
    trackLengthM: number | null
    channels: ChannelOption[]
    conditions: LapConditions
}

interface Header {
    v: number
    stepM: number
    n: number
    corners: DetectedCorner[]
    trackLengthM: number | null
    channels: ChannelOption[]
    conditions: LapConditions
}

export function encodeLapCore(c: LapCore): Uint8Array {
    const header: Header = { v: TRACE_CACHE_VERSION, stepM: c.stepM, n: c.n, corners: c.corners, trackLengthM: c.trackLengthM, channels: c.channels, conditions: c.conditions }
    const json = new TextEncoder().encode(JSON.stringify(header))
    const headerEnd = 4 + json.length
    const dataStart = Math.ceil(headerEnd / 4) * 4
    const out = new Uint8Array(dataStart + CORE_ARRAYS.length * c.n * 4)
    new DataView(out.buffer).setUint32(0, json.length, true)
    out.set(json, 4)
    CORE_ARRAYS.forEach((k, i) => {
        const arr = c.arrays[k]
        if (arr.length !== c.n) throw new Error(`Array ${k} has ${arr.length} values, expected ${c.n}`)
        out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), dataStart + i * c.n * 4)
    })
    return out
}

/** Returns null for foreign versions or damaged data (the caller rebuilds). */
export function decodeLapCore(data: Uint8Array): LapCore | null {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const len = view.getUint32(0, true)
        const header = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + len))) as Header
        if (header.v !== TRACE_CACHE_VERSION) return null
        const dataStart = Math.ceil((4 + len) / 4) * 4
        if (data.byteLength !== dataStart + CORE_ARRAYS.length * header.n * 4) return null
        // Copy into an aligned buffer: SQLite BLOBs are not guaranteed to be 4-byte aligned.
        const body = data.slice(dataStart)
        const arrays = {} as Record<CoreArray, Float32Array>
        CORE_ARRAYS.forEach((k, i) => { arrays[k] = new Float32Array(body.buffer, body.byteOffset + i * header.n * 4, header.n) })
        return { stepM: header.stepM, n: header.n, arrays, corners: header.corners, trackLengthM: header.trackLengthM, channels: header.channels, conditions: header.conditions }
    } catch {
        return null
    }
}
