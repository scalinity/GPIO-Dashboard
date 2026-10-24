// Divergence badges (SPEC 14.4, 14.5): which are shown, and what each says.
import { describe, expect, it } from 'vitest'
import type { Ranked } from '../core/sense/candidates'
import type { NetState } from '../core/sense/sense'
import { activeBadges, type BadgeInputs, liveBadges, senseBadges } from './badges'
import type { LiveDivergence } from './liveCheck'

const divergence: LiveDivergence = {
  id: 'drives-input:18',
  bcm: 18,
  kind: 'drives-input',
  severity: 'error',
  title: 'GPIO18 is driven as an output',
  why: 'why',
  cause: 'cause',
  refs: ['SW1']
}
const diverged: [number, NetState] = [
  17,
  {
    state: 'diverged',
    kind: 'missing-path',
    detail: 'GPIO17 reads follows-bias, expected tied-high'
  }
]
const ranked: Ranked = {
  candidates: [
    {
      text: 'lead W1 end moved one row',
      holes: [{ board: 'bb1', area: 'main', row: 30, col: 'a' }]
    }
  ],
  score: 5,
  of: 6
}

const inputs = (over: Partial<BadgeInputs> = {}): BadgeInputs => ({
  live: true,
  senseOverlay: true,
  online: true,
  divergences: [divergence],
  senseMode: 'mock',
  senseStates: [diverged, [18, { state: 'matched' }]],
  candidates: { 17: [ranked] },
  building: false,
  buildMode: false,
  ...over
})

describe('divergence badges', () => {
  it('turns a telemetry divergence into a badge that carries its explanation', () => {
    expect(liveBadges([divergence])).toEqual([
      {
        id: 'live:drives-input:18',
        source: 'live',
        bcm: 18,
        severity: 'error',
        title: 'GPIO18 is driven as an output',
        why: 'why',
        cause: 'cause',
        causes: [],
        refs: ['SW1']
      }
    ])
  })

  it('turns a diverged net into a badge with its ranked causes and their holes', () => {
    const [badge] = senseBadges([diverged, [18, { state: 'matched' }]], { 17: [ranked] })
    expect(badge).toMatchObject({
      id: 'sense:17',
      source: 'sense',
      bcm: 17,
      title: 'GPIO17: Board Sense says a path is missing',
      why: 'GPIO17 reads follows-bias, expected tied-high',
      causes: [{ text: 'lead W1 end moved one row', holes: ranked.candidates[0]!.holes }]
    })
  })

  it('says so while the causes are still being worked out, and when there are none', () => {
    expect(senseBadges([diverged], { 17: 'working' })[0]!.cause).toContain('Finding')
    expect(senseBadges([diverged], {})[0]!.cause).toContain('No single-fault')
  })

  it('gives a matched, unobserved or settling net no badge', () => {
    const states: [number, NetState][] = [
      [17, { state: 'matched' }],
      [18, { state: 'unobserved' }],
      [22, { state: 'settling' }]
    ]
    expect(senseBadges(states, {})).toEqual([])
  })

  it('shows both sources when Live Pi state and Board Sense are on', () => {
    expect(activeBadges(inputs()).map((b) => b.id)).toEqual(['live:drives-input:18', 'sense:17'])
  })

  it('shows the telemetry badges only while Live Pi state is on and the Pi is there', () => {
    expect(activeBadges(inputs({ live: false })).map((b) => b.id)).toEqual(['sense:17'])
    expect(activeBadges(inputs({ online: false })).map((b) => b.id)).toEqual(['sense:17'])
  })

  it('shows Board Sense’s only while its overlay is on and sensing runs', () => {
    expect(activeBadges(inputs({ senseOverlay: false })).map((b) => b.id)).toEqual([
      'live:drives-input:18'
    ])
    expect(activeBadges(inputs({ senseMode: 'off' })).map((b) => b.id)).toEqual([
      'live:drives-input:18'
    ])
  })

  it('shows none against a bench drawn as built so far, and Board Sense’s none in Build Mode', () => {
    expect(activeBadges(inputs({ building: true, buildMode: true }))).toEqual([])
    expect(activeBadges(inputs({ buildMode: true })).map((b) => b.id)).toEqual([
      'live:drives-input:18'
    ])
  })
})
