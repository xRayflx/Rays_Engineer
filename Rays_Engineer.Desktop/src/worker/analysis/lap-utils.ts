/** Port of LapUtils.cs: lap cleaning, track map points, mini-sector times. */
import { contactPoint, sliceLap, type LapTrace } from './lap-trace'

export const SECTOR_COUNT = 30

/**
 * Removes wrap-around artefacts at the lap boundaries: a drop in norPos of
 * more than 0.5 means samples from the neighbouring lap bled in. Drops in the
 * first half trim the start, drops in the second half trim the end.
 */
export function cleanLap(lap: LapTrace): LapTrace {
    let start = 0
    let end = lap.count
    let changed = true
    while (changed) {
        changed = false
        const len = end - start
        for (let j = 1; j < len; j++) {
            if (lap.norPos[start + j]! < lap.norPos[start + j - 1]! - 0.5) {
                if (j < len / 2) start += j
                else end = start + j
                changed = true
                break
            }
        }
    }
    return start === 0 && end === lap.count ? lap : sliceLap(lap, start, end - start)
}

export interface MapPoint {
    x: number
    z: number
    speed: number
    norPos: number
}

export function buildMapPoints(lap: LapTrace): MapPoint[] {
    const out: MapPoint[] = []
    for (let i = 0; i < lap.count; i++) {
        const cp = contactPoint(lap, i)
        if (cp) out.push({ x: cp.x, z: cp.z, speed: lap.speed[i]!, norPos: lap.norPos[i]! })
    }
    return out
}

/** Time spent (ms) in each of SECTOR_COUNT equal norPos buckets. */
export function miniSectorTimes(lap: LapTrace): Float64Array {
    const buckets = new Float64Array(SECTOR_COUNT)
    for (let i = 1; i < lap.count; i++) {
        const bi = Math.min(Math.floor(lap.norPos[i]! * SECTOR_COUNT), SECTOR_COUNT - 1)
        buckets[Math.max(0, bi)]! += lap.timeMs[i]! - lap.timeMs[i - 1]!
    }
    return buckets
}

export { formatLapTime } from '../../shared/format'
