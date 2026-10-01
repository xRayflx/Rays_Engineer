import clsx from 'clsx'
import { Plus, Tag as TagIcon, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { callWorker } from '../lib/worker'

const MAX_SUGGESTIONS = 8

/** Free-text note (saved on blur) and tags (Enter to add) for one session. */
export default function NotesTags({ sessionId, note, tags, allTags }: { sessionId: number; note: string; tags: string[]; allTags: string[] }) {
    const [text, setText] = useState(note)
    const [saved, setSaved] = useState(true)
    useEffect(() => { setText(note); setSaved(true) }, [note, sessionId])

    async function saveNote() {
        if (saved) return
        await callWorker('setSessionNote', { sessionId, body: text })
        setSaved(true)
    }
    const setTags = (next: string[]) => callWorker('setSessionTags', { sessionId, tags: next })
    function addTag(t: string) {
        const tag = t.trim()
        if (tag && !tags.some(x => x.toLowerCase() === tag.toLowerCase())) void setTags([...tags, tag])
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="section-title mr-2.5">Notes</h2>
                {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-active py-1 pl-2.5 pr-1.5 text-xs text-fg-soft">
                        {t}
                        <button aria-label={`Remove tag ${t}`} title="Remove tag" className="text-fg-subtle hover:text-fg" onClick={() => void setTags(tags.filter(x => x !== t))}><X size={12} /></button>
                    </span>
                ))}
                <TagInput tags={tags} allTags={allTags} onAdd={addTag} />
                <span className="ml-auto text-xs text-fg-subtle">Saved when you click away</span>
            </div>
            <textarea value={text} onChange={e => { setText(e.target.value); setSaved(false) }} onBlur={saveNote}
                aria-label="Session notes" placeholder="Notes — setup changes, conditions, what to try next…" rows={3}
                className="w-full flex-1 resize-y rounded-lg border border-edge-strong bg-canvas/40 px-3 py-2.5 text-[13px] leading-relaxed text-fg placeholder:text-fg-faint select-text focus:outline-none focus:ring-2 focus:ring-accent/60" />
        </>
    )
}

/** "+ tag" input with a suggestion list of existing tags (arrow keys / Enter / Escape, or click). */
function TagInput({ tags, allTags, onAdd }: { tags: string[]; allTags: string[]; onAdd: (t: string) => void }) {
    const listId = useId()
    const [input, setInput] = useState('')
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)

    const needle = input.trim().toLowerCase()
    const taken = new Set(tags.map(t => t.toLowerCase()))
    const matches = allTags
        .filter(t => !taken.has(t.toLowerCase()) && t.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.toLowerCase().startsWith(needle)) - Number(!b.toLowerCase().startsWith(needle)) || a.localeCompare(b))
        .slice(0, MAX_SUGGESTIONS)
    const canCreate = needle !== '' && !taken.has(needle) && !allTags.some(t => t.toLowerCase() === needle)
    const items: { value: string; isNew: boolean }[] = [
        ...matches.map(value => ({ value, isNew: false })),
        ...(canCreate ? [{ value: input.trim(), isNew: true }] : []),
    ]
    const show = open && items.length > 0
    const current = Math.min(active, items.length - 1)

    function pick(value: string) {
        onAdd(value)
        setInput('')
        setActive(0)
    }

    return (
        <div className="relative">
            <input value={input} placeholder="+ tag" aria-label="Add tag" role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={show ? `${listId}-${current}` : undefined}
                onChange={e => { setInput(e.target.value); setActive(0); setOpen(true) }}
                onFocus={() => setOpen(true)}
                onBlur={() => { if (input.trim()) pick(input); setOpen(false) }}
                onKeyDown={e => {
                    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setOpen(true); setActive((current + 1) % items.length) }
                    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((current - 1 + items.length) % items.length) }
                    else if (e.key === 'Enter') { e.preventDefault(); const it = show ? items[current] : null; pick(it ? it.value : input) }
                    else if (e.key === 'Escape') { setOpen(false); setInput('') }
                }}
                className="h-7 w-28 rounded-md bg-transparent px-1.5 text-xs text-fg placeholder:text-fg-faint focus:bg-canvas/40 focus:outline-none focus:ring-1 focus:ring-accent/60" />
            {show && (
                <ul id={listId} role="listbox" className="absolute left-0 top-full z-30 mt-1.5 w-56 max-h-72 overflow-y-auto rounded-xl border border-edge-strong bg-raised p-1.5 shadow-xl">
                    {items.map((it, i) => (
                        <li key={`${it.isNew}:${it.value}`} id={`${listId}-${i}`} role="option" aria-selected={i === current}
                            // mousedown keeps the input focused, so the blur handler does not add the half-typed text first
                            onMouseDown={e => { e.preventDefault(); pick(it.value) }}
                            onMouseEnter={() => setActive(i)}
                            className={clsx('flex h-[34px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px]',
                                i === current ? 'bg-hover text-fg' : 'text-fg-soft')}>
                            {it.isNew ? <Plus size={13} className="shrink-0 text-fg-faint" /> : <TagIcon size={13} className="shrink-0 text-fg-faint" />}
                            <span className="truncate">{it.isNew ? <>Create “<span className="text-fg">{it.value}</span>”</> : it.value}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
