import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MeetingTab from '@/app/projects/[id]/edit/tabs/MeetingTab';

describe('MeetingTab', () => {
  const mockKickoffMeetings = [
    {
      id: 1,
      meeting_no: 'K-01',
      meeting_date: '2026-05-25',
      meeting_title: 'Kickoff A',
      organizer: 'Alice',
      client_representative: 'Bob',
      meeting_location: 'Zoom',
      points_discussed: 'Point 1',
      persons_involved: 'Person A',
      mom_document: { file_url: 'file.pdf', original_name: 'mom.pdf' },
    },
  ];

  const mockInternalMeetings = [
    {
      id: 2,
      meeting_no: 'I-01',
      meeting_date: '2026-05-26',
      meeting_title: 'Internal A',
      organizer: 'Charlie',
      client_representative: 'Delta',
      meeting_location: 'Office',
      points_discussed: 'Point 2',
      persons_involved: 'Person B',
      mom_document: null,
    },
  ];

  it('renders kickoff and internal meetings correctly', () => {
    render(
      <MeetingTab
        newKickoffMeetingTitle=""
        setNewKickoffMeetingTitle={vi.fn()}
        addKickoffMeeting={vi.fn()}
        kickoffMeetings={mockKickoffMeetings}
        updateKickoffMeeting={vi.fn()}
        handlePointsBlur={vi.fn()}
        removeMomDocument={vi.fn()}
        handleMomUpload={vi.fn()}
        removeKickoffMeeting={vi.fn()}
        newInternalMeetingTitle=""
        setNewInternalMeetingTitle={vi.fn()}
        addInternalMeeting={vi.fn()}
        internalMeetings={mockInternalMeetings}
        updateInternalMeeting={vi.fn()}
        removeInternalMeeting={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Kickoff A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Internal A')).toBeInTheDocument();
    expect(screen.getByText('mom.pdf')).toBeInTheDocument();
  });

  it('calls removeKickoffMeeting when kickoff delete button is clicked', async () => {
    const user = userEvent.setup();
    const removeKickoffMeeting = vi.fn();
    render(
      <MeetingTab
        newKickoffMeetingTitle=""
        setNewKickoffMeetingTitle={vi.fn()}
        addKickoffMeeting={vi.fn()}
        kickoffMeetings={mockKickoffMeetings}
        updateKickoffMeeting={vi.fn()}
        handlePointsBlur={vi.fn()}
        removeMomDocument={vi.fn()}
        handleMomUpload={vi.fn()}
        removeKickoffMeeting={removeKickoffMeeting}
        newInternalMeetingTitle=""
        setNewInternalMeetingTitle={vi.fn()}
        addInternalMeeting={vi.fn()}
        internalMeetings={[]}
        updateInternalMeeting={vi.fn()}
        removeInternalMeeting={vi.fn()}
      />
    );

    const removeBtn = screen.getByTitle('Remove meeting');
    await user.click(removeBtn);

    expect(removeKickoffMeeting).toHaveBeenCalledWith(1);
  });
});
