import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert, Hourglass } from 'lucide-react';
import type { GameData, SeasonIndex } from '../core/schema.ts';
import { analyseDeck, buildIndexes } from '../core/index.ts';
import { DataLoadError, loadArtManifest, loadGameData, loadSeasonIndex } from '../core/data/load.ts';
import { t, type StringKey } from './i18n.ts';
import { decodeShared, encodeShared, runInProgress, useApp } from './store.ts';
import type { SharedState } from './store.ts';
import { defaultDeck } from './lib/default-deck.ts';
import { setArtManifest } from './lib/assets.ts';
import { lastFloorOf } from './lib/stage.ts';
import { Button, Card, Skeleton, Toast } from './components/ui.tsx';
import { ConfirmDialog } from './components/ConfirmDialog.tsx';
import { AppShell } from './shell/AppShell.tsx';

/**
 * A load failure the error card can say in the reader's language. `code` is set for the causes
 * core names; anything else (a Zod failure on `index.json`, say) keeps its raw message, which is
 * developer-facing but better than an empty card.
 */
type LoadFailure = { code: StringKey; params: Record<string, string | number>; text?: undefined } | { code?: undefined; params?: undefined; text: string };

const FAILURE_KEY = {
  http: 'loadFailedHttp',
  timeout: 'loadFailedTimeout',
  network: 'loadFailedNetwork',
  malformed: 'loadFailedMalformed',
} as const satisfies Record<DataLoadError['cause'], StringKey>;

function loadFailure(cause: unknown): LoadFailure {
  if (cause instanceof DataLoadError) {
    return { code: FAILURE_KEY[cause.cause], params: { label: cause.label, status: cause.status ?? '' } };
  }
  return { text: cause instanceof Error ? cause.message : String(cause) };
}

