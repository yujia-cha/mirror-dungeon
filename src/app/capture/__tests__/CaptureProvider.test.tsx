import { act, render, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureApi } from '../capture-context.ts';

const plan = {
  data: { packs: [], gifts: [], meta: { dataVersion: 'x', dungeon: { id: 7 } } },
  indexes: { giftById: new Map() },
  plan: null,
  shown: null,
  expectedIn: () => [],
  enterAt: () => undefined,
  leave: () => undefined,
};
vi.mock('../../shell/plan-context.ts', () => ({ usePlan: () => plan }));

const { CaptureProvider } = await import('../CaptureProvider.tsx');
const { useCaptureSession } = await import('../capture-context.ts');
const { useApp } = await import('../../store.ts');

describe('CaptureProvider', () => {
  it('keeps the same value when the screen around it re-renders for nothing of its own', () => {
    // Arrange: a parent that re-renders on demand, and a reader that counts its renders.
    let renders = 0;
    function Reader() {
      useCaptureSession();
      renders += 1;
      return null;
    }
    let bump = () => undefined as void;
    function Parent({ children }: { children: ReactNode }) {
      const [n, setN] = useState(0);
      bump = () => setN(n + 1);
      return <CaptureProvider>{children}</CaptureProvider>;
    }
    render(
      <Parent>
        <Reader />
      </Parent>,
    );
    const first = renders;
    // Act
    act(() => bump());
    act(() => bump());
    // Assert: the reader is the same element, so only a new value would render it again.
    expect(renders).toBe(first);
  });

  it('keeps the same value while the owner’s diagnostics record (M154)', async () => {
    // Arrange: the owner's diagnostics open and recording; a reader that counts its renders.
    useApp.setState((s) => ({ ui: { ...s.ui, diagEnabled: true, diagRecord: true } }));
    let renders = 0;
    let api: CaptureApi | null = null;
    function Reader() {
      api = useCaptureSession();
      renders += 1;
      return null;
    }
    render(
      <CaptureProvider>
        <Reader />
      </CaptureProvider>,
    );
    await waitFor(() => expect(api?.diagnostics.ready).toBe(true));
    const first = renders;
    const before = api!.diagnostics.getStats().records;
    // Act: something is recorded.
    act(() => api!.diagnostics.hooks.onAnswer?.({ kind: 'pack', floor: 1, ids: [1] }, [1]));
    // Assert: the count moved, and nobody reading the session rendered for it.
    expect(api!.diagnostics.getStats().records).toBe(before + 1);
    expect(renders).toBe(first);
    useApp.setState((s) => ({ ui: { ...s.ui, diagEnabled: false, diagRecord: false } }));
  });
});
