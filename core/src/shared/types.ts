export interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface ActiveSkill {
  name: string;
  effects: string[];
  metadata?: Record<string, unknown>;
}
