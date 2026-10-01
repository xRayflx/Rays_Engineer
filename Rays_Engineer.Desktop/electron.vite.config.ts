import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        resolve: { alias: { '@shared': shared } },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        resolve: { alias: { '@shared': shared } },
    },
    renderer: {
        root: resolve(__dirname, 'src/renderer'),
        plugins: [react()],
        resolve: {
            alias: {
                '@shared': shared,
                '@': resolve(__dirname, 'src/renderer/src'),
            },
        },
    },
})
