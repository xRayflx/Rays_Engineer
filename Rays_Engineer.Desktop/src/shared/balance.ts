/**
 * Understeer / oversteer estimate.
 *
 * LMU records no yaw rate or tyre slip (docs/SCHEMA.md), so balance is
 * estimated from the steering the driver used against the steering the car
 * normally needs for the path it drove: path curvature κ comes from the GPS
 * line, and the "normal" steering per curvature is fitted on the reference
 * lap as steer/κ = a + b·v² + c·|κ| (v² absorbs the car's usual understeer
 * gradient, |κ| the non-linear steering at hairpins). Balance is relative to
 * that baseline, in % of steering lock:
 *   < 0  more lock than usual → front sliding (understeer)
 *   > 0  less or opposite lock → rear stepping out (oversteer)
 */

/** Below this curvature (radius > 600 m) the car is on a straight and balance is undefined. */
const MIN_CURVATURE = 1 / 600
const MIN_SPEED_KMH = 30
/** Smoothing of position and steering before differentiating, metres. */
const SMOOTH_M = 12

export interface SteerModel {
    a: number
    b: number
    c: number
}

export interface BalanceInput {
    stepM: number
    speed: Float32Array
    steer: Float32Array
    mapX: Float32Array
    mapY: Float32Array
}

function movingAverage(v: Float32Array, half: number): Float32Array {
    const n = v.length
    const out = new Float32Array(n)
    let sum = 0
    let lo = 0
    let hi = -1
    for (let i = 0; i < n; i++) {
        const want = Math.min(n - 1, i + half)
        while (hi < want) sum += v[++hi]!
        while (lo < i - half) sum -= v[lo++]!
        out[i] = sum / (hi - lo + 1)
    }
    return out
}

/** Signed path curvature in 1/m; positive = right-hand (clockwise on the map). */
export function pathCurvature(x: Float32Array, y: Float32Array, stepM: number): Float32Array {
    const half = Math.max(1, Math.round(SMOOTH_M / stepM))
    const xs = movingAverage(x, half)
    const ys = movingAverage(y, half)
    const n = xs.length
    const heading = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1)
        const b = Math.min(n - 1, i + 1)
        heading[i] = Math.atan2(ys[b]! - ys[a]!, xs[b]! - xs[a]!)
    }
    const k = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - half)
        const b = Math.min(n - 1, i + half)
        let d = heading[b]! - heading[a]!
        if (d > Math.PI) d -= 2 * Math.PI
        if (d < -Math.PI) d += 2 * Math.PI
        k[i] = b > a ? -d / ((b - a) * stepM) : 0
    }
    return k
}

/** The path follows a steering input after roughly this distance (best fit on Bahrain and Spa samples). */
const STEER_LEAD_M = 4

/**
 * Steering smoothed exactly like the curvature (position average, then a heading
 * difference over the same span) and shifted by the lead, so the input lines up
 * with the part of the path it causes.
 */
function smoothSteer(steer: Float32Array, stepM: number): Float32Array {
    const half = Math.max(1, Math.round(SMOOTH_M / stepM))
    const s = movingAverage(movingAverage(steer, half), half)
    const lead = Math.round(STEER_LEAD_M / stepM)
    if (!lead) return s
    const out = new Float32Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s[Math.max(0, i - lead)]!
    return out
}

const ratioOf = (m: SteerModel, v2: number, absK: number) => m.a + m.b * v2 + m.c * absK

/** Least squares of r = a + b·u + c·w (normal equations, Cramer's rule). */
function fit(u: number[], w: number[], r: number[]): SteerModel | null {
    let n = 0, su = 0, sw = 0, suu = 0, sww = 0, suw = 0, sr = 0, sur = 0, swr = 0
    for (let i = 0; i < r.length; i++) {
        n++; su += u[i]!; sw += w[i]!; suu += u[i]! ** 2; sww += w[i]! ** 2; suw += u[i]! * w[i]!
        sr += r[i]!; sur += u[i]! * r[i]!; swr += w[i]! * r[i]!
    }
    const det3 = (m: number[][]) =>
        m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)
        - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)
        + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
    const A = [[n, su, sw], [su, suu, suw], [sw, suw, sww]]
    const y = [sr, sur, swr]
    const d = det3(A)
    if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null
    const col = (j: number) => det3(A.map((row, i) => row.map((v, k) => (k === j ? y[i]! : v)))) / d
    return { a: col(0), b: col(1), c: col(2) }
}

