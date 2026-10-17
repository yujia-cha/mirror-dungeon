/**
 * `md{n}/skill-gifts.json` (M129): which gift effects each identity skill sets off — the
 * judgement of `src/core/effects.ts` laid out by identity and slot, so the app can answer 「what
 * does this skill switch on」 without walking every gift. Nothing here judges: an entry is written
 * exactly when core's `identityMeets` says yes, under the slots core's `slotsMeeting` names
 * (`"0"` when it names none — the identity meets it as a whole). `egoSkill` is left out; an
 * `anyOf` is split only to learn which options the identity meets, each option judged by core.
 */
import { identityMeets, slotsMeeting } from '../../src/core/index.ts';
import type {
  EffectRequirement,
  Gift,
  Identity,
  SkillGiftIndex,
  SkillGiftRef,
  SkillGiftSlot,
} from '../../src/core/schema.ts';

function slotsOf(identity: Identity, requirement: EffectRequirement): SkillGiftSlot[] {
  const slots = slotsMeeting(identity, requirement);
  return slots.length > 0 ? slots.map((slot) => String(slot) as SkillGiftSlot) : ['0'];
}

/** The slots under which one met requirement is listed, or none when the identity does not meet it. */
function slotsFor(identity: Identity, requirement: EffectRequirement): SkillGiftSlot[] {
  if (requirement.type === 'egoSkill') return [];
  if (identityMeets(identity, requirement) !== true) return [];
  if (requirement.type !== 'anyOf') return slotsOf(identity, requirement);
  const out = new Set<SkillGiftSlot>();
  for (const option of requirement.options)
    if (identityMeets(identity, option) === true) for (const slot of slotsOf(identity, option)) out.add(slot);
  return [...out];
}

const compareRef = (a: SkillGiftRef, b: SkillGiftRef): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function buildSkillGiftIndex(identities: readonly Identity[], gifts: readonly Gift[]): SkillGiftIndex {
  const out: SkillGiftIndex = {};
  const sortedGifts = [...gifts].sort((a, b) => a.id - b.id);
  for (const identity of [...identities].sort((a, b) => a.id - b.id)) {
    const bySlot = new Map<SkillGiftSlot, SkillGiftRef[]>();
    for (const gift of sortedGifts) {
      (gift.effects ?? []).forEach((effect, effectIndex) => {
        effect.requires.forEach((requirement, requirementIndex) => {
          for (const slot of slotsFor(identity, requirement)) {
            const list = bySlot.get(slot) ?? [];
            list.push([gift.id, effectIndex, requirementIndex]);
            bySlot.set(slot, list);
          }
        });
      });
    }
    if (bySlot.size === 0) continue;
    const slots: SkillGiftIndex[string] = {};
    for (const slot of [...bySlot.keys()].sort()) slots[slot] = bySlot.get(slot)!.sort(compareRef);
    out[String(identity.id)] = slots;
  }
  return out;
}

/**
 * The file text: one identity per line, its slots inline. Pretty-printing every triple on lines of
 * its own would make a 37k-entry file several megabytes; one line per identity keeps a diff readable.
 */
export function formatSkillGiftIndex(index: SkillGiftIndex): string {
  const lines = Object.keys(index)
    .sort()
    .map((id) => {
      const slots = index[id]!;
      const inner = Object.keys(slots)
        .sort()
        .map((slot) => `${JSON.stringify(slot)}:${JSON.stringify(slots[slot as SkillGiftSlot])}`)
        .join(',');
      return `  ${JSON.stringify(id)}: {${inner}}`;
    });
  return lines.length === 0 ? '{}\n' : `{\n${lines.join(',\n')}\n}\n`;
}
