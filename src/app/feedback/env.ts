/**
 * The 「환경」 and 「상태」 facts a feedback issue carries (M127), read from the page and the plan.
 * The reading is split from the formatting so the formatting can be tested without a browser.
 */
import type { RoutePlan } from '../../core/types.ts';
import type { FeedbackEnv, RouteSummary } from './payload.ts';

/**
 * A user agent in a few words — `Chrome 141 · Windows`, `Safari 18 · iOS`. The whole string is
 * long, mostly noise, and would crowd the issue; the browser, its major version and the system are
 * what a layout bug turns on.
 */
export function shortUserAgent(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown OS';
  const browsers: [string, RegExp][] = [
    ['Edge', /Edg(?:A|iOS)?\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Whale', /Whale\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  for (const [name, re] of browsers) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]} · ${os}`;
  }
  return `unknown browser · ${os}`;
}

/** The route in numbers: what the summary card says, and the codes of what it could not do. */
export function routeSummary(plan: RoutePlan | null): RouteSummary | null {
  if (!plan) return null;
  return {
    covered: plan.stats.coveredWanted,
    total: plan.stats.totalWanted,
    unresolved: plan.unresolved.map((u) => ({ giftId: u.giftId, reason: u.reason })),
    warnings: plan.warnings.map((w) => w.code),
    capped: plan.stats.searchCapped,
  };
}

/** The page's environment, read now. */
export function readEnv(meta: {
  dataVersion: string;
  season: number;
  seasonName: string;
  lang: 'ko' | 'en';
  dark: boolean;
}): FeedbackEnv {
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return {
    dataVersion: meta.dataVersion,
    season: meta.season,
    seasonName: meta.seasonName,
    lang: meta.lang,
    theme: meta.dark ? 'dark' : 'light',
    viewport: `${window.innerWidth}x${window.innerHeight}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`,
    browser: shortUserAgent(navigator.userAgent),
    touch,
    page: `${window.location.origin}${window.location.pathname}`,
  };
}
