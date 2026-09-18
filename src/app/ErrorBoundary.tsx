/**
 * The last line before a white screen. `planRoute()` runs synchronously inside render
 * (`PlanContext`), and the state it plans from is restored from localStorage — so a throw caused
 * by a bad saved state reproduces on every reload, forever. The one escape hatch the app has
 * (`resetAll` in the header) lives inside the tree that just died, which left clearing site data
 * by hand as the only way out. Hence the second button here.
 *
 * A class component because `getDerivedStateFromError` has no hook equivalent.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert, Trash2 } from 'lucide-react';
import { PERSIST_KEY } from './store.ts';
import { Button, Card } from './components/ui.tsx';

/**
 * The store may be the thing that is broken, so the language cannot come from it. The browser's
 * own preference is enough for two strings.
 */
function fallbackLang(): 'ko' | 'en' {
  try {
    return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

const TEXT = {
  ko: {
    title: '앱이 멈췄습니다',
    hint: '다시 시도해도 같은 화면이 나오면, 저장된 덱·목표·런 기록을 지우고 처음 상태로 시작할 수 있습니다.',
    retry: '다시 시도',
    clear: '저장된 상태를 지우고 새로 시작',
  },
  en: {
    title: 'The app stopped',
    hint: 'If retrying shows this again, you can clear the saved deck, goals and run record and start fresh.',
    retry: 'Retry',
    clear: 'Clear saved state and restart',
  },
} as const;

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // There is no telemetry in this app by design, so the console is the only record. Keep the
    // component stack: it is what tells a bug report which panel threw.
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = TEXT[fallbackLang()];
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <Card variant="strong" className="flex max-w-[360px] flex-col items-center gap-2.5 px-6 py-6 text-center" testId="crash">
          <TriangleAlert size={28} aria-hidden />
          <div className="text-sm font-semibold">{text.title}</div>
          <div className="text-xs text-fg-3">
            {error.message}
            <br />
            {text.hint}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              <RefreshCw size={14} aria-hidden />
              {text.retry}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                // The saved state is the likely cause, and the reload has to happen even if the
                // removal throws (Safari private mode) or the user stays stuck on this screen.
                try {
                  window.localStorage.removeItem(PERSIST_KEY);
                } catch {
                  /* nothing to clear, or storage is blocked — reload anyway */
                }
                window.location.reload();
              }}
            >
              <Trash2 size={14} aria-hidden />
              {text.clear}
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
