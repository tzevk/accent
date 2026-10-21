import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import LeadActivityForm from '@/components/leads/LeadActivityForm';

/**
 * The Lead activity form: what a person may record, what the form refuses
 * before it sends anything, and who may use it at all. The recorded write
 * itself is proven over real HTTP by the integration harness; this suite
 * covers the labelled controls and the messages the person sees.
 */

function renderForm(canRecord = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<LeadActivityForm leadId="7" canRecord={canRecord} />
		</QueryClientProvider>
	);
}

describe('LeadActivityForm', () => {
	it('labels every control of the activity', () => {
		renderForm();

		expect(screen.getByLabelText('Activity type')).toBeInTheDocument();
		expect(screen.getByLabelText('Call outcome')).toBeInTheDocument();
		expect(screen.getByLabelText('Occurred at')).toBeInTheDocument();
		expect(screen.getByLabelText('Notes')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Record activity' })
		).toBeInTheDocument();
	});

	it('offers the canonical activity kinds and call outcomes', () => {
		renderForm();

		const kinds = screen.getByLabelText('Activity type');
		expect(
			Array.from((kinds as HTMLSelectElement).options).map(
				(option) => option.value
			)
		).toEqual(['Call', 'Email', 'Meeting', 'Note']);
		const outcomes = screen.getByLabelText('Call outcome');
		expect(
			Array.from((outcomes as HTMLSelectElement).options)
				.map((option) => option.value)
				.filter((value) => value !== '')
		).toEqual(['Connected', 'No Answer', 'Busy', 'Voicemail', 'Wrong Number']);
	});

	it('refuses a call without an outcome', () => {
		renderForm();

		fireEvent.click(screen.getByRole('button', { name: 'Record activity' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			'A call needs its outcome.'
		);
	});

	it('refuses a next action without a date', () => {
		renderForm();

		fireEvent.change(screen.getByLabelText('Call outcome'), {
			target: { value: 'No Answer' },
		});
		fireEvent.click(screen.getByLabelText('Schedule the next action now'));
		fireEvent.click(screen.getByRole('button', { name: 'Record activity' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			'The next action needs its date.'
		);
	});

	it('asks for the email reply instead of a call outcome for an email', () => {
		renderForm();

		fireEvent.change(screen.getByLabelText('Activity type'), {
			target: { value: 'Email' },
		});

		expect(screen.queryByLabelText('Call outcome')).not.toBeInTheDocument();
		expect(
			screen.getByLabelText('The client replied to this email')
		).toBeInTheDocument();
	});

	it('hides the form from a user without the lead update right', () => {
		renderForm(false);

		expect(
			screen.queryByRole('button', { name: 'Record activity' })
		).not.toBeInTheDocument();
		expect(
			screen.getByText('You do not have permission to record lead activity.')
		).toBeInTheDocument();
	});
});
