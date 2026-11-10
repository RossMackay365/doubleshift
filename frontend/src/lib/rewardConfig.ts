import { RewardItem, RewardConfig } from './types';

// Default Reward Config (Overriden by User Configs)
export const REWARD_DAY_PREF           = 1_000_000;
export const REWARD_B2B                = 10_000;
export const REWARD_NO_TRAVEL          = 100;
export const REWARD_NET_HEIGHT         = 1;
export const REWARD_ADJ_GROUP_B2B      = 5_000;
export const REWARD_ADJ_GROUP_SAME_DAY = 1_000;
export const PENALTY_ADJ_BLOCKED       = 10_000;

export const DEFAULT_REWARD_CONFIG: RewardConfig = [
  { key: 'REWARD_ADJ_GROUP_B2B',      label: 'Adjacent Groups Back-to-Back',   value: REWARD_ADJ_GROUP_B2B,      enabled: true },
  { key: 'REWARD_ADJ_GROUP_SAME_DAY', label: 'Adjacent Groups Same Day',        value: REWARD_ADJ_GROUP_SAME_DAY, enabled: true },
  { key: 'REWARD_B2B',                label: 'Back-to-Back',                    value: REWARD_B2B,                enabled: true },
  { key: 'REWARD_DAY_PREF',           label: 'Day Preference',                  value: REWARD_DAY_PREF,           enabled: true },
  { key: 'REWARD_NET_HEIGHT',         label: 'No Net Height Changes',           value: REWARD_NET_HEIGHT,         enabled: true },
  { key: 'REWARD_NO_TRAVEL',          label: 'No Travel',                       value: REWARD_NO_TRAVEL,          enabled: true },
  { key: 'PENALTY_ADJ_BLOCKED',       label: 'Trainer Cannot Sub Up',      value: PENALTY_ADJ_BLOCKED,       enabled: true, isPenalty: true },
];

// Keys that were renamed; stored configs using the old key carry their value over.
const LEGACY_KEYS: Record<string, string> = {
  REWARD_DAY_PREF: 'REWARD_SAME_DAY',
};

export function rewardConfigToPayload(config: RewardConfig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of config) {
    out[item.key] = item.enabled ? item.value : 0;
  }
  return out;
}

export function getEffectiveValue(config: RewardConfig, key: string, fallback: number): number {
  const item = config.find(r => r.key === key);
  if (!item) return fallback;
  return item.enabled ? item.value : 0;
}

export function mergeWithDefaults(stored: RewardItem[]): RewardConfig {
  return DEFAULT_REWARD_CONFIG.map(def => {
    const found = stored.find(s => s.key === def.key)
      ?? stored.find(s => s.key === LEGACY_KEYS[def.key]);
    return found ? { ...def, value: found.value, enabled: found.enabled } : def;
  });
}
