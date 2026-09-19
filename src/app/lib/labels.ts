import type { AcquisitionKind, EffectBucket, Gift, Sin } from '../../core/schema.ts';
import type { UnresolvedReason } from '../../core/types.ts';
import type { StringKey } from '../i18n.ts';

export type BadgeKind = 'sure' | 'maybe' | 'fuse' | 'start' | 'neutral';

/** How an acquisition class reads on a badge: only pack-limited and start gifts are guaranteed. */
export function badgeFor(kind: AcquisitionKind): { badge: BadgeKind; label: StringKey } {
  switch (kind) {
    case 'packLimited':
      return { badge: 'sure', label: 'acqSure' };
    case 'startOnly':
      return { badge: 'start', label: 'acqStart' };
    case 'general':
      return { badge: 'maybe', label: 'acqMaybe' };
    case 'fusionOnly':
      return { badge: 'fuse', label: 'acqFuse' };
    case 'clearReward':
      return { badge: 'sure', label: 'acqClear' };
    case 'hiddenBattle':
      return { badge: 'maybe', label: 'acqChance' };
    case 'event':
      return { badge: 'neutral', label: 'acqEvent' };
    case 'material':
      return { badge: 'neutral', label: 'acqMaterial' };
    case 'unknown':
      return { badge: 'neutral', label: 'acqUnknown' };
  }
}

export const SIN_LABEL: Record<Sin, StringKey> = {
  WRATH: 'sinWRATH',
  LUST: 'sinLUST',
  SLOTH: 'sinSLOTH',
  GLUTTONY: 'sinGLUTTONY',
  GLOOM: 'sinGLOOM',
  PRIDE: 'sinPRIDE',
  ENVY: 'sinENVY',
};

export const BUCKET_LABEL: Record<EffectBucket, StringKey> = {
  damage: 'skillsBucketDamage',
  survival: 'skillsBucketSurvival',
  egoResource: 'skillsBucketEgoResource',
};

export const UNRESOLVED_LABEL: Record<UnresolvedReason, StringKey> = {
  'no-pack-in-range': 'unresolvedNoPack',
  'pack-conflict': 'unresolvedConflict',
  'hard-only': 'unresolvedHardOnly',
  'fusion-ingredient-unresolved': 'unresolvedIngredient',
  'not-obtainable': 'unresolvedNotObtainable',
  'chance-only': 'unresolvedChance',
  'pack-banned': 'unresolvedBanned',
  'ingredient-shared': 'unresolvedShared',
  failed: 'unresolvedFailed',
};

/** How a tier is written: `T4` for the numbered ones, `EX` on its own (never `TEX`). */
export function tierLabel(tier: Gift['tier']): string {
  return tier === null ? '' : tier === 'EX' ? 'EX' : `T${tier}`;
}
