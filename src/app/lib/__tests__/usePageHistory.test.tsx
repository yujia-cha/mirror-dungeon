/**
 * The layer stack behind the phone's back gesture.
 *
 * jsdom implements `pushState` but not history traversal — `history.back()` never produces a
 * `popstate` — so the back gesture itself is dispatched here rather than navigated. What is under
 * test is the part the app owns: which layer a pop closes, and that a layer closing itself does
 * not let the next pop close something else.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { usePageHistory } from '../usePageHistory.ts';

function Layer({ open, onClose, enabled = true }: { open: boolean; onClose: () => void; enabled?: boolean }) {
  usePageHistory(open, onClose, enabled);
  return null;
}

const pop = (): void => {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};

describe('usePageHistory', () => {
  it('closes the topmost layer first, then the one under it', () => {
    const closePage = vi.fn();
    const closeSheet = vi.fn();
    const view = render(
      <>
        <Layer open onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
      </>,
    );
    view.rerender(
      <>
        <Layer open onClose={closePage} />
        <Layer open onClose={closeSheet} />
      </>,
    );

    pop();
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closePage).not.toHaveBeenCalled();

    // The sheet's own state follows its onClose, so reflect that before the next gesture.
    view.rerender(
      <>
        <Layer open onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
      </>,
    );
    pop();
    expect(closePage).toHaveBeenCalledTimes(1);
  });

  it('swallows the pop from a layer that closed itself, so the next layer is not taken with it', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const view = render(<Layer open onClose={closeFirst} />);
    // Closing by its own button hands the entry back; the pop that answers is not a user gesture.
    view.rerender(<Layer open={false} onClose={closeFirst} />);
    view.rerender(
      <>
        <Layer open={false} onClose={closeFirst} />
        <Layer open onClose={closeSecond} />
      </>,
    );
    pop();
    expect(closeSecond).not.toHaveBeenCalled();
    expect(closeFirst).not.toHaveBeenCalled();

    // The next pop is the user's, and it closes the layer that is actually open.
    pop();
    expect(closeSecond).toHaveBeenCalledTimes(1);
  });

  it('owns no history entry on a desktop, where a panel is layout rather than a page', () => {
    const onClose = vi.fn();
    render(<Layer open onClose={onClose} enabled={false} />);
    pop();
    expect(onClose).not.toHaveBeenCalled();
  });
});
