// Node runs these scripts with its built-in type stripping, but only resolves imports that name
// their file. The app's TypeScript (core/geometry, which assets:check measures against) imports
// without the .ts extension, as Vite and Vitest allow. Loaded with --import, this adds the
// extension to relative imports made from TypeScript files.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare =
      context.parentURL?.endsWith('.ts') &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z]+$/.test(specifier)
    return nextResolve(bare ? `${specifier}.ts` : specifier, context)
  }
})
