import { describe, expect, it } from 'vitest'
import { parseVdf } from './vdf'

describe('parseVdf', () => {
    it('parses nested libraryfolders with escaped paths and comments', () => {
        const text = `
        // comment
        "libraryfolders"
        {
            "0"
            {
                "path"      "C:\\\\Program Files (x86)\\\\Steam"
                "apps"
                {
                    "228980"    "123"
                }
            }
            "1"
            {
                "path"      "D:\\\\SteamLibrary"
            }
        }`
        const vdf = parseVdf(text)
        const folders = vdf['libraryfolders'] as Record<string, Record<string, unknown>>
        expect(folders['0']!['path']).toBe('C:\\Program Files (x86)\\Steam')
        expect(folders['1']!['path']).toBe('D:\\SteamLibrary')
        expect((folders['0']!['apps'] as Record<string, string>)['228980']).toBe('123')
    })

    it('supports unquoted tokens', () => {
        expect(parseVdf('AppState { installdir Foo }')).toEqual({ AppState: { installdir: 'Foo' } })
    })

    it('rejects unbalanced input', () => {
        expect(() => parseVdf('"a" { "b" "c"')).toThrow()
        expect(() => parseVdf('}')).toThrow()
    })
})
