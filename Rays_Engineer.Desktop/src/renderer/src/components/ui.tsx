import clsx from 'clsx'

/** On/off toggle (role="switch"); styled by .switch in index.css. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
            className="switch" onClick={() => onChange(!checked)}>
            <span />
        </button>
    )
}

/** Race / Qualifying / Practice pill. */
export function SessionTypeChip({ type }: { type: string | null }) {
    if (!type) return <span className="text-fg-faint">—</span>
    const t = type.toLowerCase()
    const tone = t.includes('race') ? 'bg-race-bg text-race-fg'
        : t.includes('quali') ? 'bg-quali-bg text-quali-fg'
        : 'bg-active text-fg-2'
    return <span className={clsx('chip', tone)}>{type}</span>
}

/** Short car-class badge (HY, P2, GT3); unknown classes show their own name. */
export function CarClassChip({ carClass }: { carClass: string | null }) {
    if (!carClass) return null
    const c = carClass.toLowerCase().replace(/\s/g, '')
    const [label, tone] = c.includes('hyper') ? ['HY', 'bg-hy-bg text-hy-fg']
        : c.includes('p2') ? ['P2', 'bg-p2-bg text-p2-fg']
        : c.includes('gt3') ? ['GT3', 'bg-gt3-bg text-gt3-fg']
        : [carClass, 'bg-active text-fg-2']
    return <span className={clsx('num shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', tone)} title={carClass}>{label}</span>
}

export function Tag({ children }: { children: React.ReactNode }) {
    return <span className="whitespace-nowrap rounded-full bg-active px-2 py-px text-[11px] text-fg-soft">{children}</span>
}
