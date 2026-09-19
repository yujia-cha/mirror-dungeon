/**
 * Zod schemas for everything under public/data.
 *
 * This is the single source of truth for the generated data shape: the build script writes it,
 * the validator checks it, the app loader parses it in dev, and the tests build fixtures from it.
 */
import { z } from 'zod';

export const KEYWORDS = [
  'Combustion',
  'Laceration',
  'Vibration',
  'Burst',
  'Sinking',
  'Breath',
  'Charge',
  'Slash',
  'Penetrate',
  'Hit',
  'None',
] as const;

/** The seven status keywords that identity decks are built around. */
export const STATUS_KEYWORDS = [
  'Combustion',
  'Laceration',
  'Vibration',
  'Burst',
  'Sinking',
  'Breath',
  'Charge',
] as const;

/**
 * What an identity's skills can be built around: the seven status keywords plus the two resources
 * certain skills spend — 탄환 (`Bullet`) and 혈찬 (`BloodDinner`). Neither is a `Keyword`: no gift
 * carries them, no theme pack has them as an affinity and no starting gift pool exists for them.
 */
export const IDENTITY_KEYWORDS = [...STATUS_KEYWORDS, 'Bullet', 'BloodDinner'] as const;

/**
 * Identity keywords a skill SPENDS rather than inflicts.
 *
 * 혈찬 is here and 탄환 is not, because of how each is written down: ammo is declared as a skill
 * requirement (`[necessary:Bullet:1]`), while 혈찬 appears only in the Korean sentence 「…을
 * 소모하는」. The distinction matters to the derivations — the inflict-side ones must never claim a
 * consumed keyword, since the same text also says 「[BloodDinner] 60 증가」, which is generation.
 */
export const CONSUMED_KEYWORDS = ['BloodDinner'] as const;

export const ATTACK_TYPES = ['Slash', 'Penetrate', 'Hit'] as const;

/** The three base attack skill slots the game calls 「스킬 1」~「스킬 3」. */
export const SKILL_SLOTS = [1, 2, 3] as const;

export const SINS = ['WRATH', 'LUST', 'SLOTH', 'GLUTTONY', 'GLOOM', 'PRIDE', 'ENVY'] as const;

export const PACK_GROUPS = [
  'chapter',
  'event',
  'attackType',
  'sin',
  'keyword',
  'longBattle',
  'hidden',
] as const;

export const DIFFICULTIES = ['normal', 'hard', 'parallel', 'extreme'] as const;

export const keywordSchema = z.enum(KEYWORDS);
export const statusKeywordSchema = z.enum(STATUS_KEYWORDS);
export const identityKeywordIdSchema = z.enum(IDENTITY_KEYWORDS);
export const attackTypeSchema = z.enum(ATTACK_TYPES);
export const skillSlotSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const sinSchema = z.enum(SINS);
export const packGroupSchema = z.enum(PACK_GROUPS);
export const difficultySchema = z.enum(DIFFICULTIES);

export type Keyword = z.infer<typeof keywordSchema>;
export type StatusKeyword = z.infer<typeof statusKeywordSchema>;
export type IdentityKeywordId = z.infer<typeof identityKeywordIdSchema>;
export type AttackType = z.infer<typeof attackTypeSchema>;
export type SkillSlot = z.infer<typeof skillSlotSchema>;
export type Sin = z.infer<typeof sinSchema>;
export type PackGroup = z.infer<typeof packGroupSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;

/** Korean is the primary display language; English is kept because the community uses both. */
export const localizedSchema = z.object({ ko: z.string(), en: z.string() });
export type Localized = z.infer<typeof localizedSchema>;

const floorSchema = z.number().int().min(1).max(15);

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Extra thresholds on the same condition, e.g. "3인 이상 ... 5인 이상이면 더 강하게".
 * The base `min` still gates activation; tiers only strengthen the effect.
 */
export const conditionTierSchema = z.object({
  min: z.number().int().positive(),
  label: z.string(),
});

