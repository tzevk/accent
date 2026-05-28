import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import PlanningTab from '@/app/projects/[id]/edit/tabs/PlanningTab';

describe('PlanningTab', () => {
  const mockNewActivity = {
    serialNumber: '',
    activity: '',
    quantity: '',
    startDate: '',
    endDate: '',
    actualCompletionDate: '',
    timeRequired: '',
    actualTimeRequired: '',
  };

  const mockPlanningActivities = [
    {
      id: 1,
      serialNumber: 'P1',
      activity: 'Design Phase',
      quantity: '3 drawings',
      startDate: '2026-05-25',
      endDate: '2026-06-01',
      actualCompletionDate: '2026-05-30',
      timeRequired: '7 days',
      actualTimeRequired: '5 days',
    },
  ];

  it('renders planning activities correctly', () => {
    render(
      <PlanningTab
        newPlanningActivity={mockNewActivity}
        updatePlanningActivityField={vi.fn()}
        addPlanningActivity={vi.fn()}
        planningActivities={mockPlanningActivities}
        removePlanningActivity={vi.fn()}
      />
    );

    expect(screen.getByText('Design Phase')).toBeInTheDocument();
    expect(screen.getByText('3 drawings')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
  });

  it('calls removePlanningActivity when delete button is clicked', async () => {
    const user = userEvent.setup();
    const removePlanningActivity = vi.fn();
    render(
      <PlanningTab
        newPlanningActivity={mockNewActivity}
        updatePlanningActivityField={vi.fn()}
        addPlanningActivity={vi.fn()}
        planningActivities={mockPlanningActivities}
        removePlanningActivity={removePlanningActivity}
      />
    );

    const deleteBtn = screen.getByTitle('Remove activity');
    await user.click(deleteBtn);

    expect(removePlanningActivity).toHaveBeenCalledWith(1);
  });
});
