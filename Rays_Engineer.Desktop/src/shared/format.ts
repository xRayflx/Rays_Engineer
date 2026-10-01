/** m:ss.mmm, e.g. 2:03.568 */
export function formatLapTime(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—'
    const total = Math.round(ms)
    const m = Math.floor(total / 60_000)
    const s = Math.floor((total % 60_000) / 1000)
    return `${m}:${String(s).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`
}

/** s.mmm for sector times, m:ss.mmm above a minute. */
export function formatSectorTime(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—'
    if (ms >= 60_000) return formatLapTime(ms)
    return (ms / 1000).toFixed(3)
}

/** Signed delta in seconds, e.g. +0.412 / −1.030 */
export function formatDelta(ms: number): string {
    return `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(3)}`
}

/** RecordingTime as LMU writes it in metadata and file names ("2026-09-18T14_44_00Z") → ISO 8601. */
export function parseRecordingTime(s: string | null | undefined): string | null {
    const m = s?.match(/(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})Z/)
    return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : null
}
