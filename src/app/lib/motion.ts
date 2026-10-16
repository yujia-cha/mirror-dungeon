/**
 * How to scroll for the player's motion setting. The global CSS rule turns off `scroll-behavior`
 * for 「동작 줄이기」, but a script's `scrollTo({ behavior: 'smooth' })` does not read CSS — it has to
 * ask (design system §8).
 */
export function scrollBehavior(): ScrollBehavior {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 'auto' : 'smooth';
}
