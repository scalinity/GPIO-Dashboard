import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { partialObject } from './partialJson'

/** Everything in `part` is in `whole`: keys, values and array prefixes. */
function within(part: unknown, whole: unknown): boolean {
  if (Array.isArray(part))
    return (
      Array.isArray(whole) &&
      part.length <= whole.length &&
      part.every((v, i) => within(v, whole[i]))
    )
  if (typeof part === 'object' && part !== null)
    return (
      typeof whole === 'object' &&
      whole !== null &&
      Object.entries(part).every(
        ([k, v]) => k in whole && within(v, (whole as Record<string, unknown>)[k])
      )
    )
  return part === whole
}

describe('partialObject', () => {
  it('keeps only what has fully arrived', () => {
    const full =
      '{"defId":"resistor","at":"bb1:30b","props":[{"name":"resistance","value":220}],"span":4}'
    expect(partialObject('')).toBeNull()
    expect(partialObject('{"defI')).toEqual({})
    expect(partialObject('{"defId":"resi')).toEqual({})
    expect(partialObject('{"defId":"resistor","at":"bb1:3')).toEqual({ defId: 'resistor' })
    expect(partialObject('{"defId":"resistor","props":[{"name":"resistance","value":22')).toEqual({
      defId: 'resistor',
      props: [{ name: 'resistance' }]
    })
    expect(partialObject(full)).toEqual(JSON.parse(full))
  })

  it('is null for what is not an object, and never throws', () => {
    expect(partialObject('[1,2')).toBeNull()
    expect(partialObject('not json')).toBeNull()
    expect(partialObject('{"a":1}}')).toBeNull()
  })

  it('never shows anything the finished input does not have, and only grows', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
        const text = JSON.stringify(value)
        let previous: unknown = {}
        for (let i = 0; i <= text.length; i++) {
          const snapshot = partialObject(text.slice(0, i))
          if (snapshot === null) continue
          expect(within(snapshot, JSON.parse(text)), text.slice(0, i)).toBe(true)
          expect(within(previous, snapshot), text.slice(0, i)).toBe(true)
          previous = snapshot
        }
        expect(partialObject(text)).toEqual(JSON.parse(text))
      }),
      { numRuns: 200 }
    )
  })
})
