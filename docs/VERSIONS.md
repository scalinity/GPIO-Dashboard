# Versions

New dependencies and tools added by v2, with the reason for each version. Rule: the
latest stable release, except Blender, which stays on the LTS (SPEC 3.2). Versions were
checked with `npm view <pkg> version` or the tool's `--version` on 2026-10-23.

## Tools (build time, never shipped)

| Tool | Version | Reason |
|------|---------|--------|
| Blender | 5.2.2 LTS | SPEC 3.2 pins the 5.2 LTS. Already installed at `/Applications/Blender.app` |
| KTX-Software (`toktx`, `ktx`) | 4.4.2 | latest release; KTX2 encoding for gltf-transform (ADR-0005) |
| ngspice | 47 | latest Homebrew bottle; simulator reference outputs (SPEC 9) |

## npm dev dependencies

| Package | Version | Reason |
|---------|---------|--------|
| typescript | 6.0.3 | newest release supported by typescript-eslint (ADR-0007); 7.0.2 is latest overall |
| typescript-eslint | ^8.72.0 | latest; TS linting and boundary rules (SPEC 4.5) |
| vitest | ^5.0.5 | latest; TypeScript tests (SPEC 3.2) |
| @types/react, @types/react-dom | ^19.3.0 | latest; match React 19 |
| @types/node | ^26.6.5 | latest; Node 26 runtime for tests and scripts |

Later milestones add rows here as dependencies arrive.
