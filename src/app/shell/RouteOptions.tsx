/**
 * The route options shown under the items tab: the starting keyword and the packs the player gave
 * up. Packs set to include are not listed — that choice is made and shown where the route is, in
 * the pack sheet and the conflict groups, and a second copy here only made the tab longer.
 * Observation lives in the slots above the selected gifts, and the reset in the header.
 */
import type { Keyword } from '../../core/schema.ts';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { PackCard } from '../components/PackCard.tsx';
import { PackActions } from '../components/PackSheet.tsx';
import { Card, SectionTitle } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';

export function RouteOptions() {
  const { data, indexes, lang, ctx } = usePlan();
  const options = useApp((s) => s.options);
  const setOptions = useApp((s) => s.setOptions);
  const givenUpPacks = [...options.bannedPacks].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-2.5" data-testid="route-options">
      <Card className="flex flex-col gap-2 px-3.5 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-3">{t('optionStartKeyword', lang)}</span>
          <select
            aria-label={t('optionStartKeyword', lang)}
            value={options.startKeyword}
            onChange={(event) => setOptions({ startKeyword: event.target.value as Keyword | 'auto' })}
            className="h-[30px] rounded-full border border-line bg-surface-2 px-2.5 text-xs text-fg-2"
          >
            <option value="auto">{t('optionAuto', lang)}</option>
            {/* Only the keywords the season actually has a starting pool for. 범용 (`None`) is a
                gift keyword but has no pool, so offering it handed the player no starting gift at
                all, silently. Read from the rules rather than listed here, like everywhere else. */}
            {data.enums.keywords
              .filter((k) => data.rules.startGift.poolsByKeyword[k.id] !== undefined)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {pick(k.name, lang)}
                </option>
              ))}
          </select>
        </label>
      </Card>

      <Card className="px-3.5 py-3" testId="settings-packs">
        <SectionTitle>{t('packBanned', lang)}</SectionTitle>
        {givenUpPacks.length === 0 ? (
          <p className="mt-2 text-xs text-fg-3">{t('settingsNone', lang)}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {givenUpPacks.map((packId) => {
              const pack = indexes.packById.get(packId);
              if (!pack) return null;
              return (
                <li
                  key={packId}
                  className="flex items-center gap-2"
                  data-testid="settings-pack"
                  data-pack={packId}
                >
                  <PackCard pack={pack} size={28} lang={lang} />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-3 line-through">
                    {pick(pack.name, lang)}
                  </span>
                  <PackActions packId={packId} ctx={ctx} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
