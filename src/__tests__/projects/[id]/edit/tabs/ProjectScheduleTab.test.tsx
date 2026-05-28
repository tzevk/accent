import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ProjectScheduleTab from '@/app/projects/[id]/edit/tabs/ProjectScheduleTab';

describe('ProjectScheduleTab', () => {
  const mockWeeks = [
    {
      index: 1,
      label: 'W1',
      start: '2026-05-25',
      rangeLabel: 'May 25 - May 31',
    },
  ];

  const mockForm = {
    start_date: '2026-05-25',
    end_date: '2026-06-25',
  };

  const mockLegends = [
    { key: 'act', label: 'Active', cellClass: 'bg-blue-500' },
  ];

  const mockSchedule = [
    {
      id: 1,
      sr_no: '1',
      activity_description: 'Draft Design',
      discipline: 'Engineering',
      weeks: [1],
      legend: 'act',
      start_date: '2026-05-25',
      end_date: '2026-06-01',
      unit_qty: '1',
      time_required: '10',
      status_completed: 'Ongoing',
      remarks: 'Good',
    },
  ];

  const mockGroups = [
    { discipline: 'Engineering', options: ['Draft Design', 'Final Review'] },
  ];

  it('renders project schedule correctly when weeks exist', () => {
    render(
      <ProjectScheduleTab
        scheduleWeeks={mockWeeks}
        form={mockForm}
        SCHEDULE_LEGENDS={mockLegends}
        selectedScheduleLegend="act"
        setSelectedScheduleLegend={vi.fn()}
        canEditSchedule={true}
        canEditProjectContent={true}
        scheduleLocked={false}
        setScheduleLocked={vi.fn()}
        scheduleEffectivelyLocked={false}
        addSchedule={vi.fn()}
        projectSchedule={mockSchedule}
        computeScheduleWeeksFromDates={vi.fn().mockReturnValue([1])}
        updateSchedule={vi.fn()}
        removeSchedule={vi.fn()}
        toggleScheduleWeek={vi.fn()}
        getScheduleLegend={vi.fn().mockReturnValue(mockLegends[0])}
        projectActivityScheduleGroups={mockGroups}
      />
    );

    expect(screen.getByText('W1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft Design')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Engineering')).toBeInTheDocument();
  });

  it('renders text table when scheduleWeeks is empty', () => {
    render(
      <ProjectScheduleTab
        scheduleWeeks={[]}
        form={mockForm}
        SCHEDULE_LEGENDS={mockLegends}
        selectedScheduleLegend="act"
        setSelectedScheduleLegend={vi.fn()}
        canEditSchedule={true}
        canEditProjectContent={true}
        scheduleLocked={false}
        setScheduleLocked={vi.fn()}
        scheduleEffectivelyLocked={false}
        addSchedule={vi.fn()}
        projectSchedule={mockSchedule}
        computeScheduleWeeksFromDates={vi.fn().mockReturnValue([])}
        updateSchedule={vi.fn()}
        removeSchedule={vi.fn()}
        toggleScheduleWeek={vi.fn()}
        getScheduleLegend={vi.fn().mockReturnValue(mockLegends[0])}
        projectActivityScheduleGroups={mockGroups}
      />
    );

    expect(screen.getByDisplayValue('Draft Design')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ongoing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Good')).toBeInTheDocument();
  });

  it('calls addSchedule when Add Row is clicked', async () => {
    const user = userEvent.setup();
    const addSchedule = vi.fn();

    render(
      <ProjectScheduleTab
        scheduleWeeks={mockWeeks}
        form={mockForm}
        SCHEDULE_LEGENDS={mockLegends}
        selectedScheduleLegend="act"
        setSelectedScheduleLegend={vi.fn()}
        canEditSchedule={true}
        canEditProjectContent={true}
        scheduleLocked={false}
        setScheduleLocked={vi.fn()}
        scheduleEffectivelyLocked={false}
        addSchedule={addSchedule}
        projectSchedule={[]}
        computeScheduleWeeksFromDates={vi.fn()}
        updateSchedule={vi.fn()}
        removeSchedule={vi.fn()}
        toggleScheduleWeek={vi.fn()}
        getScheduleLegend={vi.fn()}
        projectActivityScheduleGroups={mockGroups}
      />
    );

    const addButton = screen.getByRole('button', { name: /Add Row/i });
    await user.click(addButton);

    expect(addSchedule).toHaveBeenCalled();
  });

  it('calls removeSchedule when Remove row is clicked in grid mode', async () => {
    const user = userEvent.setup();
    const removeSchedule = vi.fn();

    render(
      <ProjectScheduleTab
        scheduleWeeks={mockWeeks}
        form={mockForm}
        SCHEDULE_LEGENDS={mockLegends}
        selectedScheduleLegend="act"
        setSelectedScheduleLegend={vi.fn()}
        canEditSchedule={true}
        canEditProjectContent={true}
        scheduleLocked={false}
        setScheduleLocked={vi.fn()}
        scheduleEffectivelyLocked={false}
        addSchedule={vi.fn()}
        projectSchedule={mockSchedule}
        computeScheduleWeeksFromDates={vi.fn().mockReturnValue([1])}
        updateSchedule={vi.fn()}
        removeSchedule={removeSchedule}
        toggleScheduleWeek={vi.fn()}
        getScheduleLegend={vi.fn().mockReturnValue(mockLegends[0])}
        projectActivityScheduleGroups={mockGroups}
      />
    );

    const removeButton = screen.getByTitle('Remove row');
    await user.click(removeButton);

    expect(removeSchedule).toHaveBeenCalledWith(1);
  });
});
