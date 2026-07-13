/**
 * TunaIcon — reusable zoomable icon / avatar (Tuna* shared-component convention).
 *
 * Renders an image at `size`px; clicking it opens a full-screen lightbox that
 * shows the image enlarged for admiring. Close on: click the backdrop (別處) /
 * click the enlarged image again (再按) / press Esc.
 *
 * Self-contained — copy across games unchanged. The lightbox renders via a
 * portal to <body> so it is never clipped by an `overflow:hidden` ancestor
 * (e.g. a circular avatar wrapper or a scrolling seat panel).
 *
 * Pass `onClick` to override the zoom behaviour (e.g. isMe → open file upload);
 * pass `zoomable={false}` to disable zoom entirely. `children` renders as an
 * overlay on top of the small icon (e.g. a 📷 camera badge on hover).
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// Inject the lightbox keyframes once (module-level, idempotent).
let stylesInjected = false
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const el = document.createElement('style')
  el.textContent =
    '@keyframes tunaicon-fade{from{opacity:0}to{opacity:1}}' +
    '@keyframes tunaicon-pop{from{transform:scale(.72);opacity:0}to{transform:scale(1);opacity:1}}'
  document.head.appendChild(el)
}

interface Props {
  src:          string
  alt?:         string
  size:         number             // diameter / side in px
  circular?:    boolean            // round the icon + enlarged view (default true)
  className?:   string
  style?:       React.CSSProperties
  title?:       string
  zoomable?:    boolean            // enable click-to-zoom (default true)
  onClick?:     () => void         // overrides zoom when provided
  children?:    React.ReactNode    // overlay content on top of the small icon
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export default function TunaIcon({
  src, alt = '', size, circular = true, className = '', style, title,
  zoomable = true, onClick, children, onMouseEnter, onMouseLeave,
}: Props) {
  const [zoomed, setZoomed] = useState(false)
  injectStyles()

  const close = useCallback(() => setZoomed(false), [])

  // Esc closes the lightbox. Capture-phase + stopPropagation so it does NOT
  // also trigger the host app's global Esc handlers (e.g. "Esc → back to lobby").
  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoomed, close])

  function handleClick() {
    if (onClick) { onClick(); return }
    if (zoomable) setZoomed(true)
  }

  const wrapStyle: React.CSSProperties = {
    width:        size,
    height:       size,
    borderRadius: circular ? '50%' : undefined,
    overflow:     'hidden',
    flexShrink:   0,
    position:     'relative',
    cursor:       (onClick || zoomable) ? 'pointer' : 'default',
    display:      'inline-block',
    ...style,
  }

  return (
    <>
      <div
        className={className}
        style={wrapStyle}
        title={title}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <img
          src={src}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {children}
      </div>

      {zoomed && createPortal(
        <div
          onClick={close}
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         99999,
            background:     'rgba(0,0,0,0.82)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            padding:        24,
            cursor:         'zoom-out',
            animation:      'tunaicon-fade .16s ease-out',
          }}
        >
          <img
            src={src}
            alt={alt}
            onClick={close}
            style={{
              width:        'min(82vw, 82vh, 460px)',
              height:       'min(82vw, 82vh, 460px)',
              objectFit:    'cover',
              borderRadius: circular ? '50%' : 14,
              boxShadow:    '0 16px 56px rgba(0,0,0,.6)',
              border:       '3px solid rgba(255,255,255,.85)',
              animation:    'tunaicon-pop .18s cubic-bezier(.2,.9,.3,1.2)',
            }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
