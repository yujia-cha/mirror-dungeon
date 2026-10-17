/**
 * The route options shown under the items tab: the starting keyword, one line on what it does for
 * the current goals, and how many starting gifts the run takes (M134). 'auto' follows the goals,
 * so the line says which starting gifts that buys — or, when no pool holds a goal, that the
 * keyword is the player's free choice. With a keyword picked by hand it says what 'auto' would
 * have taken instead.
 *
 * The line and the count go once the start is over (`observationClosed` — floor 1 left, or the
 * observation screen passed): the start is spent, and "pick any keyword" would no longer be true.
 * Given-up packs are not listed here — the route panel's unresolved card lists them with their
 * restore action. Observation lives in the slots above the selected gifts, and the reset in the
 * header.
 */
import type { Keyword } from '../../core/schema.ts';
import { largestStartPool, startGiftBudget } from '../../core/index.ts';
import { withJosa } from '../format.ts';
import { pick, t } from '../i18n.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { useApp } from '../store.ts';
import { Button, Card, Select } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';

export function RouteOptions() {
  // `plan`, not `shown`: the start belongs to the goals as chosen, not to a previewed variant.
  const { data, lang, plan, giftName, keywordLabel } = usePlan();
  const options = useApp((s) => s.options);
  const setOptions = useApp((s) => s.setOptions);
  const started = useApp((s) => observationClosed(s.run));
  const start = plan?.start;

  // One gift per pick, all from one pool: 0 (「선택하지 않음」) up to the largest pool.
  const maxStartGifts = largestStartPool(data.rules);
  const startGiftCount = startGiftBudget(options, data.rules);
  const steps = Array.from({ length: maxStartGifts + 1 }, (_, i) => i);

  const gifts = (ids: number[]) =>
    withJosa(ids.map(giftName).join(lang === 'ko' ? ' · ' : ', '), '을/를', lang);
  const note = started
    ? null
    : start && start.startGifts.length > 0 && start.keyword
      ? t('startKeywordGives', lang, { keyword: keywordLabel(start.keyword), gift: gifts(start.startGifts) })
      : start && start.autoStartGifts.length > 0
        ? t('startKeywordAutoWould', lang, { gift: gifts(start.autoStartGifts) })
        : t('startKeywordFree', lang);

  return (
    <div className="flex flex-col gap-3" data-testid="route-options">
      <Card className="flex flex-col gap-2 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-fg-subtle">{t('optionStartKeyword', lang)}</span>
          {/* Only the keywords the season actually has a starting pool for. 범용 (`None`) is a gift
              keyword but has no pool, so offering it handed the player no starting gift at all,
              silently. Read from the rules rather than listed here, like everywhere else. */}
          <Select<Keyword | 'auto'>
            label={t('optionStartKeyword', lang)}
            value={options.startKeyword}
            options={[
              {
                value: 'auto',
                label: start?.autoKeyword
                  ? t('optionAutoResolved', lang, { keyword: keywordLabel(start.autoKeyword) })
                  : t('optionAuto', lang),
              },
              ...data.enums.keywords
                .filter((k) => data.rules.startGift.poolsByKeyword[k.id] !== undefined)
                .map((k) => ({ value: k.id, label: pick(k.name, lang) })),
            ]}
            onChange={(next) => setOptions({ startKeyword: next })}
          />
        </label>
        {note && (
          <p className="text-body text-fg-muted" data-testid="start-keyword-note">
            {note}
          </p>
        )}
        {started ? null : (
          <div
            role="group"
            aria-labelledby="start-gift-count-label"
            className="flex flex-col gap-1"
            data-testid="start-gift-count"
          >
            <span id="start-gift-count-label" className="text-caption text-fg-subtle">
              {t('optionStartGiftCount', lang)}
            </span>
            {/* Equal columns, like the size steps in the 「⋯」 menu. */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
              data-uniform="both"
            >
              {steps.map((n) => (
                <Button
                  key={n}
                  variant={n === startGiftCount ? 'primary' : 'secondary'}
                  pressed={n === startGiftCount}
                  title={n === 0 ? t('optionStartGiftNone', lang) : undefined}
                  // Back to "unset" on the rules' own count, so a state or a link stays as old ones were.
                  onClick={() =>
                    setOptions({
                      startGiftCount: n === data.rules.startGift.pickCount ? undefined : n,
                    })
                  }
                  testId={`start-gift-count-${n}`}
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-caption text-fg-muted">{t('optionStartGiftCountHint', lang)}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
