// Tutorials from content/tutorials/<id>/: doc.gpiob, tutorial.json and theory.md (SPEC 13.1).
import type { CircuitDoc } from '../model/types'
import { parse } from '../serialize/gpiob'
import { TutorialMetaSchema, type TutorialMeta } from '../tutorials/tutorial'

const glob = (pattern: 'doc.gpiob' | 'tutorial.json' | 'theory.md') => {
  const all = {
    'doc.gpiob': import.meta.glob<string>('../../content/tutorials/*/doc.gpiob', {
      eager: true,
      query: '?raw',
      import: 'default'
    }),
    'tutorial.json': import.meta.glob<string>('../../content/tutorials/*/tutorial.json', {
      eager: true,
      query: '?raw',
      import: 'default'
    }),
    'theory.md': import.meta.glob<string>('../../content/tutorials/*/theory.md', {
      eager: true,
      query: '?raw',
      import: 'default'
    })
  }[pattern]
  return new Map(Object.entries(all).map(([file, text]) => [file.split('/').at(-2)!, text]))
}

export interface Tutorial {
  meta: TutorialMeta
  doc: CircuitDoc
  theory: string
}

const docs = glob('doc.gpiob')
const theories = glob('theory.md')

/** Every tutorial, in curriculum order. */
export const TUTORIALS: Tutorial[] = [...glob('tutorial.json')]
  .map(([dir, text]) => {
    const parsed = TutorialMetaSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new Error(`tutorials/${dir}/tutorial.json: ${parsed.error.message}`)
    if (parsed.data.id !== dir) throw new Error(`tutorials/${dir}: the id must be ${dir}`)
    const doc = docs.get(dir)
    const theory = theories.get(dir)
    if (!doc || theory === undefined)
      throw new Error(`tutorials/${dir}: needs doc.gpiob and theory.md`)
    return { meta: parsed.data, doc: parse(doc), theory }
  })
  .sort((a, b) => a.meta.order - b.meta.order)
