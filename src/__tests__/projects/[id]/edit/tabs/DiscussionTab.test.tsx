import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DiscussionTab from '@/app/projects/[id]/edit/tabs/DiscussionTab';

describe('DiscussionTab', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              id: 1,
              follow_up_date: '2026-05-25T00:00:00.000Z',
              description: 'Topic discussion',
              responsible_person: 'John Doe',
              logged_by: 'Admin',
            },
          ],
        }),
      })
    );
  });

  it('loads discussions and renders elements correctly', async () => {
    render(
      <DiscussionTab
        id="123"
        projectTeamMembers={[{ id: 1, name: 'John Doe' }]}
        sessionUser={{ full_name: 'Admin' }}
      />
    );

    const topic = await screen.findByText('Topic discussion');
    expect(topic).toBeInTheDocument();
    expect(screen.getAllByText('John Doe')[0]).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Admin')[0]).toBeInTheDocument();
  });
});
