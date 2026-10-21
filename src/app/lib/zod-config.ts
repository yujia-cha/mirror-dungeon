/**
 * No `new Function` JIT in the schemas (M164). Zod 4 probes for it once, with a `new Function('')`
 * that the page's CSP (`script-src` without `'unsafe-eval'`) refuses: the throw is caught and Zod
 * falls back, but the browser still reports a violation (console error, `securitypolicyviolation`).
 * `jitless` skips the probe. The app parses each data file once per load, so the fast path buys
 * nothing here; the pipeline and tests, which parse far more, do not import this module.
 *
 * Imported first in `main.tsx`: the store parses its persisted state at import time.
 */
import { z } from 'zod';

z.config({ jitless: true });
