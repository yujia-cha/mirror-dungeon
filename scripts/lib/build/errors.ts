/**
 * How the build stops (M168). Every phase throws `BuildError` instead of calling `process.exit`,
 * so a failure anywhere before the write phase leaves `public/data` untouched — the entry script
 * (`scripts/build-data.ts`) is the only place that turns it into an exit code.
 */
export class BuildError extends Error {
  override readonly name = 'BuildError';
}

export function fail(message: string): never {
  throw new BuildError(message);
}
