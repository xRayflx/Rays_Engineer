import type { WorkerEventName, WorkerMethod, WorkerMethods } from '@shared/worker-protocol'
import { useCallback, useEffect, useState } from 'react'
import { callWorker, onWorkerEvent } from './worker'

/**
 * Calls a parameterless worker method and re-runs it whenever one of
 * `refreshOn` fires. Returns the latest result plus a manual setter (for
 * methods that return fresh state themselves, e.g. after a settings change).
 */
export function useWorkerQuery<M extends WorkerMethod>(
    method: M,
    refreshOn: WorkerEventName[],
): {
    data: WorkerMethods[M]['result'] | null
    error: string | null
    refresh: () => void
    setData: (d: WorkerMethods[M]['result']) => void
} {
    const [data, setData] = useState<WorkerMethods[M]['result'] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(() => {
        callWorker(method, undefined as WorkerMethods[M]['params'])
            .then(d => { setData(d); setError(null) })
            .catch(e => setError(e instanceof Error ? e.message : String(e)))
    }, [method])

    const events = refreshOn.join('|')
    useEffect(() => {
        refresh()
        const offs = (events ? events.split('|') as WorkerEventName[] : []).map(ev => onWorkerEvent(ev, refresh))
        return () => offs.forEach(off => off())
    }, [refresh, events])

    return { data, error, refresh, setData }
}
