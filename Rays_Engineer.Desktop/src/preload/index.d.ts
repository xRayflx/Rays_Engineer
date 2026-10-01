import type { RaysApi } from '../shared/ipc'

declare global {
    interface Window {
        api: RaysApi
    }
}

export {}
