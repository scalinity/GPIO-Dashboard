import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const R = 'src/renderer/src'

// SPEC 4.5 module boundaries. core/ and physics/ are pure; assistant/ reaches the app only
// through core/, native/anthropic and the AssistantContext the Claude panel injects.
const UI_AND_NATIVE = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', 'three', 'three/*'],
    message: 'Pure modules import nothing from React or rendering (SPEC 4.5).'
  },
  { group: ['@tauri-apps/*'], message: 'Pure modules import nothing from Tauri (SPEC 4.5).' }
]
const APP_LAYERS = [
  '**/api',
  '**/api.js',
  '**/native/**',
  '**/state/**',
  '**/store/**',
  '**/studio/**',
  '**/panels/**',
  '**/components/**',
  '**/pages/**',
  '**/workers/**',
  '**/assistant/**'
]
const NO_WINDOW_API = {
  selector: "MemberExpression[object.name='window'][property.name='api']",
  message: 'window.api is reachable only from UI handlers (SPEC 4.5).'
}
const DOM_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage']

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out', 'src-tauri', 'src/renderer/public'] },
  {
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    }
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      // The code base uses no PropTypes; new modules are strict TypeScript (ADR-0003).
      'react/prop-types': 'off'
    }
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: [`${R}/core/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...UI_AND_NATIVE,
            {
              group: [...APP_LAYERS, '**/physics/**'],
              message: 'core/ is the bottom layer and imports no app module (SPEC 4.5).'
            }
          ]
        }
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      'no-restricted-syntax': ['error', NO_WINDOW_API]
    }
  },
  {
    files: [`${R}/physics/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...UI_AND_NATIVE,
            {
              group: [...APP_LAYERS, '**/core/ops/**', '**/core/serialize/**'],
              message:
                'physics/ is visual only: it never imports state/, assistant/ or native/ and cannot dispatch (SPEC 4.5, 10.5).'
            }
          ]
        }
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      'no-restricted-syntax': ['error', NO_WINDOW_API]
    }
  },
  {
    files: [`${R}/assistant/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...UI_AND_NATIVE,
            {
              group: [
                '**/api',
                '**/api.js',
                '**/state/**',
                '**/store/**',
                '**/studio/**',
                '**/panels/**',
                '**/components/**',
                '**/pages/**',
                '**/workers/**',
                '**/physics/**'
              ],
              message:
                'assistant/ imports only core/, native/anthropic and its own AssistantContext (SPEC 4.5).'
            },
            {
              group: ['**/native/**', '!**/native/anthropic', '!**/native/anthropic.ts'],
              message:
                'The only native module the assistant may import is native/anthropic (SPEC 4.5).'
            }
          ]
        }
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      'no-restricted-syntax': ['error', NO_WINDOW_API]
    }
  },
  {
    // The Studio renders with WebGPURenderer and TSL only (SPEC 10.2).
    files: [`${R}/studio/**/*.{ts,tsx}`],
    rules: {
      // R3F elements take three.js properties, which this rule reads as unknown DOM attributes.
      'react/no-unknown-property': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              importNames: ['WebGLRenderer'],
              message: 'The Studio uses WebGPURenderer, never the legacy WebGLRenderer (SPEC 10.2).'
            }
          ],
          patterns: [
            {
              group: ['@react-three/drei', '@react-three/drei/*'],
              message: 'drei helpers build on GLSL ShaderMaterial; write TSL instead (SPEC 10.2).'
            }
          ]
        }
      ]
    }
  },
  {
    ...eslintPluginPrettierRecommended,
    rules: {
      ...eslintPluginPrettierRecommended.rules,
      'prettier/prettier': 'warn'
    }
  }
]
