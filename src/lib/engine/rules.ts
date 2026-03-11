export interface RuleSetConfig {
  score_min: number
  score_max: number
  scoring_method: 'irish_points'
  tie_breaker: 'countback' | 'none'
  recall_top_percent: number
  drop_high: boolean
  drop_low: boolean
}

export function validateScore(score: number, config: RuleSetConfig): boolean {
  return score >= config.score_min && score <= config.score_max
}

export const DEFAULT_RULES: RuleSetConfig = {
  score_min: 0,
  score_max: 100,
  scoring_method: 'irish_points',
  tie_breaker: 'countback',
  recall_top_percent: 50,
  drop_high: false,
  drop_low: false,
}
