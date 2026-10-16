/**
 * M127: 「피드백 보내기」 — the header menu's form that opens a prefilled GitHub issue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import { appDefaultOptions, defaultUi, emptyRun, forgetRecipes, useApp } from '../store.ts';
import { AppShell } from '../shell/AppShell.tsx';
import { feedbackLog } from '../lib/feedback-log.ts';
import { visitorDiagnostics } from '../feedback/visitor-diagnostics.ts';
import { decodePayload } from '../feedback/payload.ts';

vi.mock('../feedback/screen-capture.ts', () => ({ copyAppScreen: vi.fn(async () => 'copied') }));

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const DECK = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];

beforeEach(() => {
  useApp.setState({
    deck: DECK,
    deployed: [],
    wanted: [9088],
    fusionGoal: {},
    run: emptyRun(),
    ui: defaultUi(),
    options: appDefaultOptions(),
    lang: 'ko',
    dark: true,
  });
  forgetRecipes();
  feedbackLog.clear();
  visitorDiagnostics.setOn(false);
  visitorDiagnostics.clear();
});

afterEach(() => {
  visitorDiagnostics.setOn(false);
  visitorDiagnostics.clear();
});

const renderShell = () =>
  render(
    <AppShell
      data={data}
      indexes={indexes}
      stats={analyseDeck(DECK, indexes, data.rules.deployment, [])}
      lang="ko"
      dark
      seasons={[{ id: 7, name: data.meta.dungeon.name, dataVersion: '1', lastFloor: 15, provisional: false }]}
      onSeason={() => undefined}
      onShare={() => undefined}
      onToggleLang={() => undefined}
      onToggleDark={() => undefined}
    />,
  );

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '더 보기' }));
  const item = within(screen.getByTestId('header-menu')).getByRole('button', { name: '피드백 보내기' });
  // The same 36px row of label type as the rest of the menu.
  expect(item.className).toMatch(/\bmin-h-9\b/);
  expect(item.className).toMatch(/\btext-label\b/);
  await user.click(item);
  return screen.getByRole('dialog', { name: '피드백 보내기' });
}

describe('feedback form (M127)', () => {
  it('opens from the menu, needs a message, and opens an issue on the public repo with it', async () => {
    // Arrange
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    feedbackLog.error('render', new Error('earlier crash'));
    renderShell();
    // Act
    const sheet = await openForm(user);
    // Assert: the privacy line says the issue is public and no game screen goes.
    expect(within(sheet).getByTestId('feedback-privacy')).toHaveTextContent('이슈는 공개됩니다');
    expect(within(sheet).getByTestId('feedback-privacy')).toHaveTextContent('게임 화면은 보내지 않습니다');
    await user.click(within(sheet).getByRole('button', { name: 'GitHub에서 이슈 열기' }));
    expect(open).not.toHaveBeenCalled();
    expect(within(sheet).getByRole('alert')).toHaveTextContent('내용을 적어 주세요.');
    expect(within(sheet).getByLabelText('내용')).toHaveFocus();

    await user.selectOptions(within(sheet).getByRole('combobox', { name: '종류' }), 'data');
    await user.type(within(sheet).getByLabelText('내용'), '팩 이름이 게임과 다릅니다');
    expect(within(sheet).queryByRole('alert')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'GitHub에서 이슈 열기' }));

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0]!;
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/yujia-cha/mirror-dungeon/issues/new');
    expect(parsed.searchParams.get('labels')).toBe('feedback');
    expect(parsed.searchParams.get('title')).toBe('[데이터 오류] 팩 이름이 게임과 다릅니다');
    const body = parsed.searchParams.get('body')!;
    expect(body).toContain('팩 이름이 게임과 다릅니다');
    expect(body).toContain('#s=');
    expect(body).toContain('earlier crash');
    const decoded = decodePayload(body);
    expect(decoded.ok && decoded.payload.state?.shared.wanted).toEqual([9088]);
    expect(decoded.ok && decoded.payload.kind).toBe('data');
  });

  it('copies the full text for when GitHub will not take the link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderShell();
    const sheet = await openForm(user);
    await user.type(within(sheet).getByLabelText('내용'), '복사 시험');
    await user.click(within(sheet).getByRole('button', { name: '내용 복사' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('복사 시험');
    expect(within(sheet).getByTestId('feedback-status')).toHaveTextContent('내용을 복사했습니다');
  });

  it('records 피드백용 진단 기록 only when turned on, attaches it, and clears it', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderShell();
    const sheet = await openForm(user);
    expect(within(sheet).getByTestId('feedback-diag-count')).toHaveTextContent('아직 기록이 없습니다');
    expect(within(sheet).queryByTestId('feedback-attach-diag')).toBeNull();
    visitorDiagnostics.add({ kind: 'action', text: 'ignored while off' });
    expect(visitorDiagnostics.snapshot().count).toBe(0);

    await user.click(within(sheet).getByTestId('feedback-diag-record'));
    expect(visitorDiagnostics.recording).toBe(true);
    // A floor left on the stage is written by the shell's own listener.
    act(() => {
      useApp.getState().visitPack(data.packs[0]!.id, 1);
      useApp.getState().setStageFloor(2);
    });
    const kinds = visitorDiagnostics.list().map((r) => r.kind);
    expect(kinds).toContain('floor');
    expect(within(sheet).getByTestId('feedback-attach-diag')).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('내용'), '진단 첨부');
    await user.click(within(sheet).getByRole('button', { name: 'GitHub에서 이슈 열기' }));
    const body = new URL(String(open.mock.calls[0]![0])).searchParams.get('body')!;
    const decoded = decodePayload(body);
    expect(decoded.ok && decoded.payload.diagnostics?.counts.floor).toBe(1);

    await user.click(within(sheet).getByTestId('feedback-diag-clear'));
    expect(visitorDiagnostics.snapshot().count).toBe(0);
    expect(within(sheet).queryByTestId('feedback-attach-diag')).toBeNull();
  });

  it('copies the app screen on request and tells the issue where to paste it', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderShell();
    const sheet = await openForm(user);
    await user.click(within(sheet).getByRole('button', { name: '앱 화면을 클립보드에 복사' }));
    expect(await within(sheet).findByText(/앱 화면을 복사했습니다/)).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('내용'), '화면 첨부');
    await user.click(within(sheet).getByRole('button', { name: 'GitHub에서 이슈 열기' }));
    const body = new URL(String(open.mock.calls[0]![0])).searchParams.get('body')!;
    expect(body).toContain('## 화면');
    expect(body).toContain('Ctrl+V');
  });
});
