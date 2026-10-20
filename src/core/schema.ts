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
export const sinSchema = z.enum(SINS);
export const packGroupSchema = z.enum(PACK_GROUPS);
export const difficultySchema = z.enum(DIFFICULTIES);

export type Keyword = z.infer<typeof keywordSchema>;
export type StatusKeyword = z.infer<typeof statusKeywordSchema>;
export type IdentityKeywordId = z.infer<typeof identityKeywordIdSchema>;
export type AttackType = z.infer<typeof attackTypeSchema>;
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

/**
 * What a base skill sets off rather than inflicts (M150): [진동 폭발], [진폭 변환], [진폭 얽힘] —
 * the game's buff ids, as the skill text writes them.
 */
export const SKILL_MECHANICS = ['VibrationExplosion', 'Switch_Vibration', 'FusionVibration'] as const;
export const skillMechanicSchema = z.enum(SKILL_MECHANICS);
export type SkillMechanic = z.infer<typeof skillMechanicSchema>;
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

export const DEFENSE_TYPES = ['guard', 'evade', 'counter'] as const;
export const defenseTypeSchema = z.enum(DEFENSE_TYPES);
export type DefenseType = z.infer<typeof defenseTypeSchema>;

export const SKILL_SHAPES = [
  /** 「단일 코인 스킬」 — exactly one coin. */
  'singleCoin',
  /** 「코인 수가 N 이하인 스킬」. */
  'coinsAtMost',
  /** 「코인 수가 N 이상인 스킬」. */
  'coinsAtLeast',
  /** 「더하기 코인」 — any coin with operator ADD. */
  'plusCoin',
  /** 「빼기 코인」·「마이너스 코인」 — any coin with operator SUB. */
  'minusCoin',
  /** 「파괴 불가 코인」. */
  'unbreakableCoin',
  /** 「공격 가중치가 N 이상인 스킬」 (`targetNum`). */
  'weightAtLeast',
  /** 「공격 가중치가 N인 스킬」. */
  'weightExactly',
] as const;
export const skillShapeSchema = z.enum(SKILL_SHAPES);

/**
 * What one effect of a gift asks of the deployed party before it does anything (M129). Only
 * requirements the deck can fail are written: a state on an enemy or on oneself (「[화상]을 보유한
 * 적」, 「자신에게 [호흡]이 있으면」), a battle situation (체력·흐트러짐·속도·사망·E.G.O 자원·상점) and a
 * formation slot (「[편성 1번 인격 전용 효과]」) always hold, so they leave no requirement behind.
 * Without `min` a requirement holds with one deployed identity.
 */
const singleRequirementSchemas = [
  /** A base skill (S1~S3) that inflicts, gains or spends the keyword — 「[파열] 부여 시」, 「…을 부여하는 스킬 3」. */
  z.object({
    type: z.literal('skillKeyword'),
    /** An identity whose skill uses ANY of them counts, and counts once. */
    keywords: z.array(identityKeywordIdSchema).min(1),
    /** Counts a skill that uses only the 특수 variant — set when the text says 「또는 특수 X」. */
    includesSpecial: z.boolean(),
    /** 「스킬 3」 — only that slot counts. */
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    min: z.number().int().positive().optional(),
    scope: conditionScopeSchema.optional(),
  }),
  /**
   * A buff no gift hands out, so only an identity brings it — [각력【묘】], [진동 - 작열]. Ids are the
   * game's buff ids (`LegStrength`, `VibrationIgnition`); an identity's `buffs` lists the ones it uses.
   */
  z.object({ type: z.literal('identityBuff'), buffs: z.array(z.string()).min(1) }),
  /** 「X (또는 Y) 소속 인격」. */
  z.object({
    type: z.literal('faction'),
    factions: z.array(z.string()).min(1),
    min: z.number().int().positive().optional(),
    scope: conditionScopeSchema.optional(),
  }),
  /** 「거미집의 검 료슈가 덱에 편성되어 있으면」 — any of these identities in the formation. */
  z.object({ type: z.literal('identity'), ids: z.array(z.number().int()).min(1) }),
  /** 「오만 관통 스킬」, 「참격 스킬」, 「우울 속성 공격 스킬」 — one base skill must match every list given. */
  z.object({
    type: z.literal('skill'),
    sins: z.array(sinSchema).min(1).optional(),
    attackTypes: z.array(attackTypeSchema).min(1).optional(),
  }),
  /** 「질투 완전 공명」·「색욕 공명」 — a deployed base skill of the sin. 「완전 공명 N」 without a sin is no requirement. */
  z.object({ type: z.literal('resonance'), sins: z.array(sinSchema).min(1) }),
  /** A base skill of that build — coins or attack weight. `n` for the counted kinds. */
  z.object({ type: z.literal('shape'), kind: skillShapeSchema, n: z.number().int().positive().optional() }),
  /** 「반격 스킬」, 「회피 스킬」, 「수비 스킬」. */
  z.object({ type: z.literal('defense'), kinds: z.array(defenseTypeSchema).min(1) }),
  /**
   * A base skill that puts the keyword on ITS OWN user, or spends the user's own stack — 「자신의
   * [진동] 횟수를 소모하는 스킬」, 「자신에게 [화상]을 부여하는 기본 공격 스킬」 (M129). `skillKeyword`
   * counts only what lands on an enemy, so these are read from the skill's `self` facts.
   */
  /**
   * A base skill that sets off any of these — 「스킬로 [진동 폭발] 시」, 「[진폭 변환] … 효과를 보유한
   * 스킬」 (M150). Only a condition that names the skill is one (owner's call): 「[진동 폭발]된 적」 and
   * 「[진폭 변환] 시」 can come from a gift too, so they stay no requirement.
   */
  z.object({ type: z.literal('skillMechanic'), mechanics: z.array(skillMechanicSchema).min(1) }),
  z.object({
    type: z.literal('selfKeyword'),
    keywords: z.array(statusKeywordSchema).min(1),
    /** `gain`: the skill gives the user the keyword; `consume`: it spends the user's own. */
    verb: z.enum(['gain', 'consume']),
  }),
  /**
   * An E.G.O skill condition (「…을 부여하는 E.G.O 스킬 사용 시 발동」, 「분노 속성 E.G.O 스킬의 경우」).
   * Our data has no identity's E.G.O, so it always holds (owner's call) — it is written down so the
   * 추천 tab can put such gifts in a group of their own, last.
   */
  z.object({ type: z.literal('egoSkill') }),
] as const;

