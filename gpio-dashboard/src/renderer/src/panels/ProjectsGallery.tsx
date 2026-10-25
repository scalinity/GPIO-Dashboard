// The projects gallery (SPEC 11.9): every .gpiob file in the app data folder, newest first.
import { FolderOpen, X } from 'lucide-react'
import { closeGallery, openProject, useProject } from '../state/projectStore'

export default function ProjectsGallery() {
  const gallery = useProject((s) => s.gallery)
  if (!gallery) return null
  return (
    <div
      role="dialog"
      aria-label="Projects"
      className="absolute inset-0 z-30 flex items-start justify-center bg-surface-950/70 pt-16"
      onClick={closeGallery}
    >
      <div
        className="card w-[32rem] max-h-[70%] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-200">My projects</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeGallery}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {gallery.length === 0 && (
          <p className="text-sm text-gray-500">No saved projects yet. Save one from the menu.</p>
        )}
        <ul className="space-y-1">
          {gallery.map((p) => (
            <li key={p.id}>
              <button
                className="w-full flex items-center gap-3 rounded-btn px-3 py-2 text-left hover:bg-white/[0.06]"
                onClick={() => void openProject(p.id)}
              >
                <FolderOpen className="w-4 h-4 text-accent-light" />
                <span className="flex-1 text-sm text-gray-200">{p.name}</span>
                <span className="text-xs text-gray-500">
                  {new Date(p.updated).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
