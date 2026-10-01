const js = require('@eslint/js')
const reactHooks = require('eslint-plugin-react-hooks')
const reactRefresh = require('eslint-plugin-react-refresh')
const globals = require('globals')
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
    { ignores: ['out', 'release', 'node_modules'] },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: { ecmaVersion: 2022, globals: { ...globals.node } },
    },
    {
        files: ['src/renderer/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
        languageOptions: { globals: { ...globals.browser } },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },
    {
        files: ['*.js'],
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
)
