/**
 * Arrow-key movement in a tab strip.
 *
 * Both strips in the app were plain buttons in a row until now: one Tab stop each, and the arrow
 * keys did nothing — which is not what `role="tablist"` promises a screen reader. The cases below
 * are the ARIA tabs pattern's own requirements, wrapping included.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useRovingTabs } from '../useRovingTabs.ts';

function Strip({ count, onSelect }: { count: number; onSelect?: (index: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const onKeyDown = useRovingTabs(ref, count, index, (next) => {
    setIndex(next);
    onSelect?.(next);
  });
  return (
    <div ref={ref} role="tablist" aria-label="strip" onKeyDown={onKeyDown}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" role="tab" aria-selected={i === index} tabIndex={i === index ? 0 : -1}>
          tab {i}
        </button>
      ))}
    </div>
  );
}

const strip = (): HTMLElement => screen.getByRole('tablist');
const selected = (): string => screen.getByRole('tab', { selected: true }).textContent ?? '';

describe('useRovingTabs', () => {
  it('leaves one Tab stop for the whole strip', () => {
    render(<Strip count={3} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    cleanup();
  });

  it('moves and selects with the arrow keys', () => {
    render(<Strip count={3} />);
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(selected()).toBe('tab 1');
    fireEvent.keyDown(strip(), { key: 'ArrowLeft' });
    expect(selected()).toBe('tab 0');
    cleanup();
  });

  it('wraps at both ends, as the pattern specifies', () => {
    render(<Strip count={3} />);
    fireEvent.keyDown(strip(), { key: 'ArrowLeft' });
    expect(selected()).toBe('tab 2');
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(selected()).toBe('tab 0');
    cleanup();
  });

  it('jumps to the ends with Home and End', () => {
    render(<Strip count={4} />);
    fireEvent.keyDown(strip(), { key: 'End' });
    expect(selected()).toBe('tab 3');
    fireEvent.keyDown(strip(), { key: 'Home' });
    expect(selected()).toBe('tab 0');
    cleanup();
  });

  it('moves focus with the selection, so the next press starts from the right tab', () => {
    render(<Strip count={3} />);
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'tab 1' }));
    cleanup();
  });

  it('ignores keys that are not its own, so typing still reaches the page', () => {
    const onSelect = vi.fn();
    render(<Strip count={3} onSelect={onSelect} />);
    for (const key of ['a', 'Enter', 'ArrowUp', 'Tab']) fireEvent.keyDown(strip(), { key });
    expect(onSelect).not.toHaveBeenCalled();
    cleanup();
  });

  it('does nothing at all with no tabs', () => {
    const onSelect = vi.fn();
    render(<Strip count={0} onSelect={onSelect} />);
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
    cleanup();
  });
});
