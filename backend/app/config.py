REWARD_DAY_PREF           = 1_000_000
REWARD_B2B                = 10_000
REWARD_NO_TRAVEL          = 100
REWARD_NET_HEIGHT         = 1
REWARD_ADJ_GROUP_B2B      = 5_000
REWARD_ADJ_GROUP_SAME_DAY = 1_000
PENALTY_ADJ_BLOCKED       = 10_000


def resolve_rewards(cfg: dict) -> dict:
    """Merge caller-supplied reward values with module defaults."""
    return {
        # REWARD_SAME_DAY is the pre-rename key; accept it so saved configs carry over.
        'REWARD_DAY_PREF':           int(cfg.get('REWARD_DAY_PREF',           cfg.get('REWARD_SAME_DAY', REWARD_DAY_PREF))),
        'REWARD_B2B':                int(cfg.get('REWARD_B2B',                REWARD_B2B)),
        'REWARD_NO_TRAVEL':          int(cfg.get('REWARD_NO_TRAVEL',          REWARD_NO_TRAVEL)),
        'REWARD_NET_HEIGHT':         int(cfg.get('REWARD_NET_HEIGHT',         REWARD_NET_HEIGHT)),
        'REWARD_ADJ_GROUP_B2B':      int(cfg.get('REWARD_ADJ_GROUP_B2B',      REWARD_ADJ_GROUP_B2B)),
        'REWARD_ADJ_GROUP_SAME_DAY': int(cfg.get('REWARD_ADJ_GROUP_SAME_DAY', REWARD_ADJ_GROUP_SAME_DAY)),
        'PENALTY_ADJ_BLOCKED':       int(cfg.get('PENALTY_ADJ_BLOCKED',       PENALTY_ADJ_BLOCKED)),
    }
