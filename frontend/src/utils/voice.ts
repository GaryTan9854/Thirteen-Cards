/**
 * Voice (TTS) preferences — browser-level singletons.
 *   tc_voice_on    : master on/off, default OFF
 *   tc_voice_lang  : 'zh' (default 華語) | 'nan' (台語, requires macOS Meijia 台灣台語)
 *
 * Other modules read isVoiceOn() / isTaiwanese() synchronously (inside async
 * callbacks); UI hooks subscribe via useVoiceOn() / useTaiwanese().
 */
import { useEffect, useState } from 'react'

let _on   = localStorage.getItem('tc_voice_on')   === 'true'
let _twan = localStorage.getItem('tc_voice_lang') === 'nan'
const listeners    = new Set<(b: boolean) => void>()
const langListeners = new Set<(b: boolean) => void>()

export function isVoiceOn(): boolean { return _on }
export function toggleVoice(): boolean {
  _on = !_on
  localStorage.setItem('tc_voice_on', String(_on))
  listeners.forEach(l => l(_on))
  return _on
}
export function useVoiceOn(): boolean {
  const [s, set] = useState(_on)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return s
}

export function isTaiwanese(): boolean { return _twan }
export function toggleTaiwanese(): boolean {
  _twan = !_twan
  localStorage.setItem('tc_voice_lang', _twan ? 'nan' : 'zh')
  langListeners.forEach(l => l(_twan))
  return _twan
}
export function useTaiwanese(): boolean {
  const [s, set] = useState(_twan)
  useEffect(() => { langListeners.add(set); return () => { langListeners.delete(set) } }, [])
  return s
}
