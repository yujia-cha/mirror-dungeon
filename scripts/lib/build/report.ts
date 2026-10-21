import type { Identity } from '../../../src/core/schema.ts';
import type { BuildResult } from './index.ts';

function summarize(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}

/** The build's summary on stdout, after the write phase — what it made and what it could not read. */
export function reportBuild(built: BuildResult): void {
  const { sources, factions, packSet, giftSet, identitySet, unnamedBuffIds, output } = built;
  const { dungeonId, meta, enums } = output;
  const { gifts, diagnostics } = giftSet;
  const { packs, selectablePacks } = packSet;
  const { identities } = identitySet;
  const { lenient } = sources.options;

  console.log(
    `build-data: dungeon ${dungeonId}, dataVersion ${meta.dataVersion}${lenient ? ' (lenient)' : ''}`,
  );
  console.log(
    `  gifts ${gifts.length}, packs ${packs.length} (${selectablePacks.length} selectable), ` +
      `identities ${identities.length}, fusion recipes ${meta.counts.fusionRecipes}`,
  );
  console.log(`  acquisition: ${summarize(gifts.map((g) => g.acquisition.kind))}`);
  console.log(`  conditions: ${summarize(gifts.flatMap((g) => g.conditions.map((c) => c.type)))}`);
  {
    const effects = gifts.flatMap((g) => g.effects ?? []);
    const unclassified = effects.filter((e) => e.unclassified).length;
    console.log(
      `  effects: ${effects.length} (${summarize(effects.map((e) => e.kind))}), requirements: ` +
        `${summarize(effects.flatMap((e) => e.requires.map((r) => r.type)))}; ` +
        `${unclassified} unclassified line(s), ` +
        `${sources.curatedEffects.byId.size} curated gift(s)`,
    );
  }
  console.log(`  identity keywords: ${summarize(identities.map((i) => i.keywordSource))}`);
  console.log(
    `  특수 variants: ${sources.specialVariants.size} buff(s), ${identities.filter((i) => Object.values(i.keywords).some((k) => k.specialSkills > 0)).length} identities`,
  );
  console.log(
    `  identity-only keywords: ${enums.identityOnlyKeywords
      .map((k) => `${k.name.ko} ${identities.filter((i) => i.keywords[k.id]).length}`)
      .join(' · ')}`,
  );
  {
    // M129: how much of the per-skill data is actually known. A null is 「모름」 to the judgement.
    const withSkills = identities.filter((i) => i.skills && i.skills.length > 0);
    const nullCount = (pick: (s: NonNullable<Identity['skills']>[number]) => unknown): number =>
      withSkills.filter((i) => i.skills!.some((s) => pick(s) === null)).length;
    console.log(
      `  identity skills: ${withSkills.length} with skills, ${identities.length - withSkills.length} without` +
        ` · null sin ${nullCount((s) => s.sin)}, attack type ${nullCount((s) => s.attackType)},` +
        ` weight ${nullCount((s) => s.weight)}, coins ${nullCount((s) => s.coins)}` +
        ` · no defense ${identities.filter((i) => !i.defenseTypes?.length).length}` +
        ` · no buffs ${identities.filter((i) => !i.buffs?.length).length}`,
    );
    for (const [value, ids] of [...identitySet.unknownDefTypes].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  defense skill defType ${value} names no defense kind: ${ids.join(', ')}`);
    }
  }
  if (unnamedBuffIds.size > 0) {
    // Not an error: these are identity- or gift-specific buffs the game names nowhere we can read.
    console.log(
      `  ${unnamedBuffIds.size} buff id(s) left as ids in the text: ${[...unnamedBuffIds].sort().slice(0, 8).join(', ')}…`,
    );
  }
  if (diagnostics.missingText.length > 0) {
    console.log(
      `  ${diagnostics.missingText.length} gift(s) without Korean text: ${diagnostics.missingText.slice(0, 10).join(', ')}`,
    );
  }
  if (diagnostics.exclusivesOutsideDropPool.length > 0) {
    console.log(
      `  ${diagnostics.exclusivesOutsideDropPool.length} pack exclusive(s) obtainable by their pack though the drop pool omits them: ` +
        diagnostics.exclusivesOutsideDropPool.join(', '),
    );
  }
  if (factions.unnamed.length > 0) {
    console.log(
      `  ${factions.unnamed.length} faction(s) without a display name: ${factions.unnamed.join(', ')}` +
        ' — add them to data/curated/factions.json',
    );
  }
  if (diagnostics.upgradeWithoutText.length > 0) {
    console.log(
      `  ${diagnostics.upgradeWithoutText.length} enhanceable gift(s) without text for every step (no 강화 choice): ${diagnostics.upgradeWithoutText.slice(0, 10).join(', ')}`,
    );
  }
  if (diagnostics.unparsedConditionCount > 0) {
    console.log(
      `  ${diagnostics.unparsedConditionCount} condition sentence(s) could not be parsed (kept as "unparsed")`,
    );
  }
}
