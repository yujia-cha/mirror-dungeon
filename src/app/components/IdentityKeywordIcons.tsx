/**
 * An identity's keywords as the game's icons (M131), in three groups split by thin rules:
 * `[status keywords…] | [attack types…] | [탄환·혈찬]`. The deck slot and both identity searches draw
 * this one component.
 *
 * Each icon's `alt` is the word the old chip said (「특수 충전」, 「참격」, 「탄환」) and its `title`
 * the chip's hint, so a 특수 variant — which has no icon of its own (the owner's decision) — is still
 * named to screen readers and on hover, and the search keeps matching the same words. An icon the
 * keyword manifest does not ship (a takedown) falls back to the old text chip, item by item. An
 * empty group draws nothing, rule included.
 */
import { Swords } from 'lucide-react';
import { ATTACK_TYPES, STATUS_KEYWORDS } from '../../core/schema.ts';
import type { Enums, Identity, IdentityKeywordId } from '../../core/schema.ts';
import { t, type Lang } from '../i18n.ts';
import { identityKeywordLabel, keywordName } from '../format.ts';
import { holdImage, keywordIconUrl } from '../lib/assets.ts';
import { Chip } from './ui.tsx';

const STATUS = new Set<string>(STATUS_KEYWORDS);

interface Item {
  key: string;
  url: string | null;
  label: string;
  title: string;
  attack?: boolean;
}

function KeywordIcon({ item, lang }: { item: Item; lang: Lang }) {
  if (item.url) {
    const url = item.url;
    return (
      <img
        src={url}
        alt={item.label}
        title={item.title}
        width={16}
        height={16}
        loading="lazy"
        draggable={false}
        onLoad={() => holdImage(url)}
        className="block h-4 w-4 flex-none object-contain"
        data-keyword={item.key}
      />
    );
  }
  return (
    <Chip title={item.title}>
      {item.attack ? (
        <>
          <Swords size={10} aria-hidden />
          <span className="sr-only">{t('deckAttackTypes', lang)} </span>
        </>
      ) : null}
      {item.label}
    </Chip>
  );
}

export function IdentityKeywordIcons({
  identity,
  enums,
  lang,
}: {
  identity: Identity;
  enums: Enums;
  lang: Lang;
}) {
  // Name only — 「침잠」, not 「침잠 5」. Whether a keyword is the 특수 variant is part of the name.
  const keywordItem = (keyword: IdentityKeywordId): Item => {
    const { label, title } = identityKeywordLabel(keyword, identity.keywords[keyword], enums, lang);
    return { key: keyword, url: keywordIconUrl(keyword), label, title };
  };
  const present = Object.keys(identity.keywords) as IdentityKeywordId[];
  const status = present.filter((k) => STATUS.has(k)).map(keywordItem);
  const attacks: Item[] = ATTACK_TYPES.filter((type) => identity.attackTypes.includes(type)).map((type) => {
    const name = keywordName(type, enums, lang);
    return {
      key: type,
      url: keywordIconUrl(type),
      label: name,
      title: t('deckAttackTypeHint', lang, { type: name }),
      attack: true,
    };
  });
  const resources = present.filter((k) => !STATUS.has(k)).map(keywordItem);

  const groups = [
    { id: 'keywords', items: status },
    { id: 'attacks', items: attacks },
    { id: 'resources', items: resources },
  ].filter((g) => g.items.length > 0);
  // Nothing at all when an identity carries nothing to show.
  if (groups.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="identity-keywords">
      {groups.map((group, i) => (
        <span key={group.id} className="inline-flex items-center gap-1.5" data-group={group.id}>
          {i > 0 ? <span aria-hidden className="h-3 flex-none border-l border-border-strong" /> : null}
          <span className="inline-flex flex-wrap items-center gap-1">
            {group.id === 'attacks' && group.items.some((item) => item.url) ? (
              <span className="sr-only">{t('deckAttackTypes', lang)} </span>
            ) : null}
            {group.items.map((item) => (
              <KeywordIcon key={item.key} item={item} lang={lang} />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
