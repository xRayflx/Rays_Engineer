/**
 * Reads and writes LMU's telemetry recording config in the telemetry folder.
 * The user's original file is backed up once before the first overwrite.
 */
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_FILE_NAME, validateTelemetryConfig, type LmuTelemetryConfig } from '../shared/telemetry-config'
import type { RecordingConfigState } from '../shared/types'

export const BACKUP_FILE_NAME = 'config.rays-backup.json'

export async function readRecordingConfig(folder: string | null): Promise<RecordingConfigState> {
    if (!folder) return { folder: null, path: null, exists: false, config: null, error: null }
    const path = join(folder, CONFIG_FILE_NAME)
    try {
        const text = await readFile(path, 'utf8')
        try {
            return { folder, path, exists: true, config: validateTelemetryConfig(JSON.parse(text)), error: null }
        } catch (err) {
            return { folder, path, exists: true, config: null, error: `Existing ${CONFIG_FILE_NAME} is not valid: ${message(err)}` }
        }
    } catch {
        return { folder, path, exists: false, config: null, error: null }
    }
}

export async function writeRecordingConfig(folder: string, config: LmuTelemetryConfig): Promise<RecordingConfigState> {
    const clean = validateTelemetryConfig(config)
    if (!(await isDir(folder))) throw new Error('Telemetry folder does not exist')

    const path = join(folder, CONFIG_FILE_NAME)
    const backup = join(folder, BACKUP_FILE_NAME)
    if ((await exists(path)) && !(await exists(backup))) await copyFile(path, backup)

    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(clean, null, 4), 'utf8')
    await rename(tmp, path)
    return readRecordingConfig(folder)
}

async function exists(p: string): Promise<boolean> {
    try { await stat(p); return true } catch { return false }
}

async function isDir(p: string): Promise<boolean> {
    try { return (await stat(p)).isDirectory() } catch { return false }
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
