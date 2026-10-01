export default function EmptyState({ icon, title, children }: {
    icon: React.ReactNode
    title: string
    children?: React.ReactNode
}) {
    return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="text-fg-faint">{icon}</div>
            <h1 className="font-display text-xl font-semibold text-fg-strong" style={{ fontStretch: '118%' }}>{title}</h1>
            <div className="text-sm text-fg-muted max-w-md space-y-3">{children}</div>
        </div>
    )
}
