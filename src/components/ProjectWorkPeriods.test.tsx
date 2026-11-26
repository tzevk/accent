import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectWorkPeriods from '@/components/ProjectWorkPeriods';

const fetchMock = vi.hoisted(() => vi.fn());

interface JsonResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
}

function jsonResponse(status: number, payload: unknown): JsonResponse {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	};
}

const assignment = {
	id: 'assignment-1',
	employeeName: 'Asha Rao',
	activityName: 'Structural design',
	subActivityName: 'BIM coordination',
};

const period = {
	id: 'period-1',
	assignmentId: 'assignment-1',
	projectId: '17',
	activityId: 'activity-1',
	employeeId: 'employee-1',
	userId: 'user-1',
	projectCode: 'PRJ-017',
	projectName: 'Riverside Works',
	discipline: 'Structures',
	activityName: 'Structural design',
	subActivityName: 'BIM coordination',
	employeeName: 'Asha Rao',
	start: '2026-10-05T09:00',
	end: '2026-10-05T11:30',
	quantity: '2.5',
	dateCompleted: '2026-10-05',
	remarks: 'Original coordination',
	durationSeconds: 9000,
	weekSeconds: 9000,
	weekQuantity: '2.5',
	editable: true,
};

function payload(periods = [period], assignments = [assignment]) {
	return {
		success: true,
		data: {
			canLog: false,
			today: '2026-10-22',
			weekStart: '2026-10-19',
			periods,
			assignments,
		},
	};
}

function mutationPayload(id: string) {
	return { success: true, data: { id }, affected_rows: 1 };
}

function renderWorkspace(projectSubmit = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const view = render(
		<QueryClientProvider client={client}>
			<form onSubmit={projectSubmit}>
				<ProjectWorkPeriods projectId="17" />
			</form>
		</QueryClientProvider>
	);
	return { ...view, projectSubmit };
}

function fillNewPeriod() {
	fireEvent.change(screen.getByLabelText(/employee and activity/i), {
		target: { value: 'assignment-1' },
	});
	fireEvent.change(screen.getByLabelText(/^start/i), {
		target: { value: '2026-10-01T09:00' },
	});
	fireEvent.change(screen.getByLabelText(/^end/i), {
		target: { value: '2026-10-01T11:00' },
	});
	fireEvent.change(screen.getByLabelText(/^quantity/i), {
		target: { value: '2.5' },
	});
	fireEvent.change(screen.getByLabelText(/^date completed/i), {
		target: { value: '2026-10-01' },
	});
	fireEvent.change(screen.getByLabelText(/^remarks/i), {
		target: { value: 'Late correction' },
	});
}

