// Divergence badges (SPEC 11.5, 14.4, 14.5): one small marker in the Studio per place where the real
// board stands apart from the document, each opening its explanation. Two sources feed them:
// telemetry (a pin's live state against what the document and its code expect, liveCheck.ts) and
// Board Sense (a net whose measured bias differs from its prediction, with the ranked causes).
import type { HoleRef } from '../core/model/types'
import type { Ranked } from '../core/sense/candidates'
import type { NetState } from '../core/sense/sense'
import type { LiveDivergence } from './liveCheck'

export interface Badge {
  /** `live:<kind>:<bcm>` or `sense:<bcm>`. */
  id: string
  source: 'live' | 'sense'
  bcm: number
  severity: 'error' | 'warning'
  /** One line, on the card's heading and the badge's accessible name. */
  title: string
  /** What differs. */
  why: string
  /** The likeliest reason, in words; the ranked causes for Board Sense follow it. */
  cause: string
  causes: { text: string; holes: HoleRef[] }[]
  /** Parts of the document involved. */
  refs: string[]
}

export function liveBadges(divergences: LiveDivergence[]): Badge[] {
  return divergences.map((d) => ({
    id: `live:${d.id}`,
    source: 'live',
    bcm: d.bcm,
    severity: d.severity,
    title: d.title,
    why: d.why,
    cause: d.cause,
    causes: [],
    refs: d.refs
  }))
}

const KIND_TEXT = {
  'missing-path': 'a path is missing',
  'extra-path': 'there is a path the document lacks',
  'wrong-level': 'it reads the wrong level',
  'gpio-short': 'two GPIOs are joined'
} as const

/** The nets Board Sense found diverged, with the causes it has ranked for each (at most three). */
export function senseBadges(
  states: [number, NetState][],
  candidates: Record<number, Ranked[] | 'working'>
): Badge[] {
  return states.flatMap(([pin, state]) => {
    if (state.state !== 'diverged') return []
    const ranked = candidates[pin]
    const causes = Array.isArray(ranked)
      ? ranked.slice(0, 3).map((group) => ({
          text: group.candidates.map((c) => c.text).join('; or '),
          holes: group.candidates[0]?.holes ?? []
        }))
      : []
    return [
      {
        id: `sense:${pin}`,
        source: 'sense' as const,
        bcm: pin,
        severity: 'error' as const,
        title: `GPIO${pin}: ${KIND_TEXT[state.kind]}`,
        why: `Board Sense measured it: ${state.detail}`,
        cause:
          ranked === 'working'
            ? 'Finding the likely causes…'
            : causes.length
              ? 'The likeliest causes, best first:'
              : 'No single-fault edit of the document explains it.',
        causes,
        refs: []
      }
    ]
  })
}

/** What decides which badges the Studio shows. */
export interface BadgeInputs {
  /** The Inspect toggles: Live Pi state, and Board Sense's overlay. */
  live: boolean
  senseOverlay: boolean
  online: boolean
  divergences: LiveDivergence[]
  senseMode: 'off' | 'pi' | 'mock'
  senseStates: [number, NetState][]
  candidates: Record<number, Ranked[] | 'working'>
  /** Build Mode is on and the bench shows a build in progress. */
  building: boolean
  /** Build Mode is on at all. */
  buildMode: boolean
}

/**
 * The badges to show. Both compare the real board with the finished document, so a bench drawn
 * as built so far shows none; Board Sense's also stay off throughout Build Mode, whose step card
 * reports what the sweeps say of the step in hand.
 */
export function activeBadges(i: BadgeInputs): Badge[] {
  return [
    ...(i.live && i.online && !i.building ? liveBadges(i.divergences) : []),
    ...(i.senseOverlay && i.senseMode !== 'off' && !i.buildMode
      ? senseBadges(i.senseStates, i.candidates)
      : [])
  ]
}
