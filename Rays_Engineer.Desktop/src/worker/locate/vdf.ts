/**
 * Minimal parser for Valve's KeyValues text format (libraryfolders.vdf,
 * appmanifest_*.acf). Supports quoted/unquoted tokens, nested blocks,
 * escape sequences and // comments — enough for Steam's own files.
 */
export type VdfValue = string | VdfObject
export interface VdfObject { [key: string]: VdfValue }

export function parseVdf(text: string): VdfObject {
    const tokens = tokenize(text)
    let pos = 0

    function parseObject(depth: number): VdfObject {
        const obj: VdfObject = {}
        while (pos < tokens.length) {
            const tok = tokens[pos++]!
            if (tok.kind === 'close') {
                if (depth === 0) throw new Error('Unexpected } in VDF')
                return obj
            }
            if (tok.kind === 'open') throw new Error('Unexpected { in VDF')
            const next = tokens[pos++]
            if (!next) throw new Error(`Missing value for key "${tok.value}"`)
            if (next.kind === 'open') obj[tok.value] = parseObject(depth + 1)
            else if (next.kind === 'string') obj[tok.value] = next.value
            else throw new Error('Unexpected } in VDF')
        }
        if (depth > 0) throw new Error('Unterminated block in VDF')
        return obj
    }

    return parseObject(0)
}

type Token = { kind: 'open' } | { kind: 'close' } | { kind: 'string'; value: string }

function tokenize(text: string): Token[] {
    const out: Token[] = []
    let i = 0
    while (i < text.length) {
        const c = text[i]!
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++
        } else if (/\s/.test(c)) {
            i++
        } else if (c === '{') {
            out.push({ kind: 'open' }); i++
        } else if (c === '}') {
            out.push({ kind: 'close' }); i++
        } else if (c === '"') {
            i++
            let s = ''
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\' && i + 1 < text.length) {
                    const e = text[i + 1]!
                    s += e === 'n' ? '\n' : e === 't' ? '\t' : e
                    i += 2
                } else {
                    s += text[i++]
                }
            }
            i++ // closing quote
            out.push({ kind: 'string', value: s })
        } else {
            let s = ''
            while (i < text.length && !/[\s{}"]/.test(text[i]!)) s += text[i++]
            out.push({ kind: 'string', value: s })
        }
    }
    return out
}
