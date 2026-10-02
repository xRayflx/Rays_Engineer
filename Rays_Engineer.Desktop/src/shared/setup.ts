/**
 * The car setup LMU stores in each recording (metadata `CarSetup`, docs/SCHEMA.md):
 * an object keyed by setting id (`VM_BRAKE_BALANCE`, `WM_CAMBER-W_FL`, …), each with
 * the garage text (`stringValue`) and its position on the setting's scale (`value`).
 */

export interface SetupEntry {
    key: string
    /** As LMU shows it in the garage, e.g. "45.0:55.0", "P3", "3.3 deg". */
    text: string
    /** Position on the setting's scale; only meaningful within one setting. */
    value: number
}

interface RawEntry {
    available?: boolean
    stringValue?: unknown
    value?: unknown
}

/** Settings this car can change, in LMU's order; null if the recording has no (readable) setup. */
export function parseSetupJson(json: string | null): SetupEntry[] | null {
    if (!json) return null
    let raw: unknown
    try { raw = JSON.parse(json) } catch { return null }
    if (!raw || typeof raw !== 'object') return null
    const out: SetupEntry[] = []
    for (const [key, e] of Object.entries(raw as Record<string, RawEntry>)) {
        if (!e || typeof e !== 'object' || e.available === false) continue
        const text = typeof e.stringValue === 'string' ? e.stringValue.trim() : ''
        out.push({ key, text, value: typeof e.value === 'number' ? e.value : 0 })
    }
    return out.length ? out : null
}
