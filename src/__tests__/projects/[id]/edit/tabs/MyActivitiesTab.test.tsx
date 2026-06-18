import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MyActivitiesTab from '@/app/projects/[id]/edit/tabs/MyActivitiesTab';

describe('MyActivitiesTab', () => {
	const mockSessionUser = { id: 10, full_name: 'Test Dev' };
	const mockProjectActivities = [
		{
			id: 101,
			activity_name: 'Drawing Work',
			discipline: 'Piping',
			assigned_users: [
				{
					user_id: 10,
					planned_hours: '40',
					qty_assigned: '5',
					daily_entries: [
						{
							date: '2026-05-25',
							hours: '8',
							qty_done: '1',
							remarks: 'Completed ISO 1',
						},
					],
				},
			],
		},
	];

	it('renders user activities and manhours correctly', () => {
		render(
			<MyActivitiesTab
				sessionUser={mockSessionUser}
				projectActivities={mockProjectActivities}
				addDailyEntry={vi.fn()}
				updateDailyEntry={vi.fn()}
				updateUserManhours={vi.fn()}
				removeDailyEntry={vi.fn()}
			/>
		);

		expect(screen.getByText('Drawing Work')).toBeInTheDocument();
		expect(screen.getByText('40.0h')).toBeInTheDocument(); // Totals planned hours block
		expect(screen.getByText('8.0h')).toBeInTheDocument(); // Totals actual hours block
	});

	it('calls addDailyEntry when "+ Add Day" button is clicked', async () => {
		const user = userEvent.setup();
		const addDailyEntry = vi.fn();
		render(
			<MyActivitiesTab
				sessionUser={mockSessionUser}
				projectActivities={mockProjectActivities}
				addDailyEntry={addDailyEntry}
				updateDailyEntry={vi.fn()}
				updateUserManhours={vi.fn()}
				removeDailyEntry={vi.fn()}
			/>
		);

		const addDayBtn = screen.getByRole('button', { name: /Add Day/ });
		await user.click(addDayBtn);

		expect(addDailyEntry).toHaveBeenCalledWith(101, 10);
	});
});
