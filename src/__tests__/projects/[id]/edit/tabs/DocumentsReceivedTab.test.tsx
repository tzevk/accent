import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DocumentsReceivedTab from '@/app/projects/[id]/edit/tabs/DocumentsReceivedTab';

describe('DocumentsReceivedTab', () => {
	const mockNewDoc = {
		date_received: '',
		description: '',
		drawing_number: '',
		revision_number: '',
		unit_qty: '',
		document_sent_by: '',
		remarks: '',
	};

	const mockDocsReceived = [
		{
			id: 1,
			date_received: '2026-05-25',
			description: 'Received Doc A',
			drawing_number: 'DRW-REC-001',
			revision_number: '0',
			unit_qty: '5',
			document_sent_by: 'Client',
			remarks: 'Ok',
		},
	];

	it('renders received documents list and inputs correctly', () => {
		render(
			<DocumentsReceivedTab
				newReceivedDoc={mockNewDoc}
				setNewReceivedDoc={vi.fn()}
				addReceivedDocument={vi.fn()}
				documentsReceived={mockDocsReceived}
				updateReceivedDocument={vi.fn()}
				removeReceivedDocument={vi.fn()}
			/>
		);

		expect(screen.getByDisplayValue('Received Doc A')).toBeInTheDocument();
		expect(screen.getByDisplayValue('DRW-REC-001')).toBeInTheDocument();
	});

	it('calls removeReceivedDocument when delete button is clicked', async () => {
		const user = userEvent.setup();
		const removeReceivedDocument = vi.fn();
		render(
			<DocumentsReceivedTab
				newReceivedDoc={mockNewDoc}
				setNewReceivedDoc={vi.fn()}
				addReceivedDocument={vi.fn()}
				documentsReceived={mockDocsReceived}
				updateReceivedDocument={vi.fn()}
				removeReceivedDocument={removeReceivedDocument}
			/>
		);

		const deleteBtn = screen.getByTitle('Remove document');
		await user.click(deleteBtn);

		expect(removeReceivedDocument).toHaveBeenCalledWith(1);
	});
});
