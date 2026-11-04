import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProjectTeamTab from '@/app/projects/[id]/edit/tabs/ProjectTeamTab';

const TEAM = [
	{
		id: 42,
		employee_id: 'E42',
		name: 'Member Person',
		email: 'member@example.com',
		department: 'Engineering',
		position: 'Engineer',
		role: 'Team Member',
	},
	{
		id: 43,
		employee_id: 'E43',
		name: 'Lead Person',
		email: 'lead@example.com',
		department: 'Engineering',
		position: 'Project Manager',
		role: 'Project Lead',
	},
];

function baseProps(overrides = {}) {
	return {
		toggleSection: vi.fn(),
		openSections: { teamMemberAdd: true, currentTeam: true },
		usersLoading: false,
		availableUsers: [
			{ id: 44, employee_name: 'Newcomer', email: 'new@example.com' },
		],
		allUsers: [{ id: 44, full_name: 'Newcomer', email: 'new@example.com' }],
		addTeamMember: vi.fn(),
		projectTeamMembers: TEAM,
		updateTeamMemberRole: vi.fn(),
		removeTeamMember: vi.fn(),
		teamError: '',
		teamSaving: false,
		canManageTeam: true,
		leadReplacement: null,
		onCancelLeadReplacement: vi.fn(),
		onConfirmLeadReplacement: vi.fn(),
		...overrides,
	};
}

describe('ProjectTeamTab', () => {
	it('hides every team mutation control from a reader', () => {
		render(<ProjectTeamTab {...baseProps({ canManageTeam: false })} />);

		expect(
			screen.queryByRole('button', { name: /Add Team Member/i })
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText('Project role for Member Person')
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /Remove Member Person from team/i,
			})
		).not.toBeInTheDocument();
		// The stored role is still visible as text.
		expect(screen.getByText('Project Lead')).toBeInTheDocument();
		expect(
			screen.getByText(/Only a project lead or team manager can change it/i)
		).toBeInTheDocument();
	});

	it('offers add, role, and remove controls to a team manager', () => {
		render(<ProjectTeamTab {...baseProps()} />);

		expect(
			screen.getByRole('button', { name: /Add Team Member/i })
		).toBeInTheDocument();
		expect(
			screen.getByLabelText('Project role for Member Person')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {
				name: /Remove Member Person from team/i,
			})
		).toBeInTheDocument();
	});

	it('asks for a replacement lead before removing the final lead', async () => {
		const user = userEvent.setup();
		const onConfirmLeadReplacement = vi.fn();
		const onCancelLeadReplacement = vi.fn();

		render(
			<ProjectTeamTab
				{...baseProps({
					leadReplacement: {
						operation: 'remove_member',
						memberId: 43,
						role: null,
						error: '',
					},
					onConfirmLeadReplacement,
					onCancelLeadReplacement,
				})}
			/>
		);

		expect(
			screen.getByText(/A project must keep at least one Project Lead/i)
		).toBeInTheDocument();
		const confirm = screen.getByRole('button', {
			name: /Save replacement/i,
		});
		expect(confirm).toBeDisabled();

		await user.selectOptions(
			screen.getByLabelText(/Replacement lead/i),
			'42'
		);
		await user.click(confirm);

		expect(onConfirmLeadReplacement).toHaveBeenCalledWith('42');
		expect(onCancelLeadReplacement).not.toHaveBeenCalled();
	});

	it('does not offer the removed lead as its own replacement', () => {
		render(
			<ProjectTeamTab
				{...baseProps({
					leadReplacement: {
						operation: 'remove_member',
						memberId: 43,
						role: null,
						error: '',
					},
				})}
			/>
		);

		const options = within(screen.getByLabelText(/Replacement lead/i))
			.getAllByRole('option')
			.map((option) => option.textContent);
		expect(options).toContain('Select a team member');
		expect(options.some((text) => text?.includes('Member Person'))).toBe(true);
		expect(options.some((text) => text?.includes('Lead Person'))).toBe(false);
	});

	it('shows the server refusal inside the prompt', () => {
		render(
			<ProjectTeamTab
				{...baseProps({
					leadReplacement: {
						operation: 'update_role',
						memberId: 43,
						role: 'Engineer',
						error:
							'A project must keep at least one Project Lead. Name a replacement lead from the current team.',
					},
				})}
			/>
		);

		expect(screen.getByRole('alert')).toHaveTextContent(
			'Name a replacement lead'
		);
	});
});
