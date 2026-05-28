import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import TeamTab from '@/app/projects/[id]/edit/tabs/TeamTab';

describe('TeamTab', () => {
  const mockTeamMembers = [
    {
      id: 1,
      employee_id: 'EMP1',
      discipline: '10',
      activity_id: '20',
      sub_activity: '',
      required_hours: 40,
      actual_hours: 10,
      planned_start_date: '2026-05-25',
      planned_end_date: '2026-06-25',
      actual_completion_date: '',
      manhours: 10,
      cost: 5000,
    },
  ];

  const mockDropdownTeam = [
    { id: 'EMP1', name: 'Alice Smith', project_role: 'Engineer' },
  ];

  const mockFunctions = [{ id: '10', function_name: 'Engineering' }];

  const mockActivities = [
    { id: '20', type: 'activity', name: 'Cabling Design', function_id: '10' },
  ];

  it('renders team member rows correctly', () => {
    render(
      <TeamTab
        addActivityTeamMember={vi.fn()}
        totalManhours={10}
        totalCost={5000}
        teamMembers={mockTeamMembers}
        updateActivityTeamMember={vi.fn()}
        getProjectTeamForDropdown={vi.fn().mockReturnValue(mockDropdownTeam)}
        functions={mockFunctions}
        projectActivities={mockActivities}
        removeActivityTeamMember={vi.fn()}
      />
    );

    expect(
      screen.getByDisplayValue('Alice Smith (Engineer)')
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Engineering')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cabling Design')).toBeInTheDocument();
    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
  });

  it('calls addActivityTeamMember when Add Team Member is clicked', async () => {
    const user = userEvent.setup();
    const addActivityTeamMember = vi.fn();

    render(
      <TeamTab
        addActivityTeamMember={addActivityTeamMember}
        totalManhours={0}
        totalCost={0}
        teamMembers={[]}
        updateActivityTeamMember={vi.fn()}
        getProjectTeamForDropdown={vi.fn().mockReturnValue([])}
        functions={[]}
        projectActivities={[]}
        removeActivityTeamMember={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: /Add Team Member/i });
    await user.click(addButton);

    expect(addActivityTeamMember).toHaveBeenCalled();
  });

  it('calls updateActivityTeamMember when a field changes', async () => {
    const user = userEvent.setup();
    const updateActivityTeamMember = vi.fn();

    render(
      <TeamTab
        addActivityTeamMember={vi.fn()}
        totalManhours={10}
        totalCost={5000}
        teamMembers={mockTeamMembers}
        updateActivityTeamMember={updateActivityTeamMember}
        getProjectTeamForDropdown={vi.fn().mockReturnValue(mockDropdownTeam)}
        functions={mockFunctions}
        projectActivities={mockActivities}
        removeActivityTeamMember={vi.fn()}
      />
    );

    const requiredHoursInput = screen.getByDisplayValue('40');
    await user.clear(requiredHoursInput);
    await user.type(requiredHoursInput, '45');

    expect(updateActivityTeamMember).toHaveBeenCalled();
  });

  it('calls removeActivityTeamMember when delete icon is clicked', async () => {
    const user = userEvent.setup();
    const removeActivityTeamMember = vi.fn();

    render(
      <TeamTab
        addActivityTeamMember={vi.fn()}
        totalManhours={10}
        totalCost={5000}
        teamMembers={mockTeamMembers}
        updateActivityTeamMember={vi.fn()}
        getProjectTeamForDropdown={vi.fn().mockReturnValue(mockDropdownTeam)}
        functions={mockFunctions}
        projectActivities={mockActivities}
        removeActivityTeamMember={removeActivityTeamMember}
      />
    );

    const deleteButton = screen.getByRole('button', { name: '' }); // There is no text, just icon. Let's find it.
    await user.click(deleteButton);

    expect(removeActivityTeamMember).toHaveBeenCalledWith(1);
  });
});
