/**
 * Scene-based background music — singleton, browser-safe.
 * Handles autoplay policy by deferring play to first user gesture.
 * Each scene has vocal + instrumental variants; one is chosen at random on each play.
 */

const TRACKS: Record<string, [string, string]> = {
  lobby:   ['/assets/music/lobby.mp3',   '/assets/music/lobby_i.mp3'],
  playing: ['/assets/music/playing.mp3', '/assets/music/playing_i.mp3'],
  ended:   ['/assets/music/ended.mp3',   '/assets/music/ended_i.mp3'],
}

function pickTrack(scene: string): string | null {
  const variants = TRACKS[scene]
  if (!variants) return null
  return variants[Math.random() < 0.5 ? 0 : 1]
}

let audio: HTMLAudioElement | null = null
let _scene = ''
let _enabled = localStorage.getItem('tc_music_on') !== 'false'   // default ON

function makeAudio(src: string): HTMLAudioElement {
  if (audio) { audio.pause(); audio.src = '' }
  audio = new Audio(src)
  audio.loop = true
  audio.volume = 0.3
  return audio
}

function tryPlay(a: HTMLAudioElement) {
  a.play().catch(() => {
    // Autoplay blocked — resume on first user gesture
    const resume = () => { a.play().catch(() => {}) }
    document.addEventListener('click',      resume, { capture: true, once: true })
    document.addEventListener('touchstart', resume, { capture: true, once: true })
    document.addEventListener('keydown',    resume, { capture: true, once: true })
  })
}

export function setScene(scene: string) {
  if (scene === _scene) return
  _scene = scene
  if (!_enabled) return
  const src = pickTrack(scene)
  if (!src) { audio?.pause(); return }
  tryPlay(makeAudio(src))
}

export function isMusicOn(): boolean { return _enabled }

export function toggleMusic(): boolean {
  _enabled = !_enabled
  localStorage.setItem('tc_music_on', String(_enabled))
  if (_enabled) {
    const src = pickTrack(_scene)
    if (src) tryPlay(makeAudio(src))
  } else {
    audio?.pause()
  }
  return _enabled
}

export function stopMusic() {
  _scene = ''
  audio?.pause()
  audio = null
}
