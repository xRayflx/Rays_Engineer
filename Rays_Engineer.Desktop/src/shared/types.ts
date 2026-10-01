/** Domain types shared by worker and renderer. */

export type SessionOrigin = 'lmu' | 'import'

/** unparsed = indexed by file only (telemetry reader not run yet), parsed = metadata + laps known. */
export type SessionStatus = 'unparsed' | 'parsed' | 'error'

export interface SessionRow {
    id: number
    filePath: string
    fileName: string
    fileHash: string
    fileSize: number
    fileMtimeMs: number
    origin: SessionOrigin
    /** Format of the imported package (from its manifest); null for LMU recordings and plain .duckdb imports. */
    packageFormat: 'rses' | 'rlap' | null
    archivedPath: string | null
    /** Original file no longer exists at filePath. */
    fileMissing: boolean
    status: SessionStatus
    error: string | null
    track: string | null
    trackLayout: string | null
    car: string | null
    carClass: string | null
    driver: string | null
    sessionType: string | null
    weather: string | null
    recordedAt: string | null
    trackLengthM: number | null
    lapCount: number | null
    bestLapMs: number | null
    indexedAt: string
    tags: string[]
    /** User's session note ('' if none). */
    note: string
    /** Number of laps with a user note. */
    lapNoteCount: number
}

export type FolderSource = 'steam' | 'documents' | 'manual'

export interface FolderCandidate {
    path: string
    source: FolderSource
    exists: boolean
    /** Number of .duckdb files directly inside the folder (0 if it does not exist). */
    duckdbCount: number
}

export interface TelemetryFolderSetting {
    mode: 'auto' | 'manual'
    /** Only used in manual mode. */
    path: string | null
}

export interface IndexStatus {
    folderSetting: TelemetryFolderSetting
    /** Folder currently watched, null if none found / configured path missing. */
    activeFolder: string | null
    activeFolderExists: boolean
    candidates: FolderCandidate[]
    /** Files seen in the folder that are still being written (waiting to become stable). */
    pendingFiles: number
    sessionCount: number
    archiveSessions: boolean
    lastScanAt: string | null
    lastError: string | null
}

export interface InspectColumn {
    name: string
    type: string
    min?: unknown
    max?: unknown
    nonNull?: number
}

export interface InspectTable {
    name: string
    rowCount: number
    columns: InspectColumn[]
    /** All rows for small tables, otherwise null. */
    rows: Record<string, unknown>[] | null
    head: Record<string, unknown>[]
    tail: Record<string, unknown>[]
}

export interface InspectReport {
    file: string
    fileSize: number
    duckdbLibraryVersion: string
    generatedAt: string
    tables: InspectTable[]
}

export interface RecordingConfigState {
    /** Telemetry folder the config belongs to (null if none is active). */
    folder: string | null
    path: string | null
    exists: boolean
    /** Parsed config, null if missing or invalid. */
    config: import('./telemetry-config').LmuTelemetryConfig | null
    error: string | null
}

export interface AutoRecordState {
    /** Path of LMU's Settings.JSON derived from the telemetry folder (null if not derivable). */
    settingsPath: string | null
    exists: boolean
    /** "Automatically Record Telemetry"; null if unknown. */
    enabled: boolean | null
    error: string | null
}

export interface LapRow {
    id: number
    sessionId: number
    lapNumber: number
    kind: 'lap' | 'partial'
    lapTimeMs: number | null
    sector1Ms: number | null
    sector2Ms: number | null
    sector3Ms: number | null
    isValid: boolean
    inPits: boolean
    startTs: number
    endTs: number
    /** This lap is the reference for its track + car. */
    isReference: boolean
    /** User's note on this lap ('' if none). */
    note: string
}

export interface ReferenceLap {
    track: string
    car: string
    lapId: number
    lapTimeMs: number | null
    sessionId: number
}
