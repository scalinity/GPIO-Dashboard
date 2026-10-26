import './index.css'
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