export const conditionScopeSchema = z.enum(['deployed', 'formation', 'reserve']);
export type ConditionScope = z.infer<typeof conditionScopeSchema>;

export const conditionSchema = z.discriminatedUnion('type', [
  /**
   * "[X]를 부여하는 공격 스킬을 보유한 인격이 N인 이상", and its 소모 and multi-keyword forms.
   * Counts identities whose skills use the keyword — NOT identities tagged with it.
   */
  z.object({
    type: z.literal('keywordSkillCount'),
    /** One or more keywords. An identity using ANY of them counts, and counts ONCE. */
    keywords: z.array(identityKeywordIdSchema).min(1),
    /** 부여·획득 or 소모 (탄환·혈찬). Decides how the sentence reads, never how it counts. */
    verb: z.enum(['inflict', 'consume']).default('inflict'),
    /**
     * Null when the sentence names no threshold — 「…인격이 편성된 수에 따라 기프트 효과 강화」.
     * That is a count, not a bar: it is shown and never judged.
     */
    min: z.number().int().positive().nullable(),
    scope: conditionScopeSchema,
    includesSpecial: z.boolean(),
    tiers: z.array(conditionTierSchema).default([]),
    text: localizedSchema.optional(),
  }),
  /** "검계 (또는 흑운회) 소속 인격이 N인 이상" — any of `factions` counts. */
  z.object({
    type: z.literal('factionCount'),
    factions: z.array(z.string()).min(1),
    min: z.number().int().positive(),
    scope: conditionScopeSchema,
    tiers: z.array(conditionTierSchema).default([]),
    text: localizedSchema.optional(),
  }),
  /** "완전 공명이 N 이상" — depends on in-battle play, so it is reported, never enforced. */
  z.object({
    type: z.literal('fullResonance'),
    min: z.number().int().positive(),
    text: localizedSchema.optional(),
  }),
  /** The parser saw a threshold sentence it could not model. Shown verbatim in the UI. */
  z.object({
    type: z.literal('unparsed'),
    text: localizedSchema,
  }),
]);

export type Condition = z.infer<typeof conditionSchema>;

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

export const acquisitionKindSchema = z.enum([
  'general', // in pack pools and exclusive to none — can drop anywhere, but never guaranteed
  'packLimited', // 테마 팩 한정: listed in some pack's specificEgoGiftPool
  'fusionOnly', // shop/rest fusion only; never in a pack pool
  'startOnly', // only offered as a starting keyword gift
  'clearReward', // 클리어 보상: the guaranteed boss reward of one EXTREME (11-15) pack
  'hiddenBattle', // reward of the random 히든 전투 on floors 11-15; pack-independent, never guaranteed
  'event', // in the season pool but no pack path: specific choice events, 저주-축복, transforming gifts
  'material', // 잔영 series — exists only to be fused or sold
  'unknown', // referenced by the game data with no acquisition path we can see
]);
export type AcquisitionKind = z.infer<typeof acquisitionKindSchema>;

export const fusionRecipeSchema = z.object({
  /** Ingredient gift ids, sorted. Repeats mean the recipe needs that many copies. */
  ingredients: z.array(z.number().int()).min(2),
});

/** The one cross-keyword recipe: pick `aCount` of `aPool` plus `bCount` of `bPool`. */
export const mixedRecipeSchema = z.object({
  aPool: z.array(z.number().int()).min(1),
  aCount: z.number().int().positive(),
  bPool: z.array(z.number().int()).min(1),
  bCount: z.number().int().positive(),
});

/**
 * A skill shape a gift's effect keys off: 「참격 스킬을 사용할 경우」, 「분노 속성 스킬」,
 * 「참격 유형인 스킬 1」.
 *
 * This is NOT a `Condition`. A condition gates whether the gift works at all and the game states it
 * as a threshold over the party; a trigger says which of an identity's skills the gift acts on, and
 * the game states it inline in the effect sentence. They are counted differently, so they are kept
 * apart — see `scripts/lib/parse-skill-triggers.ts`.
 *
 * One trigger is an AND over its non-null fields; a gift fires when ANY of its triggers matches a
 * skill. 「타격 스킬 또는 나태 속성 스킬」 is two triggers, 「참격 유형인 스킬 1」 is one.
 */
