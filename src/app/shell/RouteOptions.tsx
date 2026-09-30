/**
 * The route options shown under the items tab: the starting keyword, and one line on what it does
 * for the current goals. 'auto' follows the goals, so the line says which starting gift that buys
 * — or, when no pool holds a goal, that the keyword is the player's free choice. With a keyword
 * picked by hand it says what 'auto' would have taken instead.
 *
 * The line goes once the run leaves floor 1: the start is spent, and "pick any keyword" would no
 * longer be true. Given-up packs are not listed here — the route panel's unresolved card lists
 * them with their restore action. Observation lives in the slots above the selected gifts, and the
 * reset in the header.
 */
import type { Keyword } from '../../core/schema.ts';
import { withJosa } from '../format.ts';
import { pick, t } from '../i18n.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { useApp } from '../store.ts';
import { Card } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';

export function RouteOptions() {
  // `plan`, not `shown`: the start belongs to the goals as chosen, not to a previewed variant.
  const { data, lang, plan, giftName, keywordLabel } = usePlan();
  const options = useApp((s) => s.options);
  const setOptions = useApp((s) => s.setOptions);
  const started = useApp((s) => observationClosed(s.run));
  const start = plan?.start;

  const gift = (id: number) => withJosa(giftName(id), '을/를', lang);
  const note = started
    ? null
    : start?.startGift && start.keyword
      ? t('startKeywordGives', lang, { keyword: keywordLabel(start.keyword), gift: gift(start.startGift) })
      : start?.autoStartGift
        ? t('startKeywordAutoWould', lang, { gift: gift(start.autoStartGift) })
        : t('startKeywordFree', lang);

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
            <option value="auto">
              {start?.autoKeyword
                ? t('optionAutoResolved', lang, { keyword: keywordLabel(start.autoKeyword) })
                : t('optionAuto', lang)}
            </option>
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
        {note && (
          <p className="text-xs text-fg-2" data-testid="start-keyword-note">
            {note}
          </p>
        )}
      </Card>
    </div>
  );
}
