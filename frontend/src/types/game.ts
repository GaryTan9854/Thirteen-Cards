export interface HandRow {
  cards: string[]
  hand_type: string
  description: string
  score: number
}

export interface PlayerData {
  name: string
  original_hand: string[]
  special_hand: string
  top: HandRow | null
  mid: HandRow | null
  bot: HandRow | null
  can_attack: boolean
  total_score: number
}

export interface Battle {
  p1: string
  p2: string
  top: number
  mid: number
  bot: number
  total: number
  gun: number
  desc: string
}

export interface FinalScore {
  name: string
  score: number
}

export interface GameResult {
  players: PlayerData[]
  battles: Battle[]
  final_scores: FinalScore[]
}