export const skillTriggerSchema = z.object({
  /** 죄악 속성. Null when the sentence only names an attack type. */
  sin: sinSchema.nullable(),
  /** 참격/관통/타격. Null when the sentence only names a sin. */
  attackType: attackTypeSchema.nullable(),
  /** Slots the effect is limited to, ascending. Empty means any slot. */
  slots: z.array(skillSlotSchema).default([]),
  /**
   * What the skill does for the gift: `gate` means the effect only happens on such a skill,
   * `boost` means it happens anyway and such a skill makes it stronger (「효과가 강화되어」,
   * 「효과를 대신하여」). Read off the wording of the sentence, so it can be wrong about the
   * strength of a claim — never about whether the gift reacts to the skill at all.
   */
  effect: z.enum(['gate', 'boost']),
});

export type SkillTrigger = z.infer<typeof skillTriggerSchema>;

/**
 * What kind of help a gift's effect is. Not a game concept — the game never says — but the one
 * question a player sorting 90-odd gifts actually asks.
 */
export const EFFECT_BUCKETS = ['damage', 'survival', 'egoResource'] as const;
export const effectBucketSchema = z.enum(EFFECT_BUCKETS);
export type EffectBucket = z.infer<typeof effectBucketSchema>;

export const giftSchema = z.object({
  id: z.number().int(),
  name: localizedSchema,
  desc: localizedSchema,
  keyword: keywordSchema,
  tier: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal('EX')])
    .nullable(),
  sin: sinSchema.nullable(),
  price: z.number().int().nullable(),
  /** 0 = no enhancement, 1 = `+`, 2 = `++`. */
  upgradeLevels: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  tags: z.array(z.string()),
  /** Listed in `nonAcquireableInEasyIds` — cannot be obtained on Normal difficulty. */
  hardOnly: z.boolean(),
  /** In the current season's drop pool (or a fusion result of it). */
  obtainable: z.boolean(),
  acquisition: z.object({
    kind: acquisitionKindSchema,
    /** Packs whose pool contains this gift. Empty for fusion-only and start-only gifts. */
    packs: z.array(z.number().int()),
    /** Packs that list this gift as 테마 팩 한정. */
    exclusiveTo: z.array(z.number().int()),
    /** Set when the gift appears in a starting keyword pool. */
    startKeyword: keywordSchema.nullable(),
    /** The EXTREME pack whose boss drops this gift on clear (kind `clearReward`). */
    clearRewardOf: z.number().int().nullable(),
  }),
  /** Offered by the starlight-funded 기프트 관측 (from the season's observation data). */
  observable: z.boolean(),
  /** Sprite-atlas key for the gift icon; equals the id unless the data says otherwise. */
  icon: z.number().int(),
  fusion: z
    .object({
      recipes: z.array(fusionRecipeSchema),
      mixed: mixedRecipeSchema.optional(),
    })
    .nullable(),
  conditions: z.array(conditionSchema),
  /** Skill shapes this gift's effect keys off; empty when the effect names no skill. */
  skillTriggers: z.array(skillTriggerSchema).default([]),
  /**
   * Which kinds of help the effect gives, in `EFFECT_BUCKETS` order. A gift may help two ways —
   * 9025 잿빛 코트 deals damage AND heals — and then carries both, so the 「스킬」 탭 can list it
   * under each. Derived at build time; see `scripts/lib/gift-effects.ts`.
   *
   * SHOWN, NEVER PLANNED. Like `skillTriggers`, the planner does not read it.
   */
  effectBuckets: z.array(effectBucketSchema).default([]),
  /**
   * 1-based formation positions the whole effect is limited to, ascending — the game writes it as
   * 「[편성 3번 인격 전용 효과]」. Empty means every identity.
   *
   * SHOWN, NEVER JUDGED. The app has no formation-order control: `store.deck` is filled per sinner,
   * so a position in it is an accident of the order the player happened to pick, not a seat they
   * chose. Positions also run past the deployed party (9761 names 7번 and 8번). Filtering on it
   * would hand back an answer the player can neither verify nor change, so the panel prints the
   * restriction as a caveat and leaves the judgement to them.
   */
  formationSlots: z.array(z.number().int().min(1).max(12)).default([]),
  /**
   * The one fusion result this gift is a lower-tier, same-keyword ingredient of (조합 계승).
   * `요리 비법 전서 → 진혼`. Null when the gift feeds several results or none.
   */
  upgradeOf: z.number().int().nullable(),
  notes: localizedSchema.optional(),
});

