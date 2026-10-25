# Versions

New dependencies and tools added by v2, with the reason for each version. Rule: the
latest stable release, except Blender, which stays on the LTS (SPEC 3.2). Versions were
checked with `npm view <pkg> version` or the tool's `--version` on 2026-10-23.

## Tools (build time, never shipped)

| Tool | Version | Reason |
|------|---------|--------|
| Blender | 5.2.2 LTS | SPEC 3.2 pins the 5.2 LTS. Already installed at `/Applications/Blender.app` |
| KTX-Software (`toktx`, `ktx`) | 4.4.2 | latest release; KTX2 encoding for gltf-transform (ADR-0005), which runs `ktx create` |
| ngspice | 47 | latest Homebrew bottle; simulator reference outputs (SPEC 9) |

## npm dev dependencies

| Package | Version | Reason |
|---------|---------|--------|
| typescript | 6.0.3 | newest release supported by typescript-eslint (ADR-0007); 7.0.2 is latest overall |
| typescript-eslint | ^8.72.0 | latest; TS linting and boundary rules (SPEC 4.5) |
| vitest | ^5.0.5 | latest; TypeScript tests (SPEC 3.2) |
| @types/react, @types/react-dom | ^19.3.0 | latest; match React 19 |
| @types/node | ^26.6.5 | latest; Node 26 runtime for tests and scripts |
| occt-import-js | 0.0.23 | latest; reads STEP for the asset pipeline (SPEC 3.2, 10.3). LGPL-2.1, build time only |
| @gltf-transform/core, extensions, functions, cli | ^4.5.1 | latest; dedup, weld, prune, meshopt and KTX2 (SPEC 10.3). The cli package holds the KTX2 transform |
| meshoptimizer | ^1.3.0 | latest; meshopt encoder and decoder for gltf-transform |
| sharp | ^0.35.5 | latest; gltf-transform's KTX2 transform needs it to resize textures to budget |
| @types/three | ^0.186.0 | latest; matches three 0.186 (checked 2026-10-24) |
| @playwright/test | ^1.64.1 | latest; Studio e2e in Chromium (SPEC 18). Its browser is Chromium 156.0.8078.4 (revision 1248), installed with `npx playwright install chromium` |

## npm dependencies

| Package | Version | Reason |
|---------|---------|--------|
| three | ^0.186.1 | latest (checked 2026-10-24); WebGPURenderer, TSL and `RenderPipeline` (named `PostProcessing` before r183, which 0.186 keeps only as a deprecated alias) |
| @react-three/fiber | ^9.8.2 | latest stable (10.x is alpha); its async `gl` factory awaits `WebGPURenderer.init()`, and it supports React 19.0–19.3 |

## Shipped files

| File | Version | Reason |
|------|---------|--------|
| `src/renderer/public/basis/basis_transcoder.{js,wasm}` | as shipped in three 0.186.1 (`examples/jsm/libs/basis`) | KTX2Loader's transcoder (Basis Universal, Apache-2.0). A test fails if the copy differs from the installed three's |

## npm dependencies

| Package | Version | Reason |
|---------|---------|--------|
| @anthropic-ai/sdk | 1.3.0 (exact) | latest 1.x (checked 2026-10-24); pinned exactly because the assistant imports the SDK's private `_vendor/partial-json-parser`, which a minor release may move; sends `anthropic-version: 2026-10-21` and `Authorization: Bearer`, and its request types carry no temperature, top_p or top_k (SPEC 12.1). The assistant builds it with a placeholder key and `nativeAnthropicFetch` (ADR-0083) |

## Rust

No new crates in M0. `tokio` gains the `net` and `io-util` features for the production
loopback server (ADR-0008).

Later milestones add rows here as dependencies arrive.
