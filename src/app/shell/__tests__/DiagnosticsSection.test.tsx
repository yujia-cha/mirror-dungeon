import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.ts';
import { useApp } from '../../store.ts';

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
  },
  hooks: {},
  exportZip: vi.fn<() => Promise<string>>(),
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
    let finish!: (name: string) => void;
    diagnostics.exportZip.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(<DiagnosticsSection />);
    // Act
    await userEvent.click(screen.getByTestId('diag-export'));
    // Assert
    expect(screen.getByTestId('diag-export')).toBeDisabled();
    expect(screen.getByTestId('diag-clear-all')).toBeDisabled();
    await act(async () => finish('md-diagnostics.zip'));
    expect(screen.getByTestId('diag-clear-all')).toBeEnabled();
    expect(screen.getByTestId('diag-cleanup')).toBeInTheDocument();
  });
});