/** Fits the car's usual steering per curvature on one lap (normally the reference). Null if the lap has too few corners. */
export function fitSteerModel(lap: BalanceInput): SteerModel | null {
    const k = pathCurvature(lap.mapX, lap.mapY, lap.stepM)
    const steer = smoothSteer(lap.steer, lap.stepM)
    let u: number[] = []
    let w: number[] = []
    let r: number[] = []
    for (let i = 0; i < k.length; i++) {
        const v = lap.speed[i]!
        if (Math.abs(k[i]!) < MIN_CURVATURE || v < MIN_SPEED_KMH || Math.sign(steer[i]!) !== Math.sign(k[i]!)) continue
        u.push((v / 3.6) ** 2)
        w.push(Math.abs(k[i]!))
        r.push(steer[i]! / k[i]!)
    }
    if (r.length < 50) return null
    // Two passes with outliers (slides, kerbs, GPS glitches) trimmed by the median absolute residual.
    let m = fit(u, w, r)
    for (let pass = 0; pass < 2 && m; pass++) {
        const model = m
        const res = r.map((x, i) => Math.abs(x - ratioOf(model, u[i]!, w[i]!)))
        const mad = [...res].sort((a, b) => a - b)[res.length >> 1]!
        const keep = res.map(e => e <= 2.5 * mad)
        u = u.filter((_, i) => keep[i])
        w = w.filter((_, i) => keep[i])
        r = r.filter((_, i) => keep[i])
        m = fit(u, w, r)
    }
    return m
}

/** Within ±this many % of lock the car counts as neutral. */
export const NEUTRAL_BAND = 5

export type BalanceClass = 'under' | 'neutral' | 'over'

export function classify(v: number): BalanceClass {
    return v > NEUTRAL_BAND ? 'over' : v < -NEUTRAL_BAND ? 'under' : 'neutral'
}

/** Mean balance between two distances, ignoring straights; null if nothing was measured there. */
export function meanBalance(balance: Float32Array, stepM: number, fromM: number, toM: number): number | null {
    let sum = 0
    let n = 0
    for (let i = Math.max(0, Math.round(fromM / stepM)); i <= Math.min(balance.length - 1, Math.round(toM / stepM)); i++) {
        if (Number.isFinite(balance[i]!)) { sum += balance[i]!; n++ }
    }
    return n ? sum / n : null
}

/** Half-width of the apex ("mid") phase, metres. */
const MID_HALF_M = 15

export interface CornerPhases {
    entry: number | null
    mid: number | null
    exit: number | null
}

/** Entry (turn-in to apex), mid (around the apex) and exit (apex to exit) balance of one corner. */
export function cornerPhases(balance: Float32Array, stepM: number, corner: { entryM: number; apexM: number; exitM: number }): CornerPhases {
    const midFrom = corner.apexM - MID_HALF_M
    const midTo = corner.apexM + MID_HALF_M
    return {
        entry: meanBalance(balance, stepM, Math.min(corner.entryM, midFrom - stepM), midFrom - stepM),
        mid: meanBalance(balance, stepM, midFrom, midTo),
        exit: meanBalance(balance, stepM, midTo + stepM, Math.max(corner.exitM, midTo + stepM)),
    }
}

/** A moment counts when balance stays past these limits for MIN_MOMENT_M. */
export const OVER_LIMIT = 10
export const UNDER_LIMIT = -12
const MIN_MOMENT_M = 10

export interface BalanceMoment {
    kind: 'under' | 'over'
    /** Where the slide peaked, metres from the finish line. */
    atM: number
    fromM: number
    toM: number
    /** Peak balance, % of lock. */
    peak: number
}

/** Stretches of clear understeer or oversteer, in lap order. */
export function balanceMoments(balance: Float32Array, stepM: number): BalanceMoment[] {
    const out: BalanceMoment[] = []
    let start = -1
    let kind: 'under' | 'over' | null = null
    const close = (end: number) => {
        if (kind && (end - start + 1) * stepM >= MIN_MOMENT_M) {
            let peakI = start
            for (let i = start; i <= end; i++) if (Math.abs(balance[i]!) > Math.abs(balance[peakI]!)) peakI = i
            out.push({ kind, atM: peakI * stepM, fromM: start * stepM, toM: end * stepM, peak: balance[peakI]! })
        }
        kind = null
    }
    for (let i = 0; i <= balance.length; i++) {
        const v = i < balance.length ? balance[i]! : NaN
        const k = v > OVER_LIMIT ? 'over' : v < UNDER_LIMIT ? 'under' : null
        if (k !== kind) {
            close(i - 1)
            if (k) { kind = k; start = i }
        }
    }
    return out
}

/** Balance per grid point in % of steering lock; NaN on straights and at very low speed. */
export function balanceTrace(lap: BalanceInput, model: SteerModel): Float32Array {
    const k = pathCurvature(lap.mapX, lap.mapY, lap.stepM)
    const steer = smoothSteer(lap.steer, lap.stepM)
    const out = new Float32Array(k.length)
    for (let i = 0; i < k.length; i++) {
        const v = lap.speed[i]!
        if (Math.abs(k[i]!) < MIN_CURVATURE || v < MIN_SPEED_KMH) { out[i] = NaN; continue }
        const needed = k[i]! * ratioOf(model, (v / 3.6) ** 2, Math.abs(k[i]!))
        out[i] = Math.sign(k[i]!) * (needed - steer[i]!)
    }
    return out
}
