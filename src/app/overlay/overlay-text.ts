/**
 * The overlay's 「방금 한 행동」 in sentences (M151): a run fact (`overlay-log.ts`) or a screen
 * reader entry, said with names — 「「커피와 종이학」 기프트를 획득했습니다」. Names stand in 「」
 * (quotes in English), so each sentence hangs its particle on the word after them (기프트·팩),
 * which does not change with the name: the app's own strings use no particle grammar.
 */
import { t, type Lang } from '../i18n.ts';
import type { CaptureLogEntry } from '../capture/useCapture.ts';
import type { RunFact } from './overlay-log.ts';

export interface NameOf {
  lang: Lang;
  gift: (id: number) => string;
  pack: (id: number) => string;
}

/** Names a line spells out before it says how many more (M151): a floor settles many at once. */
export const NAMES_SHOWN = 3;

/** 「A」, 「B」 — or "A", "B" — and past `NAMES_SHOWN`, 「외 n개」. */
export function quoted(names: readonly string[], lang: Lang): string {
  const shown = names
    .slice(0, NAMES_SHOWN)
    .map((name) => (lang === 'ko' ? `「${name}」` : `"${name}"`))
    .join(', ');
  const more = names.length - NAMES_SHOWN;
  return more > 0 ? `${shown} ${t('overlayLogMore', lang, { n: more })}` : shown;
}

const gifts = (ids: readonly number[], n: NameOf) => quoted(ids.map(n.gift), n.lang);
const pack = (id: number, n: NameOf) => quoted([n.pack(id)], n.lang);

/** A run fact in a sentence; null for one the window does not tell. */
export function factSentence(fact: RunFact, n: NameOf): string | null {
  const { lang } = n;
  switch (fact.kind) {
    case 'goal': {
      const lines = [
        ...(fact.added.length ? [t('overlayLogGoalAdd', lang, { names: gifts(fact.added, n) })] : []),
        ...(fact.removed.length ? [t('overlayLogGoalRemove', lang, { names: gifts(fact.removed, n) })] : []),
      ];
      return lines.length ? lines.join(' · ') : null;
    }
    case 'enter':
      return t('overlayLogEnter', lang, { floor: fact.floor, name: pack(fact.packId, n) });
    case 'leave':
      return t('overlayLogLeave', lang, { floor: fact.floor, name: pack(fact.packId, n) });
    case 'skip':
      return t('overlayLogSkip', lang, { floor: fact.floor });
    case 'status': {
      const names = gifts(fact.ids, n);
      if (fact.to === 'got') return t('overlayLogGot', lang, { names });
      if (fact.to === 'used') return t('overlayLogUsed', lang, { names });
      if (fact.to === 'failed') return t('overlayLogFailed', lang, { names });
      if (fact.from === 'got') return t('overlayLogClearedGot', lang, { names });
      if (fact.from === 'failed') return t('overlayLogClearedFailed', lang, { names });
      if (fact.from === 'used') return t('overlayLogClearedUsed', lang, { names });
      return null;
    }
    case 'start':
      return t(fact.done ? 'overlayLogStartDone' : 'overlayLogStartOpen', lang);
    case 'runNew':
      return t('overlayLogRunNew', lang);
    case 'rollback':
      return t('overlayLogRollback', lang);
    case 'runCleared':
      return t('overlayLogRunCleared', lang);
    case 'deck':
      return t('overlayLogDeck', lang);
  }
}

/** A screen reader entry in a sentence; null for one with nothing to tell. */
export function captureSentence(entry: Pick<CaptureLogEntry, 'event'>, n: NameOf): string | null {
  const { lang } = n;
  const e = entry.event;
  switch (e.kind) {
    case 'enter':
      return t('overlayLogEnter', lang, { floor: e.floor, name: pack(e.packId, n) });
    case 'got': {
      const key =
        e.source === 'observation'
          ? 'overlayLogGotObserved'
          : e.source === 'start'
            ? 'overlayLogGotStart'
            : 'overlayLogGot';
      return t(key, lang, { names: gifts([e.giftId], n) });
    }
    case 'startDone':
      return t('overlayLogStartDone', lang);
    case 'sold':
      return t('overlayLogSold', lang, { names: gifts([e.giftId], n) });
    case 'fused':
      return e.consumed.length
        ? t('overlayLogFused', lang, { ingredients: gifts(e.consumed, n), name: gifts([e.resultId], n) })
        : t('overlayLogFusedPlain', lang, { name: gifts([e.resultId], n) });
    case 'answer':
      return t('overlayLogAnswer', lang, {
        names: e.ask.kind === 'pack' ? quoted(e.picked.map(n.pack), lang) : gifts(e.picked, n),
      });
    default:
      return null;
  }
}

/**
 * What a reader entry is about, keyed like `factKeys` — the gifts and packs its run changes touch.
 * A fused entry names the result and what it ate; an answer, what was picked.
 */
export function captureKeys(entry: Pick<CaptureLogEntry, 'event'>): string[] {
  const e = entry.event;
  switch (e.kind) {
    case 'enter':
      return [`p${e.packId}`];
    case 'got':
    case 'sold':
      return [`g${e.giftId}`];
    case 'fused':
      return [e.resultId, ...e.consumed, ...e.unsure].map((id) => `g${id}`);
    case 'startDone':
      return ['start'];
    case 'answer':
      return e.ask.kind === 'pack'
        ? e.picked.map((id) => `p${id}`)
        : [...e.picked, ...(e.ask.kind === 'consumed' ? [] : (e.ask.fusing?.consumed ?? []))].map(
            (id) => `g${id}`,
          );
    default:
      return [];
  }
}
