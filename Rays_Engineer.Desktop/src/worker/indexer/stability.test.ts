import { describe, expect, it } from 'vitest'
import { StabilityTracker } from './stability'

describe('StabilityTracker', () => {
    it('waits until size and mtime stay unchanged for the window', () => {
        const t = new StabilityTracker(10_000)
        const now = 1_000_000
        expect(t.observe('a', { size: 1, mtimeMs: now }, now)).toBe(false)
        expect(t.observe('a', { size: 2, mtimeMs: now + 3000 }, now + 3000)).toBe(false)
        expect(t.observe('a', { size: 2, mtimeMs: now + 3000 }, now + 9000)).toBe(false)
        expect(t.observe('a', { size: 2, mtimeMs: now + 3000 }, now + 13_000)).toBe(true)
    })

    it('treats files untouched for longer than the window as stable on first sight', () => {
        const t = new StabilityTracker(10_000)
        expect(t.observe('old', { size: 5, mtimeMs: 0 }, 60_000)).toBe(true)
    })

    it('forgets files that disappeared', () => {
        const t = new StabilityTracker(10_000)
        t.observe('a', { size: 1, mtimeMs: 100 }, 100)
        t.observe('b', { size: 1, mtimeMs: 100 }, 100)
        t.retain(new Set(['b']))
        expect(t.size).toBe(1)
    })
})
