import { act, render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
});
