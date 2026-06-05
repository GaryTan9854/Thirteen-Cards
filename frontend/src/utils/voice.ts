/**
 * Voice (TTS) on/off preference — browser-level, default OFF.
 * Other modules read isVoiceOn() synchronously (used inside async callbacks);
 * UI hooks subscribe via useVoiceOn().
 */
import { useEffect, useState } from 'react'

let _on = localStorage.getItem('tc_voice_on') === 'true'
const listeners = new Set<(b: boolean) => void>()

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