/**
 * 「A 또는 B」 across requirement kinds — 「화상 스킬 또는 색욕 스킬」, 「시지프 소속 또는 [PersonalityCharge]」
 * (M129, owner's call): one deployed identity meeting ANY option is enough. Options never nest.
 */
export const anyOfRequirementSchema = z.object({
  type: z.literal('anyOf'),
  options: z.array(z.discriminatedUnion('type', singleRequirementSchemas)).min(2),
});

export const effectRequirementSchema = z.discriminatedUnion('type', [
  ...singleRequirementSchemas,
  anyOfRequirementSchema,
]);

export type EffectRequirement = z.infer<typeof effectRequirementSchema>;
export type SingleRequirement = Exclude<EffectRequirement, { type: 'anyOf' }>;

/**
 * One effect of a gift (M129): a line of its description together with the 「- 」 bullets under it.
 * A `gate` is a heading that switches the whole gift on (「…이면, 이번 전투 동안 발동」, 「…일 때 발동」)
 * — its requirements bind every effect. A `note` (「※ …」, 「[중첩 발동 불가] …」) does nothing.
 * `unclassified` marks a line that reads like a condition the parser has no rule for; it is treated as
 * unconditional and listed in the review table.
 */
export const giftEffectSchema = z.object({
  kind: z.enum(['effect', 'gate', 'note']),
  requires: z.array(effectRequirementSchema),
  /**
   * Shown with who meets them, never required (M150): a condition a gift can meet as well as a skill —
   * 「[진동 폭발]이 적용된 적」 — names the skills that help without asking for them.
   */
  hints: z.array(effectRequirementSchema).optional(),
  unclassified: z.literal(true).optional(),
});

export type GiftEffect = z.infer<typeof giftEffectSchema>;

/**
 * One entry of `data/curated/gift-effects.json` (M129): the effects of a gift written by hand,
 * replacing what the parser reads from its text wholesale. `_source` says why.
 */
export const curatedGiftEffectSchema = z
  .object({ _source: z.string().min(1), effects: z.array(giftEffectSchema) })
  .strict();

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

/** One enhancement step of a gift (M130): `+` is level 1, `++` level 2. */
export const giftUpgradeSchema = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  /** The game's name for the step, 「하모닉스+」. */
  name: localizedSchema,
  /** The step's text; what changed is wrapped in `**` (`HIGHLIGHT_MARK`). */
  desc: localizedSchema,
});
export type GiftUpgrade = z.infer<typeof giftUpgradeSchema>;
/** The enhancement levels a player can pick; 0 (not enhanced) is the absence of a choice. */
export type UpgradeLevel = GiftUpgrade['level'];

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
  /**
   * The game's own text for each enhancement step (M130), `+` then `++`. Absent when the gift
   * cannot be enhanced or the game ships no text for its steps — the app then offers no choice.
   * `desc` is cleaned like the base `desc`, except that what the step changed keeps the game's
   * emphasis as `**…**` (`HIGHLIGHT_MARK` in `text.ts`; the app draws it with `splitHighlight`).
   */
  upgrades: z.array(giftUpgradeSchema).optional(),
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
  /** What each effect asks of the deck — the 추천 기프트 judgement (M129). Gates first, in text order. */
  effects: z.array(giftEffectSchema).optional(),
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
  /**
   * Sprite key for the pack artwork (`uiConfigs.packSpriteId`), e.g. `Burn_hard`. It becomes a file
   * name (`public/icons/packs/{sprite}.webp`, `public/art/packs/{sprite}.png`), so it is a plain word.
   */
  sprite: z.string().regex(/^[\w-]+$/),
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
 * One base attack skill (M129). Fields a source does not know are null, and a null never satisfies a
 * requirement — the judgement says 「모름」 rather than guess.
 */
