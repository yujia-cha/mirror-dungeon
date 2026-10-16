/** The form select (M107): one frame for every choice the app asks for. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../components/ui.tsx';

const OPTIONS = [
  { value: 'a', label: '가' },
  { value: 'b', label: '나' },
] as const;

describe('Select', () => {
  it('names itself and hands back the picked value', async () => {
    // Arrange
    const onChange = vi.fn();
    render(<Select label="간격" value="a" options={OPTIONS} onChange={onChange} />);
    // Act
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '간격' }), 'b');
    // Assert
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('shows the current value', () => {
    // Arrange / Act
    render(<Select label="간격" value="b" options={OPTIONS} onChange={() => {}} />);
    // Assert
    expect(screen.getByRole('combobox', { name: '간격' })).toHaveValue('b');
  });

  it('takes no input while disabled, and looks it', async () => {
    // Arrange
    const onChange = vi.fn();
    render(<Select label="언어" value="a" options={OPTIONS} onChange={onChange} disabled />);
    const select = screen.getByRole('combobox', { name: '언어' });
    // Act
    await userEvent.selectOptions(select, 'b').catch(() => undefined);
    // Assert
    expect(select).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(select.parentElement?.className).toContain('bg-surface-muted');
  });
});
