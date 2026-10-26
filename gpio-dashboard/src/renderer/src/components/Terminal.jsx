import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const Terminal = forwardRef(function Terminal({ sessionId, className }, ref) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)

  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear()
  }))

  useEffect(() => {
    // xterm needs colour values, so it reads the palette's CSS variables (styles/palette.cjs).
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const term = new XTerm({
      theme: {
        background: css('--ink'),
        foreground: css('--text-kicker'),
        cursor: css('--cyan'),
        selectionBackground: `${css('--cyan')}30`
      },
      fontFamily: "'JetBrains Mono', 'Menlo', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    const onDataDisposable = term.onData((data) => {
      window.api.terminal.write(sessionId, data)
    })

    const removeOutputListener = window.api.terminal.onData(sessionId, (data) => {
      term.write(data)
    })

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.api.terminal.resize(sessionId, term.cols, term.rows)
      } catch {
        // ignore fit errors during transitions
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      onDataDisposable.dispose()
      if (removeOutputListener) removeOutputListener()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className || ''}`}
    />
  )
})

export default Terminal
