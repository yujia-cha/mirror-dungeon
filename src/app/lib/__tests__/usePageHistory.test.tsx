/**
 * The layer stack behind the phone's back gesture.
 *
 * jsdom traverses the history for real and asynchronously, as a browser does: `pushState` applies
 * at once, `history.back()`/`go()` land a few tasks later with a `popstate`. So the back gesture
 * here is a real `history.back()`, and each test waits for where the history lands — the depth the
 * module writes on its entries (`{ layer: n }`) — rather than for a fixed time.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { usePageHistory } from '../usePageHistory.ts';

function Layer({ open, onClose, enabled = true }: { open: boolean; onClose: () => void; enabled?: boolean }) {
  usePageHistory(open, onClose, enabled);
  return null;
}

/** How many layer entries the current one stands on (the module's marker). */
const depth = (): number => (window.history.state as { layer?: number } | null)?.layer ?? 0;

/** Wait for the module's own traversal to land at `n`. */
const settle = async (n: number): Promise<void> => {
  await waitFor(() => expect(depth()).toBe(n));
};

/** The device's back gesture: a real traversal, awaited until its `popstate` has been handled. */
const back = async (): Promise<void> => {
  await act(async () => {
    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    window.history.back();
    await popped;
  });
};

beforeEach(async () => {
  // The previous test's layers unmounted and gave their entries back; let that traversal land.
  await settle(0);
});

describe('usePageHistory', () => {
  it('closes the topmost layer first, then the one under it', async () => {
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
    expect(depth()).toBe(2);

    await back();
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closePage).not.toHaveBeenCalled();

    // The sheet's own state follows its onClose, so reflect that before the next gesture. Its
    // entry is already gone, so closing does not go back a second time.
    view.rerender(
      <>
        <Layer open onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
      </>,
    );
    await act(async () => undefined);
    expect(depth()).toBe(1);
    await back();
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(depth()).toBe(0);
  });

  it('goes back over the entry of a layer that closed itself, so the next back is the next layer’s', async () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const view = render(
      <>
        <Layer open onClose={closeFirst} />
        <Layer open={false} onClose={closeSecond} />
      </>,
    );
    expect(depth()).toBe(1);
    // Closing by its own button hands the entry back.
    view.rerender(
      <>
        <Layer open={false} onClose={closeFirst} />
        <Layer open={false} onClose={closeSecond} />
      </>,
    );
    // The next layer opens while that traversal is still in flight: it takes an entry once it lands.
    await act(async () => undefined);
    view.rerender(
      <>
        <Layer open={false} onClose={closeFirst} />
        <Layer open onClose={closeSecond} />
      </>,
    );
    await settle(1);
    await back();
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
  });

  /**
   * M124. The route page's 「기프트」 closes it and opens the items page in one commit. That used to
   * be a `history.back()` and a `pushState` back to back; Chrome applies the push at once and the
   * back later, so the back took the new page's entry and the next back left the app. Now the new
   * layer takes the released entry over: no push, no traversal, and the next back closes it.
   */
  it('hands the entry over when one layer closes as another opens in the same commit', async () => {
    const closeRight = vi.fn();
    const closeLeft = vi.fn();
    const view = render(
      <>
        <Layer open onClose={closeRight} />
        <Layer open={false} onClose={closeLeft} />
      </>,
    );
    const push = vi.spyOn(window.history, 'pushState');
    const go = vi.spyOn(window.history, 'go');
    const backCall = vi.spyOn(window.history, 'back');
    view.rerender(
      <>
        <Layer open={false} onClose={closeRight} />
        <Layer open onClose={closeLeft} />
      </>,
    );
    await act(async () => undefined);
    expect(push).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(backCall).not.toHaveBeenCalled();
    expect(depth()).toBe(1);
    vi.restoreAllMocks();

    await back();
    expect(closeLeft).toHaveBeenCalledTimes(1);
    expect(closeRight).not.toHaveBeenCalled();
    expect(depth()).toBe(0);
  });

  it('gives back every entry released together in one traversal', async () => {
    const closePage = vi.fn();
    const closeSheet = vi.fn();
    const closeNext = vi.fn();
    const view = render(
      <>
        <Layer open onClose={closePage} />
        <Layer open onClose={closeSheet} />
        <Layer open={false} onClose={closeNext} />
      </>,
    );
    expect(depth()).toBe(2);
    const go = vi.spyOn(window.history, 'go');
    view.rerender(
      <>
        <Layer open={false} onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
        <Layer open={false} onClose={closeNext} />
      </>,
    );
    await settle(0);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    expect(closePage).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();

    view.rerender(
      <>
        <Layer open={false} onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
        <Layer open onClose={closeNext} />
      </>,
    );
    await back();
    expect(closeNext).toHaveBeenCalledTimes(1);
  });

  /**
   * The old module counted its own backs and swallowed that many pops. Two backs a moment apart
   * collapse into one traversal (jsdom does it; so may a browser), the count never came down, and
   * the user's next real back was swallowed. Reading the depth the history landed on cannot drift.
   */
  it('stays in step when layers give their entries back a moment apart', async () => {
    const closePage = vi.fn();
    const closeSheet = vi.fn();
    const closeNext = vi.fn();
    const view = render(
      <>
        <Layer open onClose={closePage} />
        <Layer open onClose={closeSheet} />
        <Layer open={false} onClose={closeNext} />
      </>,
    );
    view.rerender(
      <>
        <Layer open onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
        <Layer open={false} onClose={closeNext} />
      </>,
    );
    await act(async () => undefined);
    view.rerender(
      <>
        <Layer open={false} onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
        <Layer open={false} onClose={closeNext} />
      </>,
    );
    await settle(0);
    view.rerender(
      <>
        <Layer open={false} onClose={closePage} />
        <Layer open={false} onClose={closeSheet} />
        <Layer open onClose={closeNext} />
      </>,
    );
    expect(depth()).toBe(1);
    await back();
    expect(closeNext).toHaveBeenCalledTimes(1);
    expect(closePage).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();
  });

  it('steps back off an entry no layer owns when the user goes forward onto it', async () => {
    const onClose = vi.fn();
    const view = render(<Layer open onClose={onClose} />);
    view.rerender(<Layer open={false} onClose={onClose} />);
    await settle(0);
    await act(async () => {
      const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
      window.history.forward();
      await popped;
    });
    await settle(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never writes the address: the entries are markers on the same URL', () => {
    const before = window.location.href;
    const push = vi.spyOn(window.history, 'pushState');
    render(<Layer open onClose={() => undefined} />);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[2]).toBeUndefined();
    expect(window.location.href).toBe(before);
  });

  it('owns no history entry on a desktop, where a panel is layout rather than a page', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(<Layer open onClose={() => undefined} enabled={false} />);
    expect(push).not.toHaveBeenCalled();
    expect(depth()).toBe(0);
  });
});
