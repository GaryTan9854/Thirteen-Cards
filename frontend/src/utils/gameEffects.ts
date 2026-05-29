/**
 * Shared game effect utilities — used by both GamePage (simulation) and
 * OnlinePage (online mode).
 *
 * Pure functions only; no React imports.
 */

export interface GunNotif {
  id:     number
  winner: string
  losers: string[]
  count:  1 | 2
}

/** How long each 打槍 toast stays on screen (ms) */
export const GUN_NOTIF_MS = 3200

// ── Grand Slam detection ──────────────────────────────────────────────────────

export function detectGrandSlam(battles: any[]): string | null {
  const gunCount: Record<string, number> = {}
  for (const b of battles) {
    if      (b.gun === 1)  gunCount[b.p1] = (gunCount[b.p1] || 0) + 1
    else if (b.gun === -1) gunCount[b.p2] = (gunCount[b.p2] || 0) + 1
  }
  const entry = Object.entries(gunCount).find(([, c]) => c === 3)
  return entry ? entry[0] : null
}

// ── 打槍 event builder（同一人打兩人 → 合併成打槍兩人）─────────────────────

export function buildGunNotifs(battles: any[], slam: string | null): GunNotif[] {
  const byWinner: Record<string, string[]> = {}
  for (const b of battles) {
    if      (b.gun === 1)  byWinner[b.p1] = [...(byWinner[b.p1] ?? []), b.p2]
    else if (b.gun === -1) byWinner[b.p2] = [...(byWinner[b.p2] ?? []), b.p1]
  }
  let id = Date.now()
  const notifs: GunNotif[] = []
  for (const [winner, losers] of Object.entries(byWinner)) {
    if (winner === slam) continue
    if      (losers.length === 1) notifs.push({ id: id++, winner, losers, count: 1 })
    else if (losers.length === 2) notifs.push({ id: id++, winner, losers, count: 2 })
  }
  return notifs
}

// ── 特殊牌型 TTS 建構（分兩批：報到 / 怪物牌型）────────────────────────────

export function buildSpecialTTS(players: any[]): { baodao: string[]; monsters: string[] } {
  const baodao:   string[] = []
  const monsters: string[] = []
  for (const p of players) {
    const name = p.name as string
    if (p.special_hand && p.special_hand !== 'normal') {
      baodao.push(`${name}，${p.special_hand} 報到！`)
      continue
    }
    if (p.top) {
      if (p.top.hand_type === '三條') {
        monsters.push(`${name}，原子頭！${p.top.description}！`)
      } else if (p.top.hand_type === '一對') {
        const aces = (p.top.cards as string[]).filter((c: string) => parseInt(c) === 14).length
        if (aces >= 2) monsters.push(`${name}，柳丁！老A 撐頭！`)
      }
    }
    if (p.mid) {
      if      (p.mid.hand_type === '鐵支') monsters.push(`${name}，中墩鐵支！${p.mid.description}！`)
      else if (p.mid.hand_type === '葫蘆') monsters.push(`${name}，中墩葫蘆！${p.mid.description}！`)
      else if (['同花順', '同花次大順', '同花大順'].includes(p.mid.hand_type))
        monsters.push(`${name}，中墩同花順！${p.mid.description}！`)
    }
    if (p.bot) {
      if      (p.bot.hand_type === '鐵支') monsters.push(`${name}，尾墩鐵支！${p.bot.description}！`)
      else if (['同花順', '同花次大順', '同花大順'].includes(p.bot.hand_type))
        monsters.push(`${name}，尾墩同花順！${p.bot.description}！`)
    }
  }
  return { baodao, monsters }
}

// ── 女聲 TTS（Web Speech API，優先 zh-TW）────────────────────────────────────

