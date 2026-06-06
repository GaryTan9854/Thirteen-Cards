/**
 * MusicPage — 歌曲欣賞.
 *
 * Lists all 9 background-music tracks with click-to-play. Background scene
 * music is paused while this page is mounted, then resumed on unmount.
 */
import { useState, useEffect, useRef } from 'react'
import { pauseScene, resumeScene } from '../utils/music'

interface Song {
  file:     string
  title:    string
  subtitle?: string
}

const SONGS: Song[] = [
  { file: 'qingqing.mp3',       title: '清清如我' },
  { file: 'qingqing_i.mp3',     title: '清清如我',         subtitle: '(伴奏)' },
  { file: 'zhongli.mp3',        title: '眾裡尋他千百度' },
  { file: 'zhongli_i.mp3',      title: '眾裡尋他千百度',   subtitle: '(伴奏)' },
  { file: 'yinian.mp3',         title: '一念' },
  { file: 'wodui.mp3',          title: '我對緣份小心翼翼' },
  { file: 'wodui_i.mp3',        title: '我對緣份小心翼翼', subtitle: '(伴奏)' },
  { file: 'muyichengzhou.mp3',  title: '木已成舟' },
  { file: 'qianlu.mp3',         title: '前路' },
]

export default function MusicPage() {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    pauseScene()
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      resumeScene()
    }
  }, [])

  function toggle(file: string) {
    if (playing === file) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    audioRef.current?.pause()
    const a = new Audio(`/assets/music/${file}`)
    a.volume = 0.6
    a.onended = () => { if (audioRef.current === a) setPlaying(null) }
    audioRef.current = a
    a.play().catch(() => {})
    setPlaying(file)
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-sky-300 mb-2">🎵 歌曲欣賞</h2>
      <div className="text-xs text-gray-400 mb-5">
        點擊曲目即可試聽；切換到他曲會停止前一首。離開此頁將自動恢復背景配樂。
      </div>
      <div className="space-y-2">
        {SONGS.map(s => {
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
