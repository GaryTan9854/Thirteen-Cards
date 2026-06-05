/**
 * Scene-based background music — singleton, browser-safe.
 * Handles autoplay policy by deferring play to first user gesture.
 * Each scene has vocal + instrumental variants; one is chosen at random on each play.
 *
 * Playing scene: always opens with 一念 (yinian.mp3), then transitions to the
 * randomly-picked playing track on natural end.
 */

const TRACKS: Record<string, [string, string]> = {
  lobby:   ['/assets/music/lobby.mp3',   '/assets/music/lobby_i.mp3'],
  playing: ['/assets/music/playing.mp3', '/assets/music/playing_i.mp3'],
  ended:   ['/assets/music/ended.mp3',   '/assets/music/ended_i.mp3'],
}

const YINIAN = '/assets/music/yinian.mp3'

function pickTrack(scene: string): string | null {
  const variants = TRACKS[scene]
  if (!variants) return null
  return variants[Math.random() < 0.5 ? 0 : 1]
}

import { useEffect, useState } from 'react'

let audio: HTMLAudioElement | null = null
let _scene = ''
let _enabled = localStorage.getItem('tc_music_on') !== 'false'   // default ON
const listeners = new Set<(b: boolean) => void>()

function makeAudio(src: string, loop = true): HTMLAudioElement {
  if (audio) { audio.pause(); audio.src = '' }
  audio = new Audio(src)
  audio.loop = loop
  audio.volume = 0.3
  return audio
}

function tryPlay(a: HTMLAudioElement) {
  a.play().catch(() => {
    const resume = () => { a.play().catch(() => {}) }
    document.addEventListener('click',      resume, { capture: true, once: true })
    document.addEventListener('touchstart', resume, { capture: true, once: true })
    document.addEventListener('keydown',    resume, { capture: true, once: true })
  })
}

function playPlaying() {
  // Open with 一念 (no loop), then on end switch to the main playing track (looped)
  const mainSrc = pickTrack('playing')!
  const intro = makeAudio(YINIAN, false)
  intro.onended = () => {
    if (_scene !== 'playing' || !_enabled) return
    tryPlay(makeAudio(mainSrc, true))
  }
  tryPlay(intro)
}

export function setScene(scene: string) {
  if (scene === _scene) return
  _scene = scene
  if (!_enabled) return
  if (scene === 'playing') { playPlaying(); return }
  const src = pickTrack(scene)
  if (!src) { audio?.pause(); return }
  tryPlay(makeAudio(src))
}

export function isMusicOn(): boolean { return _enabled }

export function toggleMusic(): boolean {
  _enabled = !_enabled
  localStorage.setItem('tc_music_on', String(_enabled))
  if (_enabled) {
    if (_scene === 'playing') { playPlaying() }
    else {
      const src = pickTrack(_scene)
      if (src) tryPlay(makeAudio(src))
    }
  } else {
    audio?.pause()
  }
  listeners.forEach(l => l(_enabled))
  return _enabled
}

export function useMusicOn(): boolean {
  const [s, set] = useState(_enabled)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return s
}

export function stopMusic() {
  _scene = ''
  audio?.pause()
  audio = null
}
