// The control column's first row (SPEC 10.7, ADR-0143): the View, the Lab look or the Studio look.
// L switches it too; the choice is kept on this machine.
import { setLook, useStudio } from '../state/studioStore'
import type { LookName } from '../studio/look'

const LOOKS: [LookName, string][] = [
  ['lab', 'Lab'],
  ['studio', 'Studio']
]

export default function LookSwitch() {
  const look = useStudio((s) => s.look)
  return (
    <section aria-label="View" className="space-y-2">
      <h2 className="section-title">View</h2>
      <div role="group" aria-label="Look" className="flex gap-1">
        {LOOKS.map(([name, label]) => (
          <button
            key={name}
            className={`tab-button ${look === name ? 'active' : ''}`}
            aria-pressed={look === name}
            title={`The ${label} look (L switches)`}
            onClick={() => setLook(name)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}
