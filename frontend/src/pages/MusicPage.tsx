/**
 * MusicPage — 歌曲欣賞.
 *
 * Lists all 9 background-music tracks with click-to-play. Background scene
 * music is paused while this page is mounted, then resumed on unmount.
 */
import { useState, useEffect, useRef } from 'react'
import { pauseScene, resumeScene } from '../utils/music'

interface Song {
  file:          string
  title:         string
  subtitle?:     string
  instrumental?: boolean
}

const SONGS: Song[] = [
  { file: 'qingqing.mp3',       title: '清清如我' },
  { file: 'qingqing_i.mp3',     title: '清清如我',         subtitle: '(伴奏)', instrumental: true },
  { file: 'zhongli.mp3',        title: '眾裡尋他千百度' },
  { file: 'zhongli_i.mp3',      title: '眾裡尋他千百度',   subtitle: '(伴奏)', instrumental: true },
  { file: 'yinian.mp3',         title: '一念' },
  { file: 'wodui.mp3',          title: '我對緣份小心翼翼' },
  { file: 'wodui_i.mp3',        title: '我對緣份小心翼翼', subtitle: '(伴奏)', instrumental: true },
  { file: 'muyichengzhou.mp3',  title: '木已成舟' },
  { file: 'qianlu.mp3',         title: '前路' },
]

export default function MusicPage() {
  const [playing, setPlaying] = useState<string | null>(null)
  const [showInstr, setShowInstr] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const visible = showInstr ? SONGS : SONGS.filter(s => !s.instrumental)

  // If user toggles instrumentals off mid-playback, stop any instrumental in progress
  useEffect(() => {
    if (showInstr || !playing) return
    const cur = SONGS.find(s => s.file === playing)
    if (cur?.instrumental) { audioRef.current?.pause(); setPlaying(null) }
  }, [showInstr, playing])

  useEffect(() => {
    pauseScene()
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      resumeScene()
    }
  }, [])

  function playAt(idx: number, list: Song[]) {
    if (list.length === 0) return
    audioRef.current?.pause()
    const i = ((idx % list.length) + list.length) % list.length
    const song = list[i]
    const a = new Audio(`/assets/music/${song.file}`)
    a.volume = 0.6
    a.onended = () => { if (audioRef.current === a) playAt(i + 1, list) }   // auto-advance + wrap
    audioRef.current = a
    a.play().catch(() => {})
    setPlaying(song.file)
  }

  function toggle(file: string) {
    if (playing === file) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    playAt(visible.findIndex(s => s.file === file), visible)
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-sky-300">🎵 歌曲欣賞</h2>
        <label className="flex items-center gap-2 cursor-pointer select-none"
               onClick={() => setShowInstr(v => !v)}>
          <span className="text-xs text-gray-300">伴奏版</span>
          <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0
                           ${showInstr ? 'bg-sky-500' : 'bg-gray-600'}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                             ${showInstr ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
        </label>
      </div>
      <div className="text-xs text-gray-400 mb-5">
        點擊曲目即可試聽；一首播完自動接下一首，整個列表循環播放。離開此頁將自動恢復背景配樂。
      </div>
      <div className="space-y-2">
        {visible.map(s => {
          const active = playing === s.file
          return (
            <button key={s.file}
              onClick={() => toggle(s.file)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition text-left
                ${active
                  ? 'bg-sky-900/40 border-sky-500 text-sky-100'
                  : 'bg-slate-800/60 border-slate-700 text-gray-200 hover:border-sky-500'}`}>
              <span className="text-lg w-6 text-center">{active ? '⏸' : '▶'}</span>
              <span className="flex-1">
                <span className="font-semibold">{s.title}</span>
                {s.subtitle && <span className="text-gray-400 text-xs ml-1">{s.subtitle}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
