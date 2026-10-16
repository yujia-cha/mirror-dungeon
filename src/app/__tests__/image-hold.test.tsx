/**
 * M125: a picture drawn once stays held for the page, so a tile that mounts again (another floor,
 * a tab switch, a sheet) paints it in its first frame instead of flashing the bare tile. The
 * measurement that motivates this is in `docs/review/M125.md`; these pin the wiring — what gets
 * held, when, and that a held picture is never asked for twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { PackCard } from '../components/PackCard.tsx';
import {
  heldImageCount,
  holdImage,
  releaseHeldImages,
  setGiftIconManifest,
  setKeywordIconManifest,
  setPackImageManifest,
} from '../lib/assets.ts';
import { loadGameDataFromDisk } from '../../core/data/node.ts';

const data = loadGameDataFromDisk();
const SOURCE = { repo: 'r', sha: 's' };
const ENCODE = { width: 256, quality: 75 };

afterEach(() => {
  cleanup();
  releaseHeldImages();
  setGiftIconManifest(null);
  setKeywordIconManifest(null);
  setPackImageManifest(null);
});

describe('holdImage', () => {
  it('keeps one detached image per URL, decoded off the frame', () => {
    // Act: the same URL twice, another once.
    holdImage('/icons/gifts/1.webp');
    holdImage('/icons/gifts/1.webp');
    holdImage('/icons/gifts/2.webp');
    // Assert
    expect(heldImageCount()).toBe(2);
  });

  it('forgets everything on release', () => {
    holdImage('/icons/gifts/1.webp');
    releaseHeldImages();
    expect(heldImageCount()).toBe(0);
  });
});

describe('GiftIcon holds what it drew', () => {
  const gift = data.gifts.find((g) => g.keyword === 'Combustion')!;

  it('holds the picture and the keyword badge once they load, and only once across remounts', () => {
    // Arrange
    setGiftIconManifest({ source: SOURCE, icons: [gift.icon] });
    setKeywordIconManifest({ source: SOURCE, keywords: ['Combustion'] });
    const { unmount } = render(<GiftIcon gift={gift} size={44} lang="ko" />);
    const images = () => screen.getByTestId('gift-icon').querySelectorAll('img');
    expect(images()).toHaveLength(2);
    // Nothing is held before the browser has the file: holding must never start a download.
    expect(heldImageCount()).toBe(0);
    // Act
    images().forEach((img) => fireEvent.load(img));
    // Assert
    expect(heldImageCount()).toBe(2);
    // A second mount of the same tile (the floor drawn again) adds nothing.
    unmount();
    render(<GiftIcon gift={gift} size={44} lang="ko" />);
    images().forEach((img) => fireEvent.load(img));
    expect(heldImageCount()).toBe(2);
  });

  it('does not hold a picture that failed to load', () => {
    setGiftIconManifest({ source: SOURCE, icons: [gift.icon] });
    render(<GiftIcon gift={gift} size={44} lang="ko" />);
    fireEvent.error(screen.getByTestId('gift-dim').querySelector('img')!);
    expect(heldImageCount()).toBe(0);
    expect(screen.getByTestId('gift-dim').querySelector('img')).toBeNull();
  });
});

describe('PackCard holds what it drew', () => {
  const [a, b] = data.packs.filter(
    (pack, i, all) => all.findIndex((other) => other.sprite === pack.sprite) === i,
  );

  it('holds the pack art once it loads', () => {
    setPackImageManifest({ source: SOURCE, encode: ENCODE, packs: [a!.sprite] });
    render(<PackCard pack={a!} size={96} lang="ko" />);
    fireEvent.load(screen.getByTestId('pack-image').querySelector('img')!);
    expect(heldImageCount()).toBe(1);
  });

  it('keys a failure to the URL, so a 404 does not follow the card to the next pack', () => {
    // Arrange: both sprites listed; the first one's file is gone.
    setPackImageManifest({ source: SOURCE, encode: ENCODE, packs: [a!.sprite, b!.sprite] });
    const { rerender } = render(<PackCard pack={a!} size={96} lang="ko" />);
    fireEvent.error(screen.getByTestId('pack-image').querySelector('img')!);
    expect(screen.getByTestId('pack-image').querySelector('img')).toBeNull();
    // Act: the same card is asked to draw another pack (a list reordered under a stable slot).
    rerender(<PackCard pack={b!} size={96} lang="ko" />);
    // Assert
    expect(screen.getByTestId('pack-image').querySelector('img')).not.toBeNull();
    expect(heldImageCount()).toBe(0);
  });
});