export const identitySkillSchema = z.object({
  slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sin: sinSchema.nullable(),
  attackType: attackTypeSchema.nullable(),
  /** 공격 가중치 (`targetNum`, at full uptie). Null for an identity only the derived mirror knows. */
  weight: z.number().int().positive().nullable(),
  /** At full uptie. Null for an identity only the derived mirror knows (it states no coins). */
  coins: z
    .object({
      count: z.number().int().nonnegative(),
      /** Any coin with operator ADD. */
      plus: z.boolean(),
      /** Any coin with operator SUB. */
      minus: z.boolean(),
      /** Any 파괴 불가 코인 — the raw coin's `color: "GREY"`, the coins the KR text marks `[SuperCoin]`. */
      unbreakable: z.boolean(),
    })
    .nullable(),
  /**
   * The keywords this skill uses by the same rule `keywords` counts with (`buffCounts`): `base` for
   * the keyword itself, `special` for a 특수 variant of it.
   */
  keywords: z.partialRecord(identityKeywordIdSchema, z.object({ base: z.boolean(), special: z.boolean() })),
  /**
   * Status keywords this skill puts on its own user (`gain`) or spends from the user's own stack
   * (`consume`) — 자기 진동 소모, 자기 화상 부여 (M129). Not counted in `keywords`, which is what
   * lands on an enemy. Absent when no source tells.
   */
  self: z
    .partialRecord(statusKeywordSchema, z.object({ gain: z.boolean(), consume: z.boolean() }))
    .optional(),
  /** What the skill sets off (M150, `skillMechanic`) — read from its Korean text. Absent when none. */
  mechanics: z.array(skillMechanicSchema).optional(),
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
  // `partialRecord`: an enum-keyed `z.record` requires every key since Zod 4, and an identity has only
  // the keywords it has.
  keywords: z.partialRecord(identityKeywordIdSchema, identityKeywordSchema),
  keywordSource: z.enum(['derived', 'backfilled', 'curated', 'none']),
  sins: z.array(sinSchema),
  attackTypes: z.array(attackTypeSchema),
  /** The base attack skills S1~S3, one entry per skill (M129). Absent when no source knows them. */
  skills: z.array(identitySkillSchema).optional(),
  /** Its defense skills' kinds (M129). */
  defenseTypes: z.array(defenseTypeSchema).optional(),
  /**
   * Buff ids its skills and passives gain or inflict, special variants included (M129) — what an
   * `identityBuff` requirement looks for. Sorted. Read off the base attack and defense skills'
   * scripts and KR text, the battle passives' KR text (not the 서포트 패시브, which acts only while
   * the identity is not deployed) and the buffs it enters battle with; for a mirror-only identity
   * the mirror's `statuses` join in, which also carry tags like `SuperCoin`.
   */
  buffs: z.array(z.string()).optional(),
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
    // Partial for the same reason: not every keyword has a start pool (`None` has none).
    poolsByKeyword: z.partialRecord(keywordSchema, z.array(z.number().int())),
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

/**
 * `public/icons/gifts/manifest.json` — the game's gift icons the app ships for screen capture
 * (M92), each `{icon}.webp`, and the upstream commit they came from. Written by `npm run data:icons`.
 */
export const giftIconManifestSchema = z.object({
  source: z.object({ repo: z.string(), sha: z.string() }),
  icons: z.array(z.number().int()),
});
export type GiftIconManifest = z.infer<typeof giftIconManifestSchema>;

/**
 * `public/icons/keywords/manifest.json` — the game's keyword icons (M99), each `{Keyword}.webp`,
 * drawn as the gift tile's keyword badge and, with 탄환·혈찬, as the deck's identity keyword icons
 * (M131). A manifest of its own so that a takedown of one image set
 * stops one thing: without it the badge falls back to a coloured dot.
 */
export const iconKeywordSchema = z.enum([
  ...keywordSchema.exclude(['None']).options,
  'Bullet',
  'BloodDinner',
] as const);
/** A keyword with a game icon: every `Keyword` but `None`, plus the identity-only 탄환·혈찬 (M131). */
export type IconKeyword = z.infer<typeof iconKeywordSchema>;

export const keywordIconManifestSchema = z.object({
  source: z.object({ repo: z.string(), sha: z.string() }),
  keywords: z.array(iconKeywordSchema),
});
export type KeywordIconManifest = z.infer<typeof keywordIconManifestSchema>;

/**
 * `public/icons/packs/manifest.json` — the game's theme pack art (M100), each `{sprite}.webp`,
 * shrunk to `encode.width` and re-encoded at `encode.quality`. Its own manifest, like the others.
 */
export const packImageManifestSchema = z.object({
  source: z.object({ repo: z.string(), sha: z.string() }),
  encode: z.object({ width: z.number().int().positive(), quality: z.number().int().min(1).max(100) }),
  packs: z.array(z.string()),
});
export type PackImageManifest = z.infer<typeof packImageManifestSchema>;

/**
 * The game screens the screen-capture tracker tells apart (M95), in the order one wins when several
 * are on screen. The app keeps their titles (`src/app/capture/screens.ts`); the layout below says
 * where on the screen each one is read.
 */
export const CAPTURE_SCREENS = [
  'acquired',
  'fusionConfirm',
  'sellConfirm',
  'fusionKeyword',
  'purchase',
  'sell',
  'enhance',
  'fusion',
  // The shop's own screen (M148): its red 「상점」/「특별한 상점」 heading, top left.
  'shop',
  'packSelect',
  'exploring',
  // The run start (M135): 기프트 관측 has a title of its own; the start gift picker only its panel's.
  'observationSelect',
  'startGiftSelect',
] as const;
export type CaptureScreen = (typeof CAPTURE_SCREENS)[number];

/** A rectangle of the captured client area in fractions: x, y, width, height, inside the frame. */
const captureRegionSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().gt(0).max(1),
    z.number().gt(0).max(1),
  ])
  .refine(([x, y, w, h]) => x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9, 'region runs off the frame');