export type Gift = z.infer<typeof giftSchema>;

// ---------------------------------------------------------------------------
// Theme packs
// ---------------------------------------------------------------------------

export const themePackSchema = z.object({
  id: z.number().int(),
  name: localizedSchema,
  /** The developer-facing `desc` from the static data. Kept for debugging, never shown. */
  devName: z.string(),
  group: packGroupSchema,
  /** 1-based floors this pack can appear on, per mode. */
  availability: z.object({
    normal: z.array(floorSchema),
    hard: z.array(floorSchema),
    parallel: z.array(floorSchema),
    extreme: z.array(floorSchema),
  }),
  /** False when the static data lists no selectable floors at all (story-dungeon-only packs). */
  selectable: z.boolean(),
  /** Everything the pack can drop, including its exclusives. */
  giftPool: z.array(z.number().int()),
  exclusiveGifts: z.array(z.number().int()),
  keywordAffinity: statusKeywordSchema.nullable(),
  sinAffinity: sinSchema.nullable(),
  attackTypeAffinity: attackTypeSchema.nullable(),
  bossIds: z.array(z.number().int()),
  /** Sprite key for the pack artwork (`uiConfigs.packSpriteId`), e.g. `Burn_hard`. */
  sprite: z.string(),
  notes: localizedSchema.optional(),
});

export type ThemePack = z.infer<typeof themePackSchema>;

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export const identityKeywordSchema = z
  .object({
    /**
     * Attack skills that inflict or gain the base keyword — the unit conditional gifts count.
     * For 탄환 this counts the skills that spend ammo, which is what the keyword means there.
     */
    skills: z.number().int().nonnegative(),
    /**
     * Attack skills that inflict or gain a "특수" variant (특수 충전 = 생체 재료, 특수 출혈 = 못 …).
     * Only conditions that say "또는 특수 X" (`includesSpecial`) count these.
     */
    specialSkills: z.number().int().nonnegative(),
  })
  .refine((k) => k.skills + k.specialSkills > 0, { message: 'a keyword entry needs at least one skill' });

/**
 * One base attack skill of an identity: which slot it sits in, and the two axes gift effects key
 * off. Do not confuse this with `identityKeywordSchema.skills`, which is a COUNT of skills that
 * inflict a keyword; this is the table those counts are drawn from.
 *
 * `copies` is how many of that skill the slot deck holds (3/2/1). A conditional alternate skill —
 * an awakened or transformed form — is `0`, and ~20% of identities have one.
 */
export const identitySkillSchema = z.object({
  slot: skillSlotSchema,
  sin: sinSchema.nullable(),
  attackType: attackTypeSchema.nullable(),
  copies: z.number().int().nonnegative(),
});

export type IdentitySkill = z.infer<typeof identitySkillSchema>;

