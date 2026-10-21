import type { Localized } from '../../../src/core/schema.ts';

export function loc(ko: string | undefined, en: string | undefined): Localized {
  return { ko: (ko ?? '').trim(), en: (en ?? '').trim() };
}

export function sortNums(xs: Iterable<number>): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/** Curated files use `_`-prefixed keys for comments and examples; they are never data. */
export function curatedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).filter(([key]) => !key.startsWith('_'));
}

export function applyNameOverride(base: Localized, override: Partial<Localized> | undefined): Localized {
  if (!override) return base;
  return { ko: override.ko ?? base.ko, en: override.en ?? base.en };
}

/** A curated file without its `_source` / `_note` keys, at every depth. */
export function withoutNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNotes);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, inner]) => [key, withoutNotes(inner)]),
    );
  return value;
}
