/**
 * Tracks files that may still be written by LMU. A file becomes "ready" once
 * its size and mtime have stayed unchanged for `stableMs`.
 */
export interface FileSnapshot {
    size: number
    mtimeMs: number
}

interface Entry extends FileSnapshot {
    unchangedSince: number
}

export class StabilityTracker {
    private readonly entries = new Map<string, Entry>()

    constructor(private readonly stableMs: number) {}

    /** Records the latest snapshot; returns true if the file is stable now. */
    observe(path: string, snap: FileSnapshot, now: number): boolean {
        const prev = this.entries.get(path)
        if (!prev || prev.size !== snap.size || prev.mtimeMs !== snap.mtimeMs) {
            // Files last modified long ago (e.g. on first scan) need no waiting period.
            const since = !prev ? Math.min(now, snap.mtimeMs) : now
            this.entries.set(path, { ...snap, unchangedSince: since })
            return now - since >= this.stableMs
        }
        return now - prev.unchangedSince >= this.stableMs
    }

    forget(path: string): void {
        this.entries.delete(path)
    }

    /** Drops entries for files that are no longer present. */
    retain(paths: Set<string>): void {
        for (const p of this.entries.keys()) if (!paths.has(p)) this.entries.delete(p)
    }

    get size(): number {
        return this.entries.size
    }
}
