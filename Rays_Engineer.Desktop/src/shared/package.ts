/**
 * Exchange formats (ZIP containers):
 *   .rses — a whole session: manifest.json + the original recording (+ WAL)
 *   .rlap — one lap: manifest.json + a small recording with only that lap's
 *           time window, in LMU's schema and with LMU's original timestamps
 */
export const PACKAGE_FORMAT_VERSION = 1
export const MANIFEST_FILE = 'manifest.json'
export const RECORDING_FILE = 'recording.duckdb'
export const WAL_FILE = 'recording.duckdb.wal'

export type PackageFormat = 'rses' | 'rlap'

export interface ManifestLap {
    lapNumber: number
    lapTimeMs: number | null
    isValid: boolean
    sector1Ms: number | null
    sector2Ms: number | null
    sector3Ms: number | null
    /** Lap boundaries on LMU's session clock (seconds), as in the recording. */
    startTs: number
    endTs: number
}

export interface PackageManifest {
    format: PackageFormat
    formatVersion: number
    appVersion: string
    createdAt: string
    track: string | null
    trackLayout: string | null
    car: string | null
    carClass: string | null
    sessionType: string | null
    recordedAt: string | null
    /** rses: all complete laps; rlap: exactly the exported lap. */
    laps: ManifestLap[]
    files: { recording: string; wal?: string }
}

export interface ImportResult {
    imported: number
    duplicates: number
    errors: { file: string; error: string }[]
}

export function validateManifest(value: unknown): PackageManifest {
    const m = value as Partial<PackageManifest> | null
    if (!m || typeof m !== 'object') throw new Error('manifest.json is not an object')
    if (m.format !== 'rses' && m.format !== 'rlap') throw new Error('Unknown package format')
    if (typeof m.formatVersion !== 'number' || m.formatVersion > PACKAGE_FORMAT_VERSION)
        throw new Error(`Package format version ${String(m.formatVersion)} is not supported — update Rays Engineer`)
    if (!m.files || typeof m.files.recording !== 'string') throw new Error('manifest.json lists no recording')
    if (!Array.isArray(m.laps)) throw new Error('manifest.json has no laps')
    return m as PackageManifest
}
