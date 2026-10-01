/** Analysis payloads worker → renderer. Arrays are typed so they travel as binary. */

export interface CornerInfo {
    number: number
    entryM: number
    apexM: number
    exitM: number
    minSpeedKmh: number
    entrySpeedKmh: number
    exitSpeedKmh: number
    brakeM: number | null
    throttleM: number | null
    isLeft: boolean
    peakGLat: number
}

export interface ChannelOption {
    name: string
    unit: string
    wheels: boolean
}

/** Conditions during a lap (docs/SCHEMA.md, "Conditions"); null = not recorded. */
export interface LapConditions {
    /** In-game time of day at the lap start, "HH:MM". */
    timeOfDay: string | null
    weather: string | null
    /** Means over the lap, °C. */
    trackTempC: number | null
    airTempC: number | null
    /** Highest "Minimum Path Wetness" during the lap, %. */
    wetnessPct: number | null
    windKmh: number | null
}

export interface LapAnalysis {
    lapId: number
    sessionId: number
    lapNumber: number
    lapTimeMs: number | null
    isValid: boolean
    track: string | null
    car: string | null
    sessionType: string | null
    recordedAt: string | null
    stepM: number
    /** Distance grid in metres from the finish line. */
    distM: Float32Array
    timeMs: Float32Array
    speed: Float32Array
    throttle: Float32Array
    brake: Float32Array
    steer: Float32Array
    gear: Float32Array
    /** Track map in metres (east, north) on the same grid. */
    mapX: Float32Array
    mapY: Float32Array
    /** Time delta to the reference lap (ms, positive = slower); null for the reference itself. */
    deltaMs: Float32Array | null
    corners: CornerInfo[]
    conditions: LapConditions
    /** Requested extra channels on the distance grid: 1 array, or 4 for wheel channels (FL, FR, RL, RR). */
    extra: Record<string, Float32Array[]>
}

export interface AnalysisResult {
    trackLengthM: number | null
    referenceLapId: number
    laps: LapAnalysis[]
    /** Continuous channels recorded in the reference lap's session, for the "+ Channel" picker. */
    channels: ChannelOption[]
}
