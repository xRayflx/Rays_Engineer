/**
 * Lap segmentation from LMU's event tables (see docs/SCHEMA.md):
 * finish-line crossings are changes of "Current Sector" to 1; lap time and
 * validity come from "Lap Time" at the closing crossing (0 = invalid), sector
 * times from "Last Sector1" and the cumulative "Last Sector2".
 */

export interface Event {
    ts: number
    value: number
}

export type LapKind = 'lap' | 'partial'

export interface LapSegment {
    /** 0-based position within the recording. */
    index: number
    kind: LapKind
    startTs: number
    endTs: number
    /** Official lap time (valid laps) or measured crossing-to-crossing time; null for partial segments. */
    lapTimeMs: number | null
    isValid: boolean
    sector1Ms: number | null
    sector2Ms: number | null
    sector3Ms: number | null
    /** Car was in the pit lane at some point during the segment. */
    inPits: boolean
}

export interface SegmentInput {
    t0: number
    tEnd: number
    currentSector: Event[]
    lapTime: Event[]
    lastSector1: Event[]
    lastSector2: Event[]
    inPits: Event[]
}

/** Events at a crossing are written with the crossing's ts; allow for clock jitter. */
const AT_TOLERANCE_S = 0.25

/** Value in effect at time t (last event with ts ≤ t + tolerance), or `fallback`. */
export function stateAt(events: Event[], t: number, fallback = 0): number {
    let v = fallback
    for (const e of events) {
        if (e.ts <= t + AT_TOLERANCE_S) v = e.value
        else break
    }
    return v
}

function anyActive(events: Event[], from: number, to: number): boolean {
    if (stateAt(events, from) !== 0) return true
    return events.some(e => e.ts > from && e.ts < to && e.value !== 0)
}

export function finishLineCrossings(currentSector: Event[], t0: number): number[] {
    const out: number[] = []
    let prev: number | null = null
    for (const e of currentSector) {
        // The first row is the state at recording start, not a crossing.
        if (prev !== null && e.value === 1 && prev !== 1 && e.ts > t0) out.push(e.ts)
        prev = e.value
    }
    return out
}

const ms = (s: number) => Math.round(s * 1000)

export function segmentLaps(input: SegmentInput): LapSegment[] {
    const ev = (a: Event[]) => [...a].sort((x, y) => x.ts - y.ts)
    const lapTime = ev(input.lapTime)
    const s1 = ev(input.lastSector1)
    const s2 = ev(input.lastSector2)
    const pits = ev(input.inPits)
    const crossings = finishLineCrossings(ev(input.currentSector), input.t0)
    const bounds = [input.t0, ...crossings.filter(c => c < input.tEnd), input.tEnd]

    const out: LapSegment[] = []
    for (let i = 0; i < bounds.length - 1; i++) {
        const startTs = bounds[i]!
        const endTs = bounds[i + 1]!
        if (endTs - startTs <= 0) continue
        const complete = i > 0 && i < bounds.length - 2
        const base = { index: out.length, startTs, endTs, inPits: anyActive(pits, startTs, endTs) }
        if (!complete) {
            out.push({ ...base, kind: 'partial', lapTimeMs: null, isValid: false, sector1Ms: null, sector2Ms: null, sector3Ms: null })
            continue
        }
        const official = stateAt(lapTime, endTs)
        const sec1 = stateAt(s1, endTs)
        const sec12 = stateAt(s2, endTs)
        const isValid = official > 0
        out.push({
            ...base,
            kind: 'lap',
            lapTimeMs: ms(isValid ? official : endTs - startTs),
            isValid,
            sector1Ms: sec1 > 0 ? ms(sec1) : null,
            sector2Ms: sec1 > 0 && sec12 > sec1 ? ms(sec12 - sec1) : null,
            sector3Ms: isValid && sec12 > 0 && official > sec12 ? ms(official - sec12) : null,
        })
    }
    return out
}
