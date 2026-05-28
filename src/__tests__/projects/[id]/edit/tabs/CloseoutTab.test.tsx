import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CloseoutTab from '@/app/projects/[id]/edit/tabs/CloseoutTab';

const baseForm = {
  final_documentation_status: '',
  actual_profit_loss: '',
  lessons_learned: '',
  client_feedback: '',
  notes: '',
};

describe('CloseoutTab', () => {
  it('renders CloseoutTab form inputs with correct values', () => {
    const form = {
      final_documentation_status: 'Reviewed',
      actual_profit_loss: '1500.50',
      lessons_learned: 'Some lessons learned text',
      client_feedback: 'Positive feedback',
      notes: 'Extra notes',
    };
    const { container } = render(
      <CloseoutTab form={form} handleChange={vi.fn()} />
    );

    const select = container.querySelector(
      'select[name="final_documentation_status"]'
    );
    expect(select).toHaveValue('Reviewed');

    const profitInput = container.querySelector(
      'input[name="actual_profit_loss"]'
    );
    expect(profitInput).toHaveValue(1500.5);

    const lessons = container.querySelector('textarea[name="lessons_learned"]');
    expect(lessons).toHaveValue('Some lessons learned text');

    const feedback = container.querySelector(
      'textarea[name="client_feedback"]'
    );
    expect(feedback).toHaveValue('Positive feedback');

    const notes = container.querySelector('textarea[name="notes"]');
    expect(notes).toHaveValue('Extra notes');
  });

  it('triggers handleChange when inputs change', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    const { container } = render(
      <CloseoutTab form={baseForm} handleChange={handleChange} />
    );

    const profitInput = container.querySelector(
      'input[name="actual_profit_loss"]'
    )!;
    await user.type(profitInput, '100');
    expect(handleChange).toHaveBeenCalled();

    const select = container.querySelector(
      'select[name="final_documentation_status"]'
    )!;
    await user.selectOptions(select, 'Drafted');
    expect(handleChange).toHaveBeenCalled();
  });
});