/**
 * `public/data/capture-layout.json` — where the game draws what the tracker reads (M103), from
 * `data/curated/capture-layout.json`. Shared by every season: it is the client's layout, not the
 * dungeon's.
 */
export const captureLayoutSchema = z.object({
  /** The capture size the regions were measured on. */
  reference: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  /**
   * Banner regions in reading order, each with the screens whose title can appear in it. `raw`:
   * when the light-text pass finds no title there, read the untouched crop too — only for titles
   * drawn in colours the pass erases (M108: the bench found two; the others never needed it, and
   * the second read doubles what a frame showing nothing costs). `"only"`: the untouched crop
   * alone, for titles the light pass never reads (M136: the run start's two).
   */
  titles: z
    .array(
      z.object({
        region: captureRegionSchema,
        screens: z.array(z.enum(CAPTURE_SCREENS)).min(1),
        raw: z.union([z.boolean(), z.literal('only')]).optional(),
        /**
         * Read the dim-text pass first (M159, `isolateDimText`): a heading drawn dark on black that
         * neither the light pass nor the untouched crop reads (the shop's 「상점」 came out 「사저」).
         */
        dim: z.boolean().optional(),
      }),
    )
    .min(1),
  names: z.object({
    popup: captureRegionSchema,
    selected: captureRegionSchema,
    centerConfirm: captureRegionSchema,
    mapHeader: captureRegionSchema,
  }),
  /** The fusion confirm: its 「선택한 기프트 N/M」 header and the two slot shapes it comes in. */
  fusion: z.object({
    count: captureRegionSchema,
    five: z.array(captureRegionSchema).length(5),
    three: z.array(captureRegionSchema).length(3),
  }),
  /**
   * The acquired popup's gift icon (M136): read when the popup's name is no sure match, to tell the
   * gift by its picture among the gifts whose names the text came closest to.
   */
  popupIcon: captureRegionSchema,
});
export type CaptureLayout = z.infer<typeof captureLayoutSchema>;

/**
 * The owner's diagnostics bundle (M112): what the screen reader read, what the player corrected,
 * and how the route compared with the run — exported from the app as `session.json` inside a zip
 * (`frames/{id}.jpg` beside it) and read back by `npm run capture:feedback`. Never committed: the
 * frames are game screens. Loose where the app's own shapes are (events, actions), strict on the
 * envelope, so an old bundle still parses after the app moves on.
 */
const diagMatchSchema = z.union([
  z.object({ status: z.literal('match'), id: z.number(), score: z.number(), margin: z.number() }),
  z.object({
    status: z.literal('ambiguous'),
    ids: z.array(z.number()),
    score: z.number(),
    margin: z.number(),
  }),
  z.object({ status: z.literal('none') }),
]);
const diagEventSchema = z.object({ kind: z.string() }).passthrough();
export const diagTraceStepSchema = z.object({
  /**
   * What was being read: a title region, a name, the floor, the fusion header, the slots, what a
   * popup sits over (M135), or the popup's icon when its name was unsure (M136). `selectCount` was
   * the start pickers' 「선택 n/m」, read only by M135's build — kept so a bundle of it still parses.
   */
  step: z.enum(['title', 'name', 'floor', 'fusionCount', 'slots', 'selectCount', 'context', 'icon']),
  region: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** The light-text pass (true) or not (false); null for the icon slots. */
  light: z.boolean().nullable(),
  /** The dim-text pass (M159) rather than the untouched crop, where `light` is false. */
  dim: z.boolean().optional(),
  lines: z.array(z.string()),
  /** This pass's lines were taken (a screen named, a name matched, a number found). */
  accepted: z.boolean(),
  match: diagMatchSchema.optional(),
  screen: z.string().nullable().optional(),
  /** Icon slots: the shape tried and each slot's top candidates. */
  slots: z
    .object({
      shape: z.enum(['five', 'three']),
      top: z.array(z.array(z.tuple([z.number(), z.number()]))),
      /** What each slot's tier numeral allowed (M152); null where it did not read. */
      tiers: z.array(z.array(z.number()).nullable()).optional(),
    })
    .optional(),
  /** The popup's icon (M136): every candidate tried, [gift, score], best first. */
  icon: z.array(z.tuple([z.number(), z.number()])).optional(),
});
export type DiagTraceStep = z.infer<typeof diagTraceStepSchema>;

/** A measure's p50/p90 over its recent samples, ms (M142); `n` how many, where counted. */
const diagPercentilesSchema = z.object({ p50: z.number(), p90: z.number(), n: z.number().optional() });

const diagFloorGiftSchema = z.object({
  giftId: z.number(),
  status: z.enum(['got', 'failed', 'used']).nullable(),
});

