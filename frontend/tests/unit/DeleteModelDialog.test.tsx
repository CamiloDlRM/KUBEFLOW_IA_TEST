import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DeleteModelDialog from '../../src/components/models/DeleteModelDialog';

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<DeleteModelDialog modelName="iris-classifier" onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

describe('DeleteModelDialog', () => {
  it('names the model and asks before deleting it', () => {
    renderDialog();

    expect(screen.getByRole('alertdialog')).toHaveTextContent("Hey, you're about to delete iris-classifier");
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Are you sure?');
  });

  it('deletes on yes', async () => {
    const { onConfirm, onCancel } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the model on no, on Escape and on a click outside', async () => {
    const { onConfirm, onCancel } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'No, keep it' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('alertdialog').parentElement!);

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
