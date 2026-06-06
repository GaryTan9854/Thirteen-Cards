/**
 * Scene-based background music — singleton, browser-safe.
 *
 * Three scenes:
 *   lobby   → 我對緣份小心翼翼(伴奏)               — single track, loop
 *   playing → queue: shuffle [我對緣份小心翼翼, 一念, 清清如我, 眾裡尋他千百度, 木已成舟]
 *             then append [前路, 我對緣份小心翼翼(伴奏), 清清如我(伴奏)]; loop the queue.
 *   ended   → 眾裡尋他千百度(伴奏)                 — single track, loop
 *
 * Handles autoplay policy by deferring play to first user gesture.
 */
import { useEffect, useState } from 'react'

const M = (f: string) => `/assets/music/${f}`

const LOBBY_TRACK  = M('wodui_i.mp3')
const ENDED_TRACK  = M('zhongli_i.mp3')

const PLAYING_RANDOM = [
  M('wodui.mp3'),
  M('yinian.mp3'),
  M('qingqing.mp3'),
  M('zhongli.mp3'),
  M('muyichengzhou.mp3'),
]
const PLAYING_TAIL = [
  M('qianlu.mp3'),
  M('wodui_i.mp3'),
  M('qingqing_i.mp3'),
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildPlayingQueue(): string[] {
  return [...shuffle(PLAYING_RANDOM), ...PLAYING_TAIL]
}

let audio: HTMLAudioElement | null = null
let _scene = ''
let _enabled = localStorage.getItem('tc_music_on') !== 'false'   // default ON
const listeners = new Set<(b: boolean) => void>()

// Playing-scene queue state
let _queue: string[] = []
let _qIdx = 0

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

function playPlayingQueue(reset = true) {
  if (reset || _queue.length === 0) {
    _queue = buildPlayingQueue()
    _qIdx  = 0
  }
  const a = makeAudio(_queue[_qIdx], false)
  a.onended = () => {
    if (_scene !== 'playing' || !_enabled) return
    _qIdx++
    if (_qIdx >= _queue.length) {
      // Loop: reshuffle and start over
      _queue = buildPlayingQueue()
      _qIdx  = 0
    }
    const next = makeAudio(_queue[_qIdx], false)
    next.onended = a.onended
    tryPlay(next)
  }
  tryPlay(a)
}

export function setScene(scene: string) {
  if (scene === _scene) return
  _scene = scene
  if (!_enabled) return
  if (scene === 'lobby')   { tryPlay(makeAudio(LOBBY_TRACK, true)); return }
  if (scene === 'ended')   { tryPlay(makeAudio(ENDED_TRACK, true)); return }
  if (scene === 'playing') { playPlayingQueue(true); return }
  audio?.pause()
}

export function isMusicOn(): boolean { return _enabled }

export function toggleMusic(): boolean {
  _enabled = !_enabled
  localStorage.setItem('tc_music_on', String(_enabled))
  if (_enabled) {
    if      (_scene === 'lobby')   tryPlay(makeAudio(LOBBY_TRACK, true))
    else if (_scene === 'ended')   tryPlay(makeAudio(ENDED_TRACK, true))
    else if (_scene === 'playing') playPlayingQueue(false)   // resume current queue position
  } else {
    audio?.pause()
  }
  listeners.forEach(l => l(_enabled))
  return _enabled
}

export function stopMusic() {
  _scene = ''
  audio?.pause()
  audio = null
}

export function useMusicOn(): boolean {
  const [s, set] = useState(_enabled)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return s
}