export const diagRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session'),
    t: z.number(),
    status: z.string(),
    error: z.string().nullable(),
    interval: z.string(),
    lang: z.enum(['ko', 'en']),
    captureSize: z.object({ width: z.number(), height: z.number() }).nullable(),
    /** The window title bar over the game, px (M134) — on the records told when the picture's size or bar changes. */
    inset: z.object({ top: z.number() }).optional(),
  }),
  z.object({
    kind: z.literal('read'),
    t: z.number(),
    reason: z.enum(['change', 'dirty', 'refresh']),
    ms: z.number(),
    ocrCalls: z.number(),
    screen: z.string().nullable(),
    floor: z.number().nullable(),
    pack: diagMatchSchema.nullable(),
    gift: diagMatchSchema.nullable(),
    ingredients: z.object({ consumed: z.array(z.number()), unsure: z.array(z.number()) }).nullable(),
    trace: z.array(diagTraceStepSchema),
    events: z.array(diagEventSchema),
    /** The frame kept for this read, `frames/{frameId}.jpg`. */
    frameId: z.string().nullable(),
    /**
     * Ticks that came while this read was busy (and so were skipped), and how many of them saw the
     * screen differ from the frame being read (M134) — a popup that came and went between reads.
     * Missing in bundles before M134.
     */
    busyTicks: z.number().optional(),
    busyChanges: z.number().optional(),
    /**
     * `popup`: a read of the popup burst (M136) — it looked at the popup's title only and stopped
     * there when no popup showed. `slots`: a re-read of the fusion confirm's slots alone, no OCR
     * (M159). Missing = a full read, as every read was before M136.
     */
    mode: z.enum(['full', 'popup', 'slots']).optional(),
    /**
     * A read of a popup that came while another read was busy (M141): its crop was queued and read
     * once that read was done, as a popup read. `t` is when it was snapshotted, `lagMs` how long it
     * waited. Missing = read when its tick came, as every read was before M141.
     */
    queued: z.literal(true).optional(),
    lagMs: z.number().optional(),
    /** Queued popups pushed out unread (the queue was full) since the read before (M141). */
    queueDropped: z.number().optional(),
  }),
  z.object({
    /**
     * Reads not kept one record each, summed (M153): `scan` — popup reads that found no popup (the
     * title alone, `Frame.partial`, queued or not; an hour's run made eleven thousand of them, more
     * than half the records); `capped` — reads that made no event and kept no frame, past the cap of
     * such read records. One record per kind of read (`cause` × `mode`) at most every 10 s, and when
     * the session's status changes or the device exports. `t` is the last read's time, `from` the
     * first's; `ms`, `ocrCalls`, `lagMs` sums like the reads' own; `popups`/`queuedPopups` the reads
     * whose screen was `acquired` (none for `scan`); `screens` the reads by screen (`(none)` for
     * null); `changedUnder` the reads with a busy tick that saw the screen change. Missing before
     * M153: every read was a record.
     */
    kind: z.literal('readSummary'),
    t: z.number(),
    from: z.number(),
    cause: z.enum(['scan', 'capped']),
    mode: z.enum(['full', 'popup', 'slots']),
    reads: z.number(),
    ms: z.number(),
    ocrCalls: z.number(),
    queued: z.number(),
    lagMs: z.number(),
    lagMaxMs: z.number(),
    popups: z.number(),
    queuedPopups: z.number(),
    queueDropped: z.number(),
    busyTicks: z.number(),
    busyChanges: z.number(),
    changedUnder: z.number(),
    screens: z.record(z.string(), z.number()),
  }),
  z.object({
    kind: z.literal('applied'),
    t: z.number(),
    logId: z.number(),
    /** The read that produced it (its `t`), or null for an answered question. */
    readT: z.number().nullable(),
    event: diagEventSchema,
    actions: z.array(z.unknown()),
  }),
  z.object({ kind: z.literal('undo'), t: z.number(), logId: z.number() }),
  z.object({
    /**
     * Starting the reader started the run (M143): `new` (a snapshot taken, the run started over
     * when it had progress) or `continue` (read on the run as it was); or `rollback`, the run put
     * back to its snapshot. `run` is the run the choice was made on, in counts. Missing before M143.
     */
    kind: z.literal('runMark'),
    t: z.number(),
    mark: z.enum(['new', 'continue', 'rollback']),
    hadProgress: z.boolean(),
    run: z.object({
      currentFloor: z.number(),
      visits: z.number(),
      got: z.number(),
      failed: z.number(),
      startDone: z.boolean(),
    }),
  }),
  z.object({
    kind: z.literal('answer'),
    t: z.number(),
    ask: z.object({ kind: z.string() }).passthrough(),
    picked: z.array(z.number()),
  }),
  z.object({
    /** A change to the run the player made by hand. While the reader runs, a likely miss. */
    kind: z.literal('manual'),
    t: z.number(),
    capturing: z.boolean(),
    visits: z.array(z.object({ floor: z.number(), from: z.number().nullable(), to: z.number().nullable() })),
    status: z.array(
      z.object({
        giftId: z.number(),
        from: z.enum(['got', 'failed', 'used']).nullable(),
        to: z.enum(['got', 'failed', 'used']).nullable(),
      }),
    ),
    currentFloor: z.object({ from: z.number(), to: z.number() }).nullable(),
    /** Frames kept around it (the reader's last few reads), when it happened while reading. */
    frameIds: z.array(z.string()),
  }),
  z.object({
    /** A floor left behind: what the route offered, what was entered, how its gifts went. */
    kind: z.literal('floor'),
    t: z.number(),
    floor: z.number(),
    recommended: z.number().nullable(),
    window: z.object({ from: z.number(), to: z.number() }).nullable(),
    alternatives: z.array(z.number()),
    entered: z.number().nullable(),
    expected: z.array(diagFloorGiftSchema),
    startGifts: z.array(z.number()),
  }),
  z.object({
    /**
     * A filmstrip (M134): the session's small previews of every tick, from a few seconds before
     * the reads that made events (`reads`, their `t`) or the hand-made changes (`manual`, their
     * `t`) to a few seconds after — what the screen showed between reads. Overlapping windows are
     * one strip. Its frames are `class: 'preview'`, not full size.
     */
    kind: z.literal('strip'),
    t: z.number(),
    reads: z.array(z.number()),
    manual: z.array(z.number()),
    frameIds: z.array(z.string()),
  }),
  z.object({
    /**
     * The environment the reader ran in (M142), every 10 s and whenever the load level moved
     * (`reason`): the share's frame rate asked and delivered (null where the browser does not say),
     * how late the timer ticks fired and what reads took (p50/p90 of the recent samples, null with
     * none), backlog overflow since the record before, the preset's range, the tick interval and
     * the load level (0–2, `pace.ts`). Missing in bundles before M142.
     */
    kind: z.literal('env'),
    t: z.number(),
    reason: z.enum(['periodic', 'level']),
    fps: z.object({
      requested: z.number(),
      delivered: z.number().nullable(),
      setting: z.number().nullable(),
    }),
    lateness: diagPercentilesSchema.nullable(),
    readFull: diagPercentilesSchema.nullable(),
    readPopup: diagPercentilesSchema.nullable(),
    queueDropped: z.number(),
    range: z.object({ min: z.number(), max: z.number() }),
    interval: z.number(),
    level: z.number(),
  }),
  z.object({
    /** A run that ended (the last floor left) or was thrown away for a new one. */
    kind: z.literal('run'),
    t: z.number(),
    ended: z.enum(['done', 'reset']),
    goals: z.array(diagFloorGiftSchema),
    fusionGoal: z.record(z.string(), z.string()),
    deck: z.array(z.number().nullable()),
    unresolved: z.array(z.object({ giftId: z.number(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
]);
export type DiagRecord = z.infer<typeof diagRecordSchema>;

export const DIAG_FORMAT = 1;

/**
 * Why a frame was kept, which decides what goes first past the caps (M134): `routine` (an event
 * the player let stand), then `sample` (the first few events of each screen kind — regression
 * fixtures), then `unknown` (a screen with text the reader did not know), then `evidence` (around
 * a hand-made change, an undone event, a read that asked). `preview` is a filmstrip's small
 * picture, with a cap of its own. Bundles before M134 say nothing: `routine`.
 */
export const DIAG_FRAME_CLASSES = ['routine', 'sample', 'unknown', 'evidence', 'preview'] as const;
export type DiagFrameClass = (typeof DIAG_FRAME_CLASSES)[number];

export const diagnosticsBundleSchema = z.object({
  format: z.literal(DIAG_FORMAT),
  bundleId: z.string(),
  startedAt: z.number(),
  exportedAt: z.number(),
  dataVersion: z.string(),
  season: z.number(),
  layoutReference: z.object({ width: z.number(), height: z.number() }).nullable(),
  records: z.array(diagRecordSchema),
  frames: z.array(
    z.object({
      id: z.string(),
      t: z.number(),
      bytes: z.number(),
      class: z.enum(DIAG_FRAME_CLASSES).optional(),
    }),
  ),
});
export type DiagnosticsBundle = z.infer<typeof diagnosticsBundleSchema>;

/**
 * One part of a diagnostics export split to fit an attachment limit (M146): every part is a zip of
 * its own carrying this as `part.json`, and part 1 also carries `session.json`. `frames` are the
 * frame files (`frames/{id}.jpg`) in this part. A bundle exported before M146 has no `part.json`
 * and is one whole part.
 */
export const DIAG_PART_FILE = 'part.json';
/** The most parts one export may be split into (`diagPartSchema.total`). */
export const DIAG_PART_MAX_TOTAL = 64;
export const diagPartSchema = z
  .object({
    bundleId: z.string(),
    /** With `bundleId`, which export this is: two exports of one recording share the bundle id. */
    exportedAt: z.number(),
    part: z.number().int().min(1),
    /** An export is at most 64 parts: a 25 MB part each, far past what the recorder keeps. */
    total: z.number().int().min(1).max(DIAG_PART_MAX_TOTAL),
    frames: z.array(z.string()),
  })
  .refine((part) => part.part <= part.total, { message: 'part is past total', path: ['part'] });
export type DiagPart = z.infer<typeof diagPartSchema>;
export type SeasonEntry = SeasonIndex['seasons'][number];

/**
 * `data/curated/seasons/md{n}/rules.json` — the per-season constants no source ships.
 *
 * Deliberately **strict**, and deliberately small. Before this schema existed the loader read the
 * file through `{ [key: string]: unknown }`, so a typo or an invented key was silently ignored:
 * someone could write `"starlight": {…}`, wait for it to take effect, and nothing would happen or
 * say why.
 *
 * What is **not** here, and must not be added:
 *
 *   `egoGiftPool` / per-pack general pools — 115 selectable packs × ~190 ids. Cannot be written by
 *   hand and cannot be checked against anything. A season missing them is `provisional`, and that
 *   is the honest answer.
 *   `prices` — 446 numbers that do not follow from tier (tier 4 alone spreads over 373–450 in 38
 *   distinct values), and the app reads `price` in exactly one place: the gift filter. The planner
 *   never does.
 *   `observable` — 312 ids across 11 keyword buckets.
 *
 * The reason is not the typing effort. A schema that accepts them invites someone to fill them in
 * halfway and switch `provisional` off, and at that moment `build-data` promotes a half-known
 * season to `index.default` — the one thing the provisional mechanism exists to prevent. So the
 * strict key list is a door, and the rejection message says where to go instead.
 */
export const curatedSeasonSchema = z
  .object({
    /** Set while a season is only half known; keeps it from becoming `index.default`. */
    provisional: z.boolean().optional(),
    /** Only while the localization has no name for the dungeon yet. */
    name: localizedSchema.optional(),
    floors: z
      .object({
        normal: z.array(floorSchema),
        hard: z.array(floorSchema),
        parallel: z.array(floorSchema),
        extreme: z.array(floorSchema),
      })
      .optional(),
    themePacksOfferedPerFloor: z.number().int().positive().optional(),
    themePackRefreshCount: z.number().int().nonnegative().optional(),
    giftObservation: z
      .object({
        max: z.number().int().nonnegative(),
        fusionResultsAllowed: z.boolean(),
        costTable: z.array(z.number().int().nonnegative()),
      })
      .optional(),
    starlight: z
      .object({
        initial: z.number().int().nonnegative(),
        hardClearMultiplier: z.number().positive(),
      })
      .optional(),
    fusion: z
      .object({
        successProbabilityByIngredients: z.record(z.string(), z.number()).optional(),
        successProbabilityWithStarlight: z.record(z.string(), z.number()).optional(),
        maxShopSlots: z.number().int().positive().optional(),
      })
      .optional(),
    upgradeCostByTier: z.record(z.string(), z.array(z.number().int())).optional(),
    /**
     * The owner's stand-in for what the static data has not shipped yet, applied only to packs and
     * gifts backfilled from the derived mirror. A pack the static data does carry always keeps its
     * own pool, so importing the season's static data retires these without an edit. The season
     * stays `provisional` while any backfilled pack is selectable.
     *
     * - `generalPool: "allGeneral"`: such a pack drops every general gift of the season. In MD7 a
     *   general gift sits in 22–88 of 115 packs, so this over-states the pool on purpose.
     * - `exclusivesObservable`: such a pack's exclusive gifts can be observed.
     */
    backfillAssumptions: z
      .object({
        generalPool: z.literal('allGeneral').optional(),
        exclusivesObservable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /**
     * Where each value above came from, keyed by its path (`floors`, `giftObservation.costTable`).
     * `validate-data` requires one per value key: CLAUDE.md asks every curated entry to carry its
     * `_source`, and this is the first time a machine checks it.
     */
    _sources: z.record(z.string(), z.string()).optional(),
  })
  // `_`-prefixed keys are comments and examples, never data — the same convention the other
  // curated files use.
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (key.startsWith('_') || KNOWN_CURATED_SEASON_KEYS.has(key)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          `unknown key. Per-pack general gift pools, prices and observation lists are not written ` +
          `by hand — a season without them is marked "provisional": true and the planner explains ` +
          `what it cannot reach. See .claude/skills/update-game-data/SKILL.md §3.`,
      });
    }
  });

/** The value keys `curatedSeasonSchema` accepts; anything else is rejected by name. */
export const KNOWN_CURATED_SEASON_KEYS = new Set([
  'provisional',
  'name',
  'floors',
  'themePacksOfferedPerFloor',
  'themePackRefreshCount',
  'giftObservation',
  'starlight',
  'fusion',
  'upgradeCostByTier',
  'backfillAssumptions',
  '_sources',
]);

export type CuratedSeason = z.infer<typeof curatedSeasonSchema>;

export const giftsFileSchema = z.array(giftSchema);
export const packsFileSchema = z.array(themePackSchema);
export const identitiesFileSchema = z.array(identitySchema);

/**
 * `md{n}/skill-gifts.json` (M129): which gift effects each identity's skills set off — by identity
 * id, then by slot (`"1"`–`"3"` a base skill, `"0"` the identity as a whole: a faction, a buff, a
 * defense kind, a named identity, or a keyword read off totals without per-skill facts), a list of
 * `[giftId, effectIndex, requirementIndex]` into `gift.effects[effectIndex].requires`. Built by
 * `data:build` from core's `identityMeets`/`slotsMeeting`, so it is what the judgement says, laid
 * out the other way round. `egoSkill` is left out (no identity's E.G.O is in the data); an `anyOf`
 * is listed at its own index under the slots of the options the identity meets. Sorted.
 */
export const skillGiftSlotSchema = z.enum(['0', '1', '2', '3']);
export const skillGiftRefSchema = z.tuple([
  z.number().int(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
export const skillGiftIndexSchema = z.record(
  z.string().regex(/^\d+$/),
  z.partialRecord(skillGiftSlotSchema, z.array(skillGiftRefSchema).min(1)),
);

export type SkillGiftSlot = z.infer<typeof skillGiftSlotSchema>;
export type SkillGiftRef = z.infer<typeof skillGiftRefSchema>;
export type SkillGiftIndex = z.infer<typeof skillGiftIndexSchema>;

export interface GameData {
  meta: Meta;
  enums: Enums;
  rules: Rules;
  gifts: Gift[];
  packs: ThemePack[];
  identities: Identity[];
  /** `md{n}/skill-gifts.json`; absent for a frozen season built before it existed (M129). */
  skillGifts?: SkillGiftIndex;
}

/**
 * The machine-readable half of a visitor's feedback issue (M127, `src/app/feedback/payload.ts`),
 * as `npm run feedback:decode` reads it back. The issue is public, so anyone can write the block:
 * the decoder checks every field its report reads before trusting it (M154). The share state's
 * plan options, which the report only passes on, are checked as an object. Unknown keys are
 * allowed — the decoder keeps the payload as it was sent.
 */
export const FEEDBACK_PAYLOAD_VERSION = 1;

const feedbackLogEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    t: z.number(),
    kind: z.literal('error'),
    source: z.enum(['render', 'load', 'window', 'promise']),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({ t: z.number(), kind: z.literal('action'), text: z.string() }),
]);

const visitorRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    t: z.number(),
    kind: z.literal('error'),
    source: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({ t: z.number(), kind: z.literal('action'), text: z.string() }),
  z.object({
    t: z.number(),
    kind: z.literal('floor'),
    floor: z.number(),
    recommended: z.number().nullable(),
    alternatives: z.array(z.number()),
    entered: z.number().nullable(),
    expected: z.array(z.tuple([z.number(), z.string().nullable()])),
  }),
  z.object({
    t: z.number(),
    kind: z.literal('read'),
    screen: z.string().nullable(),
    floor: z.number().nullable(),
    pack: z.number().nullable(),
    gift: z.number().nullable(),
    events: z.array(z.string()),
  }),
  z.object({
    t: z.number(),
    kind: z.literal('applied'),
    event: z.string(),
    actions: z.number(),
    fromRead: z.boolean(),
  }),
  z.object({ t: z.number(), kind: z.literal('undo'), logId: z.number() }),
  z.object({ t: z.number(), kind: z.literal('answer'), ask: z.string(), picked: z.array(z.number()) }),
  z.object({ t: z.number(), kind: z.literal('session'), status: z.string(), error: z.string().nullable() }),
]);

const feedbackIds = z.array(z.number().int());

export const feedbackPayloadSchema = z.object({
  v: z.literal(FEEDBACK_PAYLOAD_VERSION),
  /** When it was written, epoch ms — inside what `Date` can hold, so a decoder can print it. */
  t: z.number().int().min(0).max(8.64e15),
  kind: z.enum(['bug', 'idea', 'data', 'other']),
  title: z.string(),
  message: z.string(),
  env: z.object({
    dataVersion: z.string(),
    season: z.number(),
    seasonName: z.string(),
    lang: z.enum(['ko', 'en']),
    theme: z.enum(['dark', 'light']),
    viewport: z.string(),
    browser: z.string(),
    touch: z.boolean(),
    page: z.string(),
  }),
  state: z
    .object({
      shareUrl: z.string(),
      shared: z.object({
        season: z.number().optional(),
        deck: feedbackIds,
        deployed: feedbackIds,
        wanted: feedbackIds,
        options: z.custom<object>((v) => typeof v === 'object' && v !== null && !Array.isArray(v), {
          message: 'expected an object',
        }),
      }),
      run: z.object({
        currentFloor: z.number().int(),
        stageFloor: z.number().int(),
        visits: z.record(z.string(), z.number().int()),
        giftStatus: z.record(z.string(), z.enum(['got', 'failed', 'used'])),
        startGifts: feedbackIds,
        collectRest: feedbackIds.optional(),
        startDone: z.boolean().optional(),
      }),
      route: z
        .object({
          covered: z.number(),
          total: z.number(),
          unresolved: z.array(z.object({ giftId: z.number().int(), reason: z.string() })),
          warnings: z.array(z.string()),
          capped: z.boolean(),
        })
        .nullable(),
    })
    .optional(),
  log: z.object({ entries: z.array(feedbackLogEntrySchema), omitted: z.number() }).optional(),
  diagnostics: z
    .object({
      total: z.number(),
      counts: z.record(z.string(), z.number()),
      from: z.number().nullable(),
      to: z.number().nullable(),
      records: z.array(visitorRecordSchema),
      omitted: z.number(),
    })
    .optional(),
  screenshot: z.boolean(),
});
export type CheckedFeedbackPayload = z.infer<typeof feedbackPayloadSchema>;