export function App() {
  const lang = useApp((s) => s.lang);
  const dark = useApp((s) => s.dark);
  const deck = useApp((s) => s.deck);
  const deployed = useApp((s) => s.deployed);
  const wanted = useApp((s) => s.wanted);
  const fusionGoal = useApp((s) => s.fusionGoal);
  const setLang = useApp((s) => s.setLang);
  const toggleDark = useApp((s) => s.toggleDark);
  const applyShared = useApp((s) => s.applyShared);
  const setDeck = useApp((s) => s.setDeck);
  const season = useApp((s) => s.season);
  const setSeason = useApp((s) => s.setSeason);
  const adoptSeason = useApp((s) => s.adoptSeason);

  const [index, setIndex] = useState<SeasonIndex | null>(null);
  const [attempt, setAttempt] = useState(0);
  /**
   * The load results carry what they are a result *of*.
   *
   * Both effects below used to open with `setError(null)` / `setData(null)` — clearing last time's
   * answer before asking again. That is a state write from an effect: a second render pass, and an
   * error once the React Compiler lint set is on. Storing the season and the attempt alongside the
   * value lets the render decide instead: a result for a season we are no longer opening, or for an
   * attempt we have since retried, simply reads as "still loading".
   */
  const [loaded, setLoaded] = useState<{ season: number; attempt: number; data: GameData } | null>(null);
  const [failure, setFailure] = useState<{ attempt: number; error: LoadFailure } | null>(null);
  const error = failure?.attempt === attempt ? failure.error : null;
  const [sharedCopied, setSharedCopied] = useState(false);
  /**
   * What the URL hash was carrying, read once during the first render.
   *
   * A share link must win over whatever localStorage remembers, or the link would not work. Reading
   * it in an effect meant deciding there too — `setLinkBroken`, `setPendingShared` — which is a
   * state write from an effect. Read during the first render instead, the answer can simply *be*
   * the initial state of both, and the effect is left with the side effects: applying the link and
   * rewriting the URL.
   */
  const [incoming] = useState((): { kind: 'none' | 'broken' } | { kind: 'ask' | 'apply'; shared: SharedState } => {
    if (!window.location.hash.startsWith('#s=')) return { kind: 'none' };
    const shared = decodeShared(window.location.hash);
    if (!shared) return { kind: 'broken' };
    // A link is someone else's plan, so applying it replaces the deck, the goals and the run. On a
    // fresh app that is what the reader wants; mid-run it destroys a record no undo can get back,
    // so a run in progress is asked about first.
    return runInProgress(useApp.getState().run) ? { kind: 'ask', shared } : { kind: 'apply', shared };
  });
  const [linkBroken, setLinkBroken] = useState(incoming.kind === 'broken');
  const [copyFailed, setCopyFailed] = useState(false);
  const [dropped, setDropped] = useState<{ gifts: number; packs: number } | null>(null);
  // Held decisions: a share link and a season change each throw the run away, so when one is
  // live the choice waits here for the confirmation below.
  const [pendingShared, setPendingShared] = useState<SharedState | null>(
    incoming.kind === 'ask' ? incoming.shared : null,
  );
  const [pendingSeason, setPendingSeason] = useState<number | null>(null);

  // The hash is consumed once and dropped from the URL, or a later reload would undo the user's
  // edits. A hash that says nothing to us is left in place: dropping it silently took away the only
  // copy of a link the reader might still want to re-open or pass on. A run in progress keeps the
  // hash until the question above is answered.
  useEffect(() => {
    if (incoming.kind !== 'apply') return;
    applyShared(incoming.shared);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, [applyShared, incoming]);

  // The broken-link notice says its piece and goes, like the dropped-goals one below.
  useEffect(() => {
    if (!linkBroken) return undefined;
    const timer = window.setTimeout(() => setLinkBroken(false), 6000);
    return () => window.clearTimeout(timer);
  }, [linkBroken]);

  const takeShared = (): void => {
    if (pendingShared) applyShared(pendingShared);
    setPendingShared(null);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    document.documentElement.lang = lang;
    // `index.html` is served in Korean — it is one static file and there is no server to vary it —
    // so the tab title stayed Korean for a reader who had switched to English. The document is the
    // one piece of chrome outside React, and this is the only place that knows the language.
    document.title = t('appTitle', lang);
  }, [lang]);

  // Which seasons are published is data, not a build-time constant, so the index comes first.
  useEffect(() => {
    let cancelled = false;
    loadSeasonIndex(import.meta.env.BASE_URL)
      .then((next) => {
        if (!cancelled) setIndex(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure({ attempt, error: loadFailure(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // A season the saved state or a share link names, while it is still published; otherwise the one
  // the index opens. A season that has been withdrawn must not leave the app with nothing to read.
  const openSeason = useMemo(() => {
    if (!index) return null;
    return season !== undefined && index.seasons.some((entry) => entry.id === season) ? season : index.default;
  }, [index, season]);

  const data = loaded && loaded.season === openSeason && loaded.attempt === attempt ? loaded.data : null;

  useEffect(() => {
    if (openSeason === null) return undefined;
    let cancelled = false;
    // The art manifest rides along with the season's data. It has to be in place *before* the
    // first render that draws tiles: `setArtManifest` is module state, so a late arrival would
    // not re-render anything. It never rejects — no manifest just means every tile draws its
    // name fallback — so it cannot make this load fail.
    Promise.all([
      loadGameData(import.meta.env.BASE_URL, { validate: import.meta.env.DEV, season: openSeason }),
      loadArtManifest(import.meta.env.BASE_URL),
    ])
      .then(([next, manifest]) => {
        if (cancelled) return;
        setArtManifest(manifest);
        // Goals this season never heard of cannot be drawn or planned, so they go — counted, not
        // quietly (the same rule the formation code follows for identities it does not know).
        const counts = adoptSeason({
          season: openSeason,
          lastFloor: lastFloorOf(next),
          giftIds: new Set(next.gifts.map((gift) => gift.id)),
          packIds: new Set(next.packs.map((pack) => pack.id)),
        });
        setLoaded({ season: openSeason, attempt, data: next });
        setDropped(counts.gifts + counts.packs > 0 ? counts : null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure({ attempt, error: loadFailure(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [openSeason, attempt, adoptSeason]);

  // The dropped-goals notice is a report, not a dialog: it says its piece and goes.
  useEffect(() => {
    if (!dropped) return undefined;
    const timer = window.setTimeout(() => setDropped(null), 6000);
    return () => window.clearTimeout(timer);
  }, [dropped]);

  // A first visit starts from the deck everyone owns; a share link or a saved deck arrives first
  // and wins. Seeding happens once, so emptying the deck by hand is not undone on the next render.
  const seeded = useRef(false);
  const indexes = useMemo(() => (data ? buildIndexes(data) : null), [data]);
  useEffect(() => {
    if (!data || !indexes || seeded.current) return;
    seeded.current = true;
    // Ids this season cannot resolve are already gone: `adoptSeason` runs on every load, counts
    // what it dropped and reports it above.
    if (useApp.getState().deck.length === 0) setDeck(defaultDeck(data), data.rules.deployment.default);
  }, [data, indexes, setDeck]);

  const stats = useMemo(
    () => (data && indexes ? analyseDeck(deck, indexes, data.rules.deployment, deployed) : null),
    [data, indexes, deck, deployed],
  );

  const share = async (): Promise<void> => {
    const url = `${window.location.origin}${window.location.pathname}${encodeShared({ season: useApp.getState().season, deck, deployed, wanted, fusionGoal, options: useApp.getState().options })}`;
    // Plain http and an unfocused document both leave `navigator.clipboard` unusable. Saying so
    // beats an unhandled rejection nobody sees.
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 3000);
      return;
    }
    setSharedCopied(true);
    window.setTimeout(() => setSharedCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <Card variant="strong" className="flex max-w-[360px] flex-col items-center gap-2.5 px-6 py-6 text-center">
          <TriangleAlert size={28} aria-hidden />
          <div className="text-sm font-semibold">{t('loadFailed', lang)}</div>
          <div className="text-xs text-fg-3">
            {error.code ? t(error.code, lang, error.params) : error.text}
            <br />
            {t('loadFailedHint', lang)}
          </div>
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw size={14} aria-hidden />
            {t('retry', lang)}
          </Button>
        </Card>
      </div>
    );
  }

  if (!data || !indexes || !stats) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[960px] flex-col gap-3 px-4 py-6" aria-busy="true">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-[88px]" />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-[96px] flex-col gap-2 rounded-md border border-line bg-surface p-3">
              <Skeleton className="h-2.5 w-2/5" />
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-3">
          <Hourglass size={13} aria-hidden />
          {t('loading', lang)}
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell
        data={data}
        indexes={indexes}
        stats={stats}
        lang={lang}
        dark={dark}
        seasons={index?.seasons ?? []}
        onSeason={(id) => (runInProgress(useApp.getState().run) ? setPendingSeason(id) : setSeason(id))}
        onShare={share}
        onToggleLang={() => setLang(lang === 'ko' ? 'en' : 'ko')}
        onToggleDark={toggleDark}
      />
      {pendingShared ? (
        <ConfirmDialog
          lang={lang}
          title={t('confirmSharedTitle', lang)}
          message={t('confirmSharedMessage', lang)}
          confirmLabel={t('confirmSharedConfirm', lang)}
          onConfirm={takeShared}
          // Cancelling leaves the hash in the URL: it is the reader's only copy of the link, and
          // they may want to open it after finishing the run.
          onCancel={() => setPendingShared(null)}
        />
      ) : pendingSeason !== null ? (
        <ConfirmDialog
          lang={lang}
          title={t('confirmSeasonTitle', lang)}
          message={t('confirmSeasonMessage', lang)}
          confirmLabel={t('confirmSeasonConfirm', lang)}
          onConfirm={() => {
            setSeason(pendingSeason);
            setPendingSeason(null);
          }}
          onCancel={() => setPendingSeason(null)}
        />
      ) : null}
      {sharedCopied ? (
        <Toast>{t('shared', lang)}</Toast>
      ) : dropped ? (
        <Toast>
          {[
            dropped.gifts > 0 ? t('seasonDroppedGifts', lang, { n: dropped.gifts }) : null,
            dropped.packs > 0 ? t('seasonDroppedPacks', lang, { n: dropped.packs }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Toast>
      ) : null}
      {copyFailed ? <Toast tone="alert">{t('copyFailed', lang)}</Toast> : null}
      {linkBroken ? <Toast tone="alert">{t('linkBroken', lang)}</Toast> : null}
    </>
  );
}
