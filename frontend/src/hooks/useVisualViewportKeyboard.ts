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
  const bottomInset = Math.max(0, window.innerHeight - vv.offsetTop - vv.height)
  return {
    bottomInset,
    overlayTop: vv.offsetTop,
    overlayLeft: vv.offsetLeft,
    overlayWidth: vv.width,
    overlayHeight: vv.height,
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
