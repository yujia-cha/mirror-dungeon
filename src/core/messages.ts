/**
 * The planner's own sentences — warnings, unresolved reasons, condition summaries.
 *
 * The words live in `docs/copy.md` with the rest of the site's text; `npm run copy` turns them into
 * `messages.generated.ts`, and this is the one way core reads them. Each key's parameters are
 * typed from the placeholders the sentence uses, so a sentence that gains a `{name}` breaks the
 * build at every call site that does not supply it, instead of printing 「{name}」 to a reader.
 */
import type { Localized } from './schema.ts';
import { fillTemplate, type TemplateValue } from './text.ts';
import { MESSAGES, type MessageParams } from './messages.generated.ts';

export type MessageKey = keyof typeof MESSAGES;
export type MessageParam = TemplateValue;

type ParamsArg<K extends MessageKey> =
  Record<never, never> extends MessageParams[K] ? [params?: MessageParams[K]] : [params: MessageParams[K]];

export function msg<K extends MessageKey>(key: K, ...[params]: ParamsArg<K>): Localized {
  const template = MESSAGES[key];
  const values = (params ?? {}) as Record<string, TemplateValue>;
  return { ko: fillTemplate(template.ko, 'ko', values), en: fillTemplate(template.en, 'en', values) };
}
