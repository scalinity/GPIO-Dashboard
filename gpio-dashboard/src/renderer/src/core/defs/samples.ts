// Sample circuits (content/samples/*.gpiob) for the Workbench. They are small circuits of this
// app's own, not the kit's tutorials, which M4 verifies and adds under content/tutorials.
import type { CircuitDoc } from '../model/types'
import { parse } from '../serialize/gpiob'

const files = import.meta.glob<string>('../../content/samples/*.gpiob', {
  eager: true,
  query: '?raw',
  import: 'default'
})

export const SAMPLES: { id: string; doc: CircuitDoc }[] = Object.entries(files).map(
  ([file, text]) => ({ id: file.replace(/^.*\/(.+)\.gpiob$/, '$1'), doc: parse(text) })
)
