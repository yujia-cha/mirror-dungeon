/**
 * The guide's pictures and inline marks (M114): an image keeps the language's alt text and the
 * box the generator read, a video does not start itself under 「동작 줄이기」 and stops when its
 * card leaves, and a sentence's `**bold**` / link are drawn as such — never as raw HTML.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuideFigure, GuideText } from '../shell/GuideSheet.tsx';
import type { GuideMedia } from '../i18n.ts';

const IMAGE: GuideMedia = {
  src: 'guide/deck.webp',
  kind: 'image',
  alt: { ko: '덱 탭 화면', en: 'The deck tab' },
  width: 800,
  height: 500,
};
const VIDEO: GuideMedia = { src: 'guide/run.mp4', kind: 'video', alt: { ko: '런 화면', en: 'The run' } };

function reducedMotion(on: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: on && query.includes('prefers-reduced-motion'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('GuideFigure', () => {
  it('draws an image under BASE_URL with its box and the current language alt', () => {
    // Arrange / Act
    const { rerender } = render(<GuideFigure media={IMAGE} lang="ko" active />);
    const img = screen.getByTestId('guide-image');

    // Assert
    expect(img.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}guide/deck.webp`);
    expect(img).toHaveAttribute('alt', '덱 탭 화면');
    expect(img).toHaveAttribute('width', '800');
    expect(img).toHaveAttribute('height', '500');
    expect(img).toHaveAttribute('loading', 'lazy');

    rerender(<GuideFigure media={IMAGE} lang="en" active />);
    expect(screen.getByTestId('guide-image')).toHaveAttribute('alt', 'The deck tab');
  });

  it('plays a video muted while its card is on show and pauses it when the card leaves', () => {
    // Arrange
    reducedMotion(false);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    // Act
    const { rerender } = render(<GuideFigure media={VIDEO} lang="ko" active />);
    const video = screen.getByTestId('guide-video') as HTMLVideoElement;
    rerender(<GuideFigure media={VIDEO} lang="ko" active={false} />);

    // Assert
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('aria-label', '런 화면');
    expect(video).not.toHaveAttribute('controls');
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
  });

  it('does not start a video by itself under reduced motion and shows the controls instead', () => {
    // Arrange
    reducedMotion(true);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    // Act
    render(<GuideFigure media={VIDEO} lang="ko" active />);

    // Assert
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByTestId('guide-video')).toHaveAttribute('controls');
  });
});

describe('GuideText', () => {
  it('draws bold, code and a safe link, and keeps markup-like text as text', () => {
    // Arrange / Act
    const { container } = render(
      <p>
        <GuideText text="**덱 탭**의 `>>` · [설명](docs/route-algorithm.md) · <b>x</b>" />
      </p>,
    );

    // Assert
    expect(container.querySelector('strong')).toHaveTextContent('덱 탭');
    expect(container.querySelector('code')).toHaveTextContent('>>');
    expect(container.querySelector('a')).toHaveAttribute(
      'href',
      'https://github.com/yujia-cha/mirror-dungeon/blob/main/docs/route-algorithm.md',
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<b>x</b>');
  });
});
