// The HUD's faces (SPEC 2.3), served from the app itself: Outfit's variable face for the interface
// (its Latin Extended file loads only for a character that needs it) and DM Mono 400 and 500, Latin
// only, for values.
import '@fontsource-variable/outfit'
import '@fontsource/dm-mono/latin-400.css'
import '@fontsource/dm-mono/latin-500.css'
import './index.css'
import './styles/hud.css'
import './api'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import useConnectionStore from './store/connectionStore'

// The app opens connected to the saved Pi, with its agent running when the Pi has this app's
// (ADR-0141). Outside Tauri there is no `window.api`, and nothing to connect.
if (window.api) useConnectionStore.getState().connectOnLaunch()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
