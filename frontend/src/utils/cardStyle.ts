/**
 * Card face style preference (browser-level).
 *   v1 = 初版 — single line centered (♥A)
 *   v2 = 二版 — rank corners + tiny suit centre
 *   v3 = 三版 — v1 base; uniform grey frame, rank+suit +10 %.
 */
import { useEffect, useState } from 'react'

export type CardStyle = 'v1' | 'v2' | 'v3'
const DEFAULT: CardStyle = 'v3'

// 2026-06：牌面定版 v3，不再提供選擇 UI。一律 v3，忽略舊的 localStorage 設定。
let _style: CardStyle = DEFAULT
const listeners = new Set<(s: CardStyle) => void>()

export function getCardStyle(): CardStyle { return _style }

export function setCardStyle(s: CardStyle) {
  if (s === _style) return
  _style = s
  localStorage.setItem('tc_card_style', s)
  listeners.forEach(l => l(s))
}

export function useCardStyle(): CardStyle {
  const [s, set] = useState(_style)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return s
}

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  v1: '初版',
  v2: '二版',
  v3: '三版',
}