describe('ProjectWorkPeriods', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(jsonResponse(200, payload()));
		vi.stubGlobal('fetch', fetchMock);
	});

	it('loads recorded periods and eligible assignments for the explicit project', async () => {
		const { container, projectSubmit } = renderWorkspace();

		const table = await screen.findByRole('table', {
			name: /recorded work periods/i,
		});
		expect(within(table).getByText('Asha Rao')).toBeInTheDocument();
		expect(
			within(table).getByText('Original coordination')
		).toBeInTheDocument();
		expect(screen.getByLabelText(/employee and activity/i)).toHaveValue(
			'assignment-1'
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/work-periods?projectId=17',
			expect.objectContaining({ credentials: 'include' })
		);
		expect(container.querySelectorAll('form')).toHaveLength(1);
		expect(projectSubmit).not.toHaveBeenCalled();
	});

	it('adds older work against an eligible assignment without submitting the project', async () => {
		let finishAdd: ((response: JsonResponse) => void) | undefined;
		const addResponse = Promise.withResolvers<JsonResponse>();
		const addedPeriod = {
			...period,
			id: 'period-2',
			start: '2026-10-01T09:00',
			end: '2026-10-01T11:00',
			quantity: '2.5',
			dateCompleted: '2026-10-01',
			remarks: 'Late correction',
			durationSeconds: 7200,
			weekSeconds: 0,
			weekQuantity: '0',
		};
		fetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				finishAdd = addResponse.resolve;
				return addResponse.promise;
			}
			const periods = fetchMock.mock.calls.some(
				([, request]) => request?.method === 'POST'
			)
				? [addedPeriod]
				: [period];
			return Promise.resolve(jsonResponse(200, payload(periods)));
		});
		const { projectSubmit } = renderWorkspace();
		await screen.findByRole('table', { name: /recorded work periods/i });
		fillNewPeriod();
		expect(
			fireEvent.keyDown(screen.getByLabelText(/^start/i), { key: 'Enter' })
		).toBe(false);
		expect(projectSubmit).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Add work period' }));

		expect(await screen.findByText('Saving work period…')).toBeInTheDocument();
		expect(screen.getByLabelText(/^start/i)).toBeDisabled();
		expect(
			screen.getByRole('button', { name: /adding work period/i })
		).toBeDisabled();
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]
						?.body
				)
			)
		).toEqual({
			manager: true,
			projectId: '17',
			assignmentId: 'assignment-1',
			start: '2026-10-01T09:00',
			end: '2026-10-01T11:00',
			quantity: '2.5',
			dateCompleted: '2026-10-01',
			remarks: 'Late correction',
		});
		expect(projectSubmit).not.toHaveBeenCalled();

		finishAdd?.(jsonResponse(200, mutationPayload('period-2')));

		expect(await screen.findByText('Work period added.')).toBeInTheDocument();
		expect(await screen.findByText('Late correction')).toBeInTheDocument();
		expect(projectSubmit).not.toHaveBeenCalled();
	});

	it('corrects a period without changing its assignment or employee', async () => {
		const correctedPeriod = {
			...period,
			end: '2026-10-05T12:00',
			remarks: 'Corrected coordination',
			durationSeconds: 10800,
		};
		fetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'PUT') {
				return Promise.resolve(jsonResponse(200, mutationPayload('period-1')));
			}
			const periods = fetchMock.mock.calls.some(
				([, request]) => request?.method === 'PUT'
			)
				? [correctedPeriod]
				: [period];
			return Promise.resolve(jsonResponse(200, payload(periods)));
		});
		renderWorkspace();
		await screen.findByRole('table', { name: /recorded work periods/i });

		fireEvent.click(screen.getByRole('button', { name: /^edit work period/i }));
		expect(screen.getByLabelText(/^end/i)).toHaveValue('2026-10-05T11:30');
		fireEvent.change(screen.getByLabelText(/^end/i), {
			target: { value: '2026-10-05T12:00' },
		});
		fireEvent.change(screen.getByLabelText(/^remarks/i), {
			target: { value: 'Corrected coordination' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/work-periods',
				expect.objectContaining({ method: 'PUT' })
			);
		});
		const body = JSON.parse(
			String(
				fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]
					?.body
			)
		);
		expect(body).toEqual({
			manager: true,
			projectId: '17',
			id: 'period-1',
			start: '2026-10-05T09:00',
			end: '2026-10-05T12:00',
			quantity: '2.5',
			dateCompleted: '2026-10-05',
			remarks: 'Corrected coordination',
		});
		expect(body).not.toHaveProperty('assignmentId');
		expect(body).not.toHaveProperty('employeeId');
		expect(await screen.findByText('Work period updated.')).toBeInTheDocument();
		expect(
			await screen.findByText('Corrected coordination')
		).toBeInTheDocument();
	});

	it('confirms and removes only the selected period', async () => {
		fetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') {
				return Promise.resolve(jsonResponse(200, mutationPayload('period-1')));
			}
			const periods = fetchMock.mock.calls.some(
				([, request]) => request?.method === 'DELETE'
			)
				? []
				: [period];
			return Promise.resolve(jsonResponse(200, payload(periods)));
		});
		renderWorkspace();
		await screen.findByRole('table', { name: /recorded work periods/i });

		fireEvent.click(
			screen.getByRole('button', { name: /^delete work period/i })
		);
		expect(
			screen.getByText(/delete this work period permanently/i)
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/work-periods',
				expect.objectContaining({ method: 'DELETE' })
			);
		});
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						([, init]) => init?.method === 'DELETE'
					)?.[1]?.body
				)
			)
		).toEqual({ manager: true, projectId: '17', id: 'period-1' });
		expect(await screen.findByText('Work period deleted.')).toBeInTheDocument();
		expect(
			await screen.findByText(/no work periods recorded/i)
		).toBeInTheDocument();
	});

	it('keeps the entered values and explains a rejected correction', async () => {
		fetchMock.mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return Promise.resolve(
					jsonResponse(409, {
						success: false,
						error: 'This work period overlaps another period for Asha Rao.',
					})
				);
			}
			return Promise.resolve(jsonResponse(200, payload()));
		});
		renderWorkspace();
		await screen.findByRole('table', { name: /recorded work periods/i });
		fillNewPeriod();

		fireEvent.click(screen.getByRole('button', { name: 'Add work period' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'This work period overlaps another period for Asha Rao.'
		);
		expect(screen.getByLabelText(/^start/i)).toHaveValue('2026-10-01T09:00');
		expect(screen.getByLabelText(/^end/i)).toHaveValue('2026-10-01T11:00');
		expect(screen.getByLabelText(/^remarks/i)).toHaveValue('Late correction');
		expect(
			screen.getByRole('button', { name: 'Add work period' })
		).toBeEnabled();
	});

	it('shows a load error and can retry the explicit project request', async () => {
		fetchMock.mockRejectedValueOnce(new Error('You cannot edit this project.'));
		renderWorkspace();

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'You cannot edit this project.'
		);
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

		const table = await screen.findByRole('table', {
			name: /recorded work periods/i,
		});
		expect(within(table).getByText('Asha Rao')).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
