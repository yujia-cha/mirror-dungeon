/**
 * Read a visitor's feedback issue back (M127): the ```` ```md-feedback ```` block of an issue body
 * decoded into the payload the app built, and a Markdown report of it for the owner.
 *
 * Pure. `scripts/feedback-decode.ts` reads the body (a file or stdin), names ids against the
 * season's data and writes the files.
 */
import { decodePayload, type DecodeResult, type FeedbackPayload } from '../../src/app/feedback/payload.ts';

export { decodePayload, type DecodeResult, type FeedbackPayload };

/** Where the public site lives: share links are rebuilt on it, whatever page the report came from. */
export const PUBLIC_SITE = 'https://yujia-cha.github.io/mirror-dungeon/';

/** The share link on the public site, or null when the state was not attached. */
export function publicShareLink(payload: FeedbackPayload, site = PUBLIC_SITE): string | null {
  const url = payload.state?.shareUrl;
  if (!url) return null;
  const hash = url.indexOf('#');
  return hash < 0 ? null : `${site}${url.slice(hash)}`;
}

/** `20261016-143005` in UTC: the folder a report is written to. */
export function stampOf(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export interface Names {
  gift: (id: number) => string | undefined;
  pack: (id: number) => string | undefined;
}

const NO_NAMES: Names = { gift: () => undefined, pack: () => undefined };

function giftLabel(id: number, names: Names): string {
  const name = names.gift(id);
  return name ? `${id} ${name}` : String(id);
}

function packLabel(id: number | null, names: Names): string {
  if (id === null) return '-';
  const name = names.pack(id);
  return name ? `${id} ${name}` : String(id);
}

function time(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** The report: what the visitor wrote, the environment, the plan, the logs and the diagnostics. */
export function feedbackReport(payload: FeedbackPayload, names: Names = NO_NAMES): string {
  const out: string[] = [];
  out.push(`# 피드백 ${stampOf(payload.t)} — ${payload.kind}`, '');
  if (payload.title) out.push(`**${payload.title}**`, '');
  out.push(payload.message || '(내용 없음)', '');
  const env = payload.env;
  out.push(
    '## 환경',
    '',
    `- 데이터 ${env.dataVersion} · MD${env.season} ${env.seasonName}`,
    `- ${env.browser} · ${env.viewport} · ${env.touch ? '터치' : '마우스'} · ${env.lang} · ${env.theme}`,
    `- 페이지 ${env.page}`,
    `- 앱 화면 캡처: ${payload.screenshot ? '복사함(이슈에 붙여 넣었을 수 있음)' : '없음'}`,
    '',
  );
  out.push('## 상태', '');
  if (!payload.state) out.push('첨부하지 않음', '');
  else {
    const { run, route, shared } = payload.state;
    const link = publicShareLink(payload);
    if (link) out.push(`- 공유 링크: ${link}`);
    out.push(
      `- 덱 ${shared.deck.length}명 (출격 ${shared.deployed.length}) · 목표 ${shared.wanted.length}개: ${shared.wanted.map((id) => giftLabel(id, names)).join(', ') || '없음'}`,
      `- 런: 진행 ${run.currentFloor}층 · 보는 층 ${run.stageFloor}층`,
    );
    for (const floor of Object.keys(run.visits)
      .map(Number)
      .sort((a, b) => a - b))
      out.push(`  - ${floor}층 입장 ${packLabel(run.visits[floor]!, names)}`);
    const statuses = Object.entries(run.giftStatus);
    if (statuses.length)
      out.push(
        `  - 기프트: ${statuses.map(([id, status]) => `${giftLabel(Number(id), names)}=${status}`).join(', ')}`,
      );
    if (route) {
      out.push(`- 루트: 획득 ${route.covered}/${route.total}${route.capped ? ' (근사 결과)' : ''}`);
      for (const u of route.unresolved) out.push(`  - 미해결 ${giftLabel(u.giftId, names)}: ${u.reason}`);
      if (route.warnings.length) out.push(`  - 참고: ${route.warnings.join(', ')}`);
    }
    out.push('');
  }
  out.push('## 오류·조작 기록', '');
  if (!payload.log) out.push('첨부하지 않음', '');
  else {
    if (payload.log.omitted) out.push(`(오래된 ${payload.log.omitted}건 생략)`, '');
    if (!payload.log.entries.length) out.push('없음');
    for (const entry of payload.log.entries) {
      if (entry.kind === 'error') {
        out.push(`- ${time(entry.t)} **오류** [${entry.source}] ${entry.message}`);
        if (entry.stack) out.push('  ```', ...entry.stack.split('\n').map((line) => `  ${line}`), '  ```');
      } else out.push(`- ${time(entry.t)} ${entry.text}`);
    }
    out.push('');
  }
  out.push('## 피드백용 진단 기록', '');
  const diag = payload.diagnostics;
  if (!diag) out.push('첨부하지 않음', '');
  else {
    out.push(
      `- ${diag.total}건 (${Object.entries(diag.counts)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(' · ')})${diag.omitted ? ` · 오래된 ${diag.omitted}건은 주소 길이 때문에 빠짐` : ''}`,
      '',
    );
    for (const r of diag.records) {
      const at = time(r.t);
      switch (r.kind) {
        case 'floor':
          out.push(
            `- ${at} **${r.floor}층을 떠남** 추천 ${packLabel(r.recommended, names)} · 입장 ${packLabel(r.entered, names)}${
              r.alternatives.length ? ` · 대안 ${r.alternatives.join(',')}` : ''
            }${r.expected.length ? ` · 기대 ${r.expected.map(([id, s]) => `${giftLabel(id, names)}=${s ?? '표시 없음'}`).join(', ')}` : ''}`,
          );
          break;
        case 'read':
          out.push(
            `- ${at} 판독 ${r.screen ?? '?'}${r.floor !== null ? ` ${r.floor}층` : ''}${r.pack !== null ? ` 팩 ${packLabel(r.pack, names)}` : ''}${
              r.gift !== null ? ` 기프트 ${giftLabel(r.gift, names)}` : ''
            }${r.events.length ? ` → ${r.events.join(' / ')}` : ''}`,
          );
          break;
        case 'applied':
          out.push(`- ${at} 적용 ${r.event} (행동 ${r.actions}${r.fromRead ? '' : ', 질문 답'})`);
          break;
        case 'undo':
          out.push(`- ${at} 되돌리기 #${r.logId}`);
          break;
        case 'answer':
          out.push(`- ${at} 질문 답 ${r.ask}: ${r.picked.join(',') || '없음'}`);
          break;
        case 'session':
          out.push(`- ${at} 화면 인식 ${r.status}${r.error ? ` (${r.error})` : ''}`);
          break;
        case 'error':
          out.push(`- ${at} **오류** [${r.source}] ${r.message}`);
          break;
        case 'action':
          out.push(`- ${at} ${r.text}`);
          break;
      }
    }
    out.push('');
  }
  return out.join('\n');
}
