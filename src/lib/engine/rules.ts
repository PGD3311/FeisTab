export interface RuleSetConfig {
  score_min: number
  score_max: number
  aggregation: 'average' | 'sum'
  tie_breaker: 'highest_individual' | 'none'
  recall_top_n: number
  drop_high: boolean
  drop_low: boolean
}

export function validateScore(score: number, config: RuleSetConfig): boolean {
  return score >= config.score_min && score <= config.score_max
}