/** Pick best Mandarin (華語) female voice, avoiding Cantonese (zh-HK / Sinji). */
function pickFemaleZh(zh: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  // Exclude Cantonese voices (zh-HK, Sinji, etc.)
  const mandarin = zh.filter(v => v.lang !== 'zh-HK' && !/sin[\s-]?ji|sinji/i.test(v.name))
  const pool = mandarin.length > 0 ? mandarin : zh  // fallback to all zh if nothing left

  return (
    // macOS: Meijia (zh-TW Mandarin) — preferred; Yawen (zh-TW)
    pool.find(v => /mei-?jia|美嘉|ya[\s-]?wen|雅雯/i.test(v.name)) ||
    // macOS: Tingting (zh-CN Mandarin)
    pool.find(v => /tingting|ting[\s-]?ting/i.test(v.name)) ||
    // Windows / Firefox: Hanhan (zh-TW female), Huihui (zh-CN female)
    pool.find(v => /hanhan|han[\s-]?han|huihui|hui[\s-]?hui/i.test(v.name)) ||
    // Google voices (Android / ChromeOS): any zh (Google TTS is Mandarin by default)
    pool.find(v => /google/i.test(v.name) && v.lang.startsWith('zh')) ||
    // Fallback: any zh-TW, then any zh-CN, then any zh
    pool.find(v => v.lang === 'zh-TW') ||
    pool.find(v => v.lang === 'zh-CN') ||
    pool[0]
  )
}

export function speak(text: string, rate = 1.05) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang  = 'zh-TW'
  utter.rate  = rate
  utter.pitch = 1.0
  const doSpeak = () => {
    const voices = synth.getVoices()
    const zh     = voices.filter(v => v.lang.startsWith('zh'))
    const female = pickFemaleZh(zh)
    if (female) utter.voice = female
    synth.speak(utter)
  }
  if (synth.getVoices().length > 0) doSpeak()
  else synth.addEventListener('voiceschanged', doSpeak, { once: true })
}

// ── 連續多行 TTS ──────────────────────────────────────────────────────────────

export function speakSequence(lines: string[], onDone?: () => void, rate = 1.05) {
  if (lines.length === 0) { onDone?.(); return }
  const synth = window.speechSynthesis
  if (!synth) { onDone?.(); return }
  const voices = synth.getVoices()
  const zh     = voices.filter(v => v.lang.startsWith('zh'))
  const female = pickFemaleZh(zh)
  let idx = 0
  const playNext = () => {
    if (idx >= lines.length) { onDone?.(); return }
    const utter = new SpeechSynthesisUtterance(lines[idx++])
    utter.lang = 'zh-TW'; utter.rate = rate; utter.pitch = 1.0
    if (female) utter.voice = female
    utter.onend = playNext
    synth.speak(utter)
  }
  playNext()
}

// ── Fire all round effects (slam + voice + guns) for a result ─────────────────

export function fireRoundEffects(
  result:         any,
  voiceRef:       React.MutableRefObject<boolean>,
  ttsGenRef:      React.MutableRefObject<number>,
  gunQueueRef:    React.MutableRefObject<GunNotif[]>,
  setGrandSlammer: (s: string | null) => void,
  processNextGun: () => void,
) {
  const slam      = detectGrandSlam(result.battles ?? [])
  const gunNotifs = buildGunNotifs(result.battles ?? [], slam)
  setGrandSlammer(slam)

  const { baodao: baodaoLines, monsters: monsterLines } = buildSpecialTTS(result.players ?? [])
  const myGen = ++ttsGenRef.current

  const startGuns = () => {
    if (ttsGenRef.current !== myGen) return
    if (gunNotifs.length > 0) {
      gunQueueRef.current = gunNotifs
      processNextGun()
      if (monsterLines.length > 0) {
        setTimeout(() => {
          if (ttsGenRef.current !== myGen || !voiceRef.current) return
          speakSequence(monsterLines)
        }, gunNotifs.length * GUN_NOTIF_MS + 800)
      }
    } else if (monsterLines.length > 0 && voiceRef.current) {
      speakSequence(monsterLines)
    }
  }

  if (slam) {
    setTimeout(() => {
      if (ttsGenRef.current !== myGen || !voiceRef.current) return
      if (baodaoLines.length > 0) {
        speakSequence(baodaoLines, () => {
          if (ttsGenRef.current !== myGen || !voiceRef.current) return
          if (monsterLines.length > 0) speakSequence(monsterLines)
        })
      } else if (monsterLines.length > 0) {
        speakSequence(monsterLines)
      }
    }, 4500)
  } else {
    if (baodaoLines.length > 0 && voiceRef.current) {
      speakSequence(baodaoLines, startGuns)
    } else {
      startGuns()
    }
  }
}

// Trick to import React.MutableRefObject type without React dep at runtime
import type React from 'react'
