import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MeetingsTab from '@/app/projects/[id]/edit/tabs/MeetingsTab';

const baseForm = {
  kickoff_meeting: '',
  in_house_meeting: '',
  kickoff_meeting_date: '',
  followup_meeting_date: '',
};

describe('MeetingsTab', () => {
  it('renders meetings fields correctly', () => {
    const form = {
      kickoff_meeting: 'Kickoff notes',
      in_house_meeting: 'In-house notes',
      kickoff_meeting_date: '2026-05-25',
      followup_meeting_date: '2026-06-01',
    };
    const { container } = render(
      <MeetingsTab form={form} handleChange={vi.fn()} />
    );

    expect(
      container.querySelector('textarea[name="kickoff_meeting"]')
    ).toHaveValue('Kickoff notes');
    expect(
      container.querySelector('textarea[name="in_house_meeting"]')
    ).toHaveValue('In-house notes');
    expect(
      container.querySelector('input[name="kickoff_meeting_date"]')
    ).toHaveValue('2026-05-25');
    expect(
      container.querySelector('input[name="followup_meeting_date"]')
    ).toHaveValue('2026-06-01');
  });

  it('triggers handleChange when inputs change', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    const { container } = render(
      <MeetingsTab form={baseForm} handleChange={handleChange} />
    );

    const textarea = container.querySelector(
      'textarea[name="kickoff_meeting"]'
    )!;
    await user.type(textarea, 'abc');

    expect(handleChange).toHaveBeenCalled();
  });
});
