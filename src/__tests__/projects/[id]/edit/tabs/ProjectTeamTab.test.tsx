import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ProjectTeamTab from '@/app/projects/[id]/edit/tabs/ProjectTeamTab';

describe('ProjectTeamTab', () => {
	const mockAvailableUsers = [
		{
			id: 1,
			employee_code: 'EMP001',
			full_name: 'Alice Smith',
			email: 'alice@example.com',
			role_name: 'Designer',
		},
	];

	const mockTeamMembers = [
		{
			id: 10,
			employee_id: 'EMP101',
			name: 'Bob Jones',
			email: 'bob@example.com',
			department: 'Piping',
			position: 'Lead',
			role: 'Engineer',
		},
	];

	it('renders project team lists correctly when sections are open', async () => {
		const user = userEvent.setup();
		render(
			<ProjectTeamTab
				toggleSection={vi.fn()}
				openSections={{ teamMemberAdd: true, currentTeam: true }}
				usersLoading={false}
				availableUsers={mockAvailableUsers}
				allUsers={[]}
				addTeamMember={vi.fn()}
				projectTeamMembers={mockTeamMembers}
				updateTeamMemberRole={vi.fn()}
				removeTeamMember={vi.fn()}
			/>
		);

		expect(screen.getByText('Bob Jones')).toBeInTheDocument();
		expect(screen.getByDisplayValue('Engineer')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: /Search users/ }));
		expect(await screen.findByText(/Alice Smith/)).toBeInTheDocument();
	});

	it('calls addTeamMember when a user is selected', async () => {
		const user = userEvent.setup();
		const addTeamMember = vi.fn();

		render(
			<ProjectTeamTab
				toggleSection={vi.fn()}
				openSections={{ teamMemberAdd: true }}
				usersLoading={false}
				availableUsers={mockAvailableUsers}
				allUsers={[]}
				addTeamMember={addTeamMember}
				projectTeamMembers={[]}
				updateTeamMemberRole={vi.fn()}
				removeTeamMember={vi.fn()}
			/>
		);

		await user.click(screen.getByRole('button', { name: /Search users/ }));
		await user.type(screen.getByPlaceholderText('Search...'), 'Alice');
		await user.click(await screen.findByText(/Alice Smith/));

		expect(addTeamMember).toHaveBeenCalledWith(mockAvailableUsers[0]);
	});

	it('calls updateTeamMemberRole when role select changes', async () => {
		const user = userEvent.setup();
		const updateTeamMemberRole = vi.fn();

		render(
			<ProjectTeamTab
				toggleSection={vi.fn()}
				openSections={{ currentTeam: true }}
				usersLoading={false}
				availableUsers={[]}
				allUsers={[]}
				addTeamMember={vi.fn()}
				projectTeamMembers={mockTeamMembers}
				updateTeamMemberRole={updateTeamMemberRole}
				removeTeamMember={vi.fn()}
			/>
		);

		const roleSelect = screen.getByDisplayValue('Engineer');
		await user.selectOptions(roleSelect, 'Project Lead');

		expect(updateTeamMemberRole).toHaveBeenCalledWith(10, 'Project Lead');
	});

	it('calls removeTeamMember when Remove button is clicked', async () => {
		const user = userEvent.setup();
		const removeTeamMember = vi.fn();

		render(
			<ProjectTeamTab
				toggleSection={vi.fn()}
				openSections={{ currentTeam: true }}
				usersLoading={false}
				availableUsers={[]}
				allUsers={[]}
				addTeamMember={vi.fn()}
				projectTeamMembers={mockTeamMembers}
				updateTeamMemberRole={vi.fn()}
				removeTeamMember={removeTeamMember}
			/>
		);

		const removeButton = screen.getByTitle('Remove from team');
		await user.click(removeButton);

		expect(removeTeamMember).toHaveBeenCalledWith(10);
	});
});
