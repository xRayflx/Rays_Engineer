import type { ImportResult } from '@shared/package'
import { callWorker } from './worker'

export type ImportOutcome = ImportResult & { sessionIds: number[] }

export async function importPaths(paths: string[]): Promise<ImportOutcome | null> {
    if (paths.length === 0) return null
    return callWorker('importFiles', { paths })
}

export function describeImport(r: ImportOutcome): string {
    const parts: string[] = []
    if (r.imported) parts.push(`${r.imported} imported`)
    if (r.duplicates) parts.push(`${r.duplicates} already in your library`)
    if (r.errors.length) parts.push(`${r.errors.length} failed: ${r.errors.map(e => e.error).join('; ')}`)
    return parts.join(' · ') || 'Nothing imported'
}
