import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentsIssuedTab from '@/app/projects/[id]/edit/tabs/DocumentsIssuedTab';

vi.mock('@/lib/api-client', () => ({
	apiGet: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});
	function QueryWrapper({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
	}
	return QueryWrapper;
}

describe('DocumentsIssuedTab', () => {
	const mockNewDoc = {
		document_name: '',
		document_number: '',
		discipline: '',
		category: '',
		description: '',
		revision_number: '',
		status: '',
		planned_date: '',
		actual_date: '',
		prepared_by: '',
		checked_by: '',
		approved_by: '',
		client_approval: '',
		remarks: '',
	};

	const mockDocsIssued = [
		{
			id: 1,
			document_name: 'Drawing Issued A',
			document_number: 'DRW-ISS-001',
			discipline: 'Process',
			category: '',
			description: '',
			revision_number: '1',
			status: 'IFC',
			planned_date: '',
			actual_date: '2026-05-25',
			prepared_by: '',
			checked_by: '',
			approved_by: '',
			client_approval: '',
			remarks: 'Issued',
		},
	];

	const baseProps = {
		newIssuedDescRef: { current: null },
		newIssuedDoc: mockNewDoc,
		setNewIssuedDoc: vi.fn(),
		canEditProjectContent: true,
		addIssuedDocument: vi.fn(),
		documentsIssued: mockDocsIssued,
		updateIssuedDocument: vi.fn(),
		removeIssuedDocument: vi.fn(),
		sessionUserName: 'Current User',
		signaturePermissions: {
			prepared_by: 'edit' as const,
			checked_by: 'edit' as const,
			approved_by: 'edit' as const,
			client_approval: 'edit' as const,
		},
	};

	it('renders rows in display mode with values as text', () => {
		render(<DocumentsIssuedTab {...baseProps} />, {
			wrapper: createWrapper(),
		});
		const row = screen.getByText('Drawing Issued A').closest('tr');
		expect(row).not.toBeNull();
		expect(
			within(row as HTMLTableRowElement).getByText('IFC')
		).toBeInTheDocument();
		expect(
			within(row as HTMLTableRowElement).getByText('DRW-ISS-001')
		).toBeInTheDocument();
		expect(
			within(row as HTMLTableRowElement).getByText('Process')
		).toBeInTheDocument();
		// Display mode renders plain text, not inputs
		expect(screen.queryByDisplayValue('DRW-ISS-001')).not.toBeInTheDocument();
	});

	it('switches a row to edit mode when Edit document is clicked', async () => {
		const user = userEvent.setup();
		render(<DocumentsIssuedTab {...baseProps} />, {
			wrapper: createWrapper(),
		});
		await user.click(screen.getByTitle('Edit document'));
		expect(screen.getByDisplayValue('DRW-ISS-001')).toBeInTheDocument();
		expect(screen.getByDisplayValue('IFC')).toBeInTheDocument();
		expect(screen.getByTitle('Done editing')).toBeInTheDocument();
	});

	it('calls removeIssuedDocument when delete button is clicked', async () => {
		const user = userEvent.setup();
		const removeIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				removeIssuedDocument={removeIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByTitle('Remove document'));
		expect(removeIssuedDocument).toHaveBeenCalledWith(1);
	});

	it('autofills Checked By when status changes to IFI', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByTitle('Edit document'));
		await user.selectOptions(screen.getByDisplayValue('IFC'), 'IFI');
		expect(updateIssuedDocument).toHaveBeenCalledWith(1, 'status', 'IFI');
		expect(updateIssuedDocument).toHaveBeenCalledWith(
			1,
			'checked_by',
			'Current User'
		);
	});

	it('autofills Approved By when status changes to IFD with approval rights', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByTitle('Edit document'));
		await user.selectOptions(screen.getByDisplayValue('IFC'), 'IFD');
		expect(updateIssuedDocument).toHaveBeenCalledWith(1, 'status', 'IFD');
		expect(updateIssuedDocument).toHaveBeenCalledWith(
			1,
			'approved_by',
			'Current User'
		);
	});

	it('does not autofill Approved By without approved_by edit permission', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				signaturePermissions={{
					...baseProps.signaturePermissions,
					approved_by: 'view',
				}}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByTitle('Edit document'));
		await user.selectOptions(screen.getByDisplayValue('IFC'), 'IFD');
		expect(updateIssuedDocument).toHaveBeenCalledWith(1, 'status', 'IFD');
		expect(updateIssuedDocument).not.toHaveBeenCalledWith(
			1,
			'approved_by',
			'Current User'
		);
	});

	it('does not autofill Checked By without checked_by edit permission', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				signaturePermissions={{
					...baseProps.signaturePermissions,
					checked_by: 'hidden',
				}}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByTitle('Edit document'));
		await user.selectOptions(screen.getByDisplayValue('IFC'), 'IFI');
		expect(updateIssuedDocument).toHaveBeenCalledWith(1, 'status', 'IFI');
		expect(updateIssuedDocument).not.toHaveBeenCalledWith(
			1,
			'checked_by',
			'Current User'
		);
	});

	it('shows switches only for signature fields the user may sign', async () => {
		render(
			<DocumentsIssuedTab
				{...baseProps}
				signaturePermissions={{
					prepared_by: 'edit',
					checked_by: 'view',
					approved_by: 'edit',
					client_approval: 'hidden',
				}}
			/>,
			{ wrapper: createWrapper() }
		);
		expect(screen.getAllByRole('switch')).toHaveLength(2);
		expect(
			screen.getByRole('switch', { name: 'Prepared By' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('switch', { name: 'Approved By' })
		).toBeInTheDocument();
		expect(screen.queryByRole('switch', { name: 'Checked By' })).toBeNull();
		expect(
			screen.queryByRole('switch', { name: 'Client Approval' })
		).toBeNull();
	});

	it('signs the deliverable when a switch is toggled on', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		render(
			<DocumentsIssuedTab
				{...baseProps}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		await user.click(screen.getByRole('switch', { name: 'Prepared By' }));
		expect(updateIssuedDocument).toHaveBeenCalledWith(
			1,
			'prepared_by',
			'Current User'
		);
	});

	it('clears the signature when an active switch is toggled off', async () => {
		const user = userEvent.setup();
		const updateIssuedDocument = vi.fn();
		const rowWithApproval = [
			{
				...mockDocsIssued[0],
				approved_by: 'Carol Iyer',
			},
		];
		render(
			<DocumentsIssuedTab
				{...baseProps}
				documentsIssued={rowWithApproval}
				updateIssuedDocument={updateIssuedDocument}
			/>,
			{ wrapper: createWrapper() }
		);
		const approvedSwitch = screen.getByRole('switch', {
			name: 'Approved By',
		});
		expect(approvedSwitch).toHaveAttribute('aria-checked', 'true');
		await user.click(approvedSwitch);
		expect(updateIssuedDocument).toHaveBeenCalledWith(1, 'approved_by', '');
	});

	it('still shows signature values for users without switch access', () => {
		const rowWithApproval = [
			{
				...mockDocsIssued[0],
				approved_by: 'Carol Iyer',
			},
		];
		render(
			<DocumentsIssuedTab
				{...baseProps}
				documentsIssued={rowWithApproval}
				signaturePermissions={{
					prepared_by: 'view',
					checked_by: 'view',
					approved_by: 'view',
					client_approval: 'view',
				}}
			/>,
			{ wrapper: createWrapper() }
		);
		expect(screen.queryAllByRole('switch')).toHaveLength(0);
		expect(screen.getByText('Carol Iyer')).toBeInTheDocument();
	});
});