export const identitySchema = z.object({
  id: z.number().int(),
  /** 1-12, derived from the id (1SSNN). */
  sinnerId: z.number().int().min(1).max(12),
  sinner: localizedSchema,
  title: localizedSchema,
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  season: z.number().int(),
  /** `associationList` — what gift conditions mean by 소속. */
  factions: z.array(z.string()),
  /** `unitKeywordList` — trait tags, distinct from 소속. */
  traits: z.array(z.string()),
  keywords: z.record(identityKeywordIdSchema, identityKeywordSchema),
  keywordSource: z.enum(['derived', 'backfilled', 'curated', 'none']),
  /** Every sin that appears somewhere in the kit, flattened. `skills` keeps the per-slot detail. */
  sins: z.array(sinSchema),
  /** Every attack type that appears somewhere in the kit, flattened. */
  attackTypes: z.array(attackTypeSchema),
  /** The base attack skills, one row each, sorted by slot. Empty when no source knows them. */
  skills: z.array(identitySkillSchema).default([]),
});

export type Identity = z.infer<typeof identitySchema>;

// ---------------------------------------------------------------------------
// Enums and rules
// ---------------------------------------------------------------------------

export const enumsSchema = z.object({
  keywords: z.array(z.object({ id: keywordSchema, name: localizedSchema, status: z.boolean() })),
  /**
   * Identity keywords that no gift uses, so they have no `keywords` row: 탄환 today. Kept apart so
   * the gift filters and the start-keyword picker keep offering only keywords gifts actually have.
   */
  identityOnlyKeywords: z.array(z.object({ id: identityKeywordIdSchema, name: localizedSchema })),
  factions: z.array(z.object({ id: z.string(), name: localizedSchema, deprecated: z.boolean() })),
  sinners: z.array(z.object({ id: z.number().int(), name: localizedSchema })),
  sins: z.array(sinSchema),
});

export type Enums = z.infer<typeof enumsSchema>;

/**
 * Game constants. Anything here must NOT be hard-coded in TypeScript — the game changes these
 * between seasons, and a curated override is how we record values the static data does not hold.
 */
export const rulesSchema = z.object({
  dungeonId: z.number().int(),
  floors: z.object({
    normal: z.array(floorSchema),
    hard: z.array(floorSchema),
    parallel: z.array(floorSchema),
    extreme: z.array(floorSchema),
  }),
  difficulty: z.object({
    hardIsSticky: z.boolean(),
    parallelRequiresAllHard: z.boolean(),
    extremeAllowsObservation: z.boolean(),
  }),
  /** How many of the 12 formation slots fight. `max` is what the UI lets the user deploy. */
  deployment: z.object({
    max: z.number().int().positive(),
    default: z.number().int().positive(),
    verified: z.boolean(),
  }),
  themePacksOfferedPerFloor: z.number().int().positive(),
  themePackRefreshCount: z.number().int().nonnegative(),
  themeObservation: z.object({
    base: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    unvisitedMultiplier: z.number().positive(),
  }),
  /** Starting gift chosen from a keyword pool (no starlight cost). */
  startGift: z.object({
    pickCount: z.number().int().nonnegative(),
    poolsByKeyword: z.record(keywordSchema, z.array(z.number().int())),
    newKeywordChipCost: z.number().int().nonnegative(),
    refreshStarlightCost: z.number().int().nonnegative(),
  }),
  /** The separate starlight-funded "E.G.O 기프트 관측" that grants extra gifts at run start. */
  giftObservation: z.object({
    max: z.number().int().nonnegative(),
    fusionResultsAllowed: z.boolean(),
    costTable: z.array(z.number().int().nonnegative()),
    verified: z.boolean(),
    source: z.string().optional(),
  }),
  starlight: z.object({
    initial: z.number().int().nonnegative(),
    hardClearMultiplier: z.number().positive(),
  }),
  fusion: z.object({
    tierScores: z.record(z.string(), z.number().int()),
    resultTierByScore: z.array(
      z.object({ min: z.number().int(), max: z.number().int(), tier: z.number().int() }),
    ),
    successProbabilityByIngredients: z.record(z.string(), z.number()),
    successProbabilityWithStarlight: z.record(z.string(), z.number()),
    maxShopSlots: z.number().int().positive(),
  }),
  upgradeCostByTier: z.record(z.string(), z.array(z.number().int())),
  /**
   * A gift present in at least this fraction of the selectable packs is treated as "general":
   * the planner stops routing for it and reports it as a normal drop instead.
   */
  generalGiftPackShare: z.number().min(0).max(1),
  hiddenPack: z
    .object({
      id: z.number().int(),
      floors: z.array(floorSchema),
      probability: z.number().nullable(),
      verified: z.boolean(),
      source: z.string().optional(),
    })
    .nullable(),
  /** The random extra battle on EXTREME floors whose stages drop the `hiddenBattle` gifts. */
  hiddenBattle: z
    .object({
      gifts: z.array(z.number().int()),
      floors: z.array(floorSchema),
      /** Chance the battle is offered on each of `floors`; null when the data gives none. */
      probabilityPerFloor: z.number().nullable(),
    })
    .nullable(),
});

