import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.ts';
import { useApp } from '../../store.ts';
import type { ExportResult } from '../../capture/diagnostics/useDiagnostics.ts';

const diagnostics = {
  enabled: true,
  ready: true,
  stats: {
    records: 3,
    frames: 0,
    bytes: 0,
    exportedRecords: 0,
    lastExportAt: null,
    trimmedFrames: 0,
    full: false,
    parts: 1,
  },
  hooks: {},
  exportZip: vi.fn<() => Promise<ExportResult>>(),
  clearExported: vi.fn(async () => ({ records: 0, frames: 0 })),
  clearAll: vi.fn(async () => undefined),
};
vi.mock('../../capture/capture-context.ts', () => ({ useCaptureSession: () => ({ diagnostics }) }));
vi.mock('../plan-context.ts', () => ({ usePlan: () => ({ lang: 'ko' }) }));

const { DiagnosticsSection } = await import('../DiagnosticsSection.tsx');

describe('DiagnosticsSection', () => {
  beforeEach(() => {
    useApp.setState((s) => ({ ui: { ...s.ui, diagEnabled: true, diagRecord: true } }));
  });

  it('says an export failed and offers no clean-up for it', async () => {
    // Arrange: zipping fails.
    diagnostics.exportZip.mockRejectedValueOnce(new Error('quota'));
    render(<DiagnosticsSection />);
    // Act
    await userEvent.click(screen.getByTestId('diag-export'));
    // Assert
    expect(await screen.findByTestId('diag-export-failed')).toHaveTextContent(t('diagExportFailed', 'ko'));
    expect(screen.queryByTestId('diag-cleanup')).toBeNull();
  });

  it('holds the export and the clearing while one of them is running', async () => {
    // Arrange: an export that has not finished.
    let finish!: (result: ExportResult) => void;
    diagnostics.exportZip.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(<DiagnosticsSection />);
    // Act
    await userEvent.click(screen.getByTestId('diag-export'));
    // Assert
    expect(screen.getByTestId('diag-export')).toBeDisabled();
    expect(screen.getByTestId('diag-clear-all')).toBeDisabled();
    await act(async () => finish({ names: ['md-diagnostics.zip'], sessionOver: false }));
    expect(screen.getByTestId('diag-clear-all')).toBeEnabled();
    expect(screen.getByTestId('diag-cleanup')).toBeInTheDocument();
  });

  it('says before an export over the limit that it comes in parts, and after it names them (M146)', async () => {
    // Arrange: frames enough for three parts.
    diagnostics.stats = { ...diagnostics.stats, parts: 3 };
    const names = ['a-part1of3.zip', 'a-part2of3.zip', 'a-part3of3.zip'];
    diagnostics.exportZip.mockResolvedValueOnce({ names, sessionOver: false });
    render(<DiagnosticsSection />);
    expect(screen.getByTestId('diag-split')).toHaveTextContent(t('diagSplitHint', 'ko', { n: 3, mb: '25' }));
    // Act
    await userEvent.click(screen.getByTestId('diag-export'));
    // Assert
    const saved = await screen.findByTestId('diag-saved');
    expect(saved).toHaveAttribute('data-parts', '3');
    expect(saved).toHaveTextContent(
      t('diagSavedPromptParts', 'ko', { n: 3, mb: '25', names: names.join(', ') }),
    );
    diagnostics.stats = { ...diagnostics.stats, parts: 1 };
  });

  it('keeps the one-file prompt and no split line for a small export', async () => {
    // Arrange
    diagnostics.exportZip.mockResolvedValueOnce({ names: ['md-diagnostics-1.zip'], sessionOver: false });
    render(<DiagnosticsSection />);
    expect(screen.queryByTestId('diag-split')).toBeNull();
    // Act
    await userEvent.click(screen.getByTestId('diag-export'));
    // Assert
    expect(await screen.findByTestId('diag-saved')).toHaveTextContent(
      t('diagSavedPrompt', 'ko', { name: 'md-diagnostics-1.zip' }),
    );
  });
});
