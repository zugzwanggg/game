import { useLayoutEffect, useState } from 'react'

export type VisualViewportLayout = {
  /** Lift fixed bottom UI by this many px (virtual keyboard overlap). */
  bottomInset: number
  /** Pin a full-screen overlay to the visible viewport (shrinks when keyboard opens). */
  overlayTop: number
  overlayLeft: number
  overlayWidth: number
  overlayHeight: number
}

/** Pixels below the visual viewport before the layout viewport bottom (browser chrome, home indicator, etc.). */
function layoutGapBelowVisualViewport(vv: VisualViewport): number {
  return Math.max(0, window.innerHeight - vv.offsetTop - vv.height)
}

function readLayout(): VisualViewportLayout {
  if (typeof window === 'undefined') {
    return {
      bottomInset: 0,
      overlayTop: 0,
      overlayLeft: 0,
      overlayWidth: 0,
      overlayHeight: 0,
    }
  }
  const vv = window.visualViewport
  if (!vv) {
    return {
      bottomInset: 0,
      overlayTop: 0,
      overlayLeft: 0,
      overlayWidth: window.innerWidth,
      overlayHeight: window.innerHeight,
    }
  }
  const bottomInset = layoutGapBelowVisualViewport(vv)
  /**
   * Full-screen overlays must cover the layout viewport when the keyboard is closed. Using only `vv.height`
   * leaves a strip below the visual viewport (common on mobile browsers) — looks like the sheet is “at the
   * top” with empty space underneath. When the gap is small (not the virtual keyboard), stretch height to
   * `innerHeight - offsetTop`. When the keyboard is likely open (large gap), keep `vv.height` so we don’t
   * paint behind the keyboard if the layout viewport did not resize.
   */
  const keyboardLikelyOpen = bottomInset > 96
  const overlayHeight = keyboardLikelyOpen
    ? vv.height
    : Math.max(vv.height, window.innerHeight - vv.offsetTop)
  return {
    bottomInset,
    overlayTop: vv.offsetTop,
    overlayLeft: vv.offsetLeft,
    overlayWidth: vv.width,
    overlayHeight,
  }
}

/**
 * Tracks `window.visualViewport` so fixed bottom composers and full-screen sheets
 * stay aligned when the mobile virtual keyboard opens or the URL bar resizes.
 */
export function useVisualViewportKeyboard(): VisualViewportLayout {
  const [layout, setLayout] = useState<VisualViewportLayout>(readLayout)

  useLayoutEffect(() => {
    const vv = window.visualViewport
    const update = () => {
      setLayout(readLayout())
    }
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    }
    window.addEventListener('resize', update)
    update()
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
      window.removeEventListener('resize', update)
    }
  }, [])

  return layout
}