export type Rules = z.infer<typeof rulesSchema>;

export const metaSchema = z.object({
  dataVersion: z.string(),
  schemaVersion: z.number().int(),
  dungeon: z.object({ id: z.number().int(), name: localizedSchema }),
  /**
   * The upstream revisions this data was built from. `sha` pins a source with one revision;
   * `languages` pins one whose languages live on separate branches, each moving on its own.
   */
  sources: z.record(
    z.string(),
    z.object({
      repo: z.string(),
      sha: z.string().optional(),
      languages: z.record(z.string(), z.string()).optional(),
      fetchedAt: z.string(),
    }),
  ),
  staticDataPresent: z.boolean(),
  /**
   * True while this season is built from sources that do not know all of it yet — a new Mirror
   * Dungeon whose per-pack general gift pool, prices or constants have not been extracted. The app
   * says so instead of presenting a half-right plan as if it were whole.
   */
  provisional: z.boolean().default(false),
  counts: z.object({
    gifts: z.number().int(),
    packs: z.number().int(),
    identities: z.number().int(),
    fusionRecipes: z.number().int(),
  }),
});

export type Meta = z.infer<typeof metaSchema>;

/**
 * `public/data/index.json`: which seasons are on disk and which one to open by default.
 *
 * The app asks this instead of guessing at directory names. A season whose static data has been
 * replaced upstream stays here as a frozen build — the pipeline rebuilds only the season its raw
 * data describes and leaves the others exactly as committed.
 */
export const seasonIndexSchema = z.object({
  default: z.number().int(),
  seasons: z.array(
    z.object({
      id: z.number().int(),
      name: localizedSchema,
      dataVersion: z.string(),
      lastFloor: floorSchema,
      provisional: z.boolean(),
    }),
  ),
});

export type SeasonIndex = z.infer<typeof seasonIndexSchema>;

/**
 * Which hand-drawn art files exist, written by `npm run art` and read by the app.
 *
 * Not game data — it describes `public/art/`, whose contents are the repository owner's own
 * drawings (game artwork is never committed). It lives here because the pipeline writes it and the
 * app reads it, which is what this file is for.
 *
 * `gifts` holds `Gift.icon` values, not `Gift.id`: they differ for 31 of the 446 gifts. `packs`
 * holds `ThemePack.sprite` values, of which 116 packs share 112.
 */
export const artManifestSchema = z.object({
  gifts: z.array(z.number().int()),
  packs: z.array(z.string()),
});
export type ArtManifest = z.infer<typeof artManifestSchema>;
export type SeasonEntry = SeasonIndex['seasons'][number];

export const giftsFileSchema = z.array(giftSchema);
export const packsFileSchema = z.array(themePackSchema);
export const identitiesFileSchema = z.array(identitySchema);

export interface GameData {
  meta: Meta;
  enums: Enums;
  rules: Rules;
  gifts: Gift[];
  packs: ThemePack[];
  identities: Identity[];
}
