import { z } from 'zod';

export type WorkPeriodCommandErrorCode =
	| 'INVALID_WORK_PERIOD'
	| 'INVALID_ACTIVITY_SELECTION'
	| 'EMPLOYEE_LINK_REQUIRED'
	| 'PROJECT_ACCESS_DENIED'
	| 'OUTSIDE_SELF_SERVICE_WINDOW'
	| 'WORK_PERIOD_OVERLAP'
	| 'WORK_PERIOD_NOT_FOUND'
	| 'ASSIGNMENT_NOT_AVAILABLE'
	| 'WORK_PERIOD_WRITE_FAILED';

export class WorkPeriodCommandError extends Error {
	readonly status: number;
	readonly code: WorkPeriodCommandErrorCode;

	constructor(
		status: number,
		code: WorkPeriodCommandErrorCode,
		message: string
	) {
		super(message);
		this.name = 'WorkPeriodCommandError';
		this.status = status;
		this.code = code;
	}
}

export function parseWorkPeriodSchema<T>(
	schema: z.ZodType<T>,
	value: unknown
): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new WorkPeriodCommandError(
			400,
			'INVALID_WORK_PERIOD',
			result.error.issues[0]?.message ?? 'Invalid Work Period request.'
		);
	}
	return result.data;
}

function requiredIdentifier(label: string) {
	return z
		.string({ error: `${label} is required.` })
		.trim()
		.min(1, { error: `${label} is required.` });
}

const projectIdSchema = z.union(
	[
		z
			.number({ error: 'projectId is required.' })
			.int()
			.positive()
			.refine(Number.isSafeInteger, { error: 'projectId is required.' }),
		z
			.string({ error: 'projectId is required.' })
			.trim()
			.min(1, { error: 'projectId is required.' })
			.transform(Number)
			.pipe(
				z
					.number({ error: 'projectId is required.' })
					.int()
					.positive()
					.refine(Number.isSafeInteger, { error: 'projectId is required.' })
			),
	],
	{ error: 'projectId is required.' }
);

const managerSchema = z
	.boolean({ error: 'manager must be true when using manager scope.' })
	.default(false);

const endpointSchema = z
	.string({
		error: 'Start and End are required and must use YYYY-MM-DDTHH:mm in IST.',
	})
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, {
		error: 'Start and End are required and must use YYYY-MM-DDTHH:mm in IST.',
	});

const quantityNumberSchema = z
	.union(
		[
			z.number({ error: 'Quantity must be a non-negative number.' }),
			z
				.string({ error: 'Quantity must be a non-negative number.' })
				.trim()
				.min(1, { error: 'Quantity must be a non-negative number.' })
				.transform(Number),
		],
		{ error: 'Quantity must be a non-negative number.' }
	)
	.refine((value) => Number.isFinite(value) && value >= 0, {
		error: 'Quantity must be a non-negative number.',
	});

const quantitySchema = z.preprocess(
	(value) =>
		value === undefined || value === null || value === '' ? 0 : value,
	quantityNumberSchema
);

const workPeriodFieldsSchema = z.object({
	start: endpointSchema,
	end: endpointSchema,
	quantity: quantitySchema,
	dateCompleted: z
		.string({
			error: 'Date Completed must be a valid IST date in YYYY-MM-DD format.',
		})
		.trim()
		.nullish(),
	remarks: z.string({ error: 'Remarks must be text.' }).trim().nullish(),
});

export type WorkPeriodRequestFields = z.infer<typeof workPeriodFieldsSchema>;

export const workPeriodJsonObjectSchema = z
	.object({}, { error: 'A valid JSON request body is required.' })
	.passthrough();

export const workPeriodCreateScopeSchema = z
	.object({
		manager: managerSchema,
		projectId: projectIdSchema,
	})
	.passthrough();

export const workPeriodMutationScopeSchema = z
	.object({
		manager: managerSchema,
		projectId: projectIdSchema,
		id: requiredIdentifier('id'),
	})
	.passthrough();

const requiredDescription = {
	error: 'Enter an Activity Description.',
	path: ['remarks'],
};

export const createSelfWorkPeriodSchema = workPeriodFieldsSchema
	.extend({
		manager: z.literal(false).default(false),
		projectId: projectIdSchema,
		disciplineId: requiredIdentifier('disciplineId'),
		activityId: requiredIdentifier('activityId'),
		subActivityId: z.union(
			[
				z.string({
					error: 'Choose a Sub-activity or No sub-activity.',
				}),
				z.null({ error: 'Choose a Sub-activity or No sub-activity.' }),
			],
			{ error: 'Choose a Sub-activity or No sub-activity.' }
		),
	})
	.passthrough()
	.refine((data) => Boolean(data.remarks), requiredDescription);

export const createManagerWorkPeriodSchema = workPeriodFieldsSchema
	.extend({
		manager: z.literal(true),
		projectId: projectIdSchema,
		assignmentId: requiredIdentifier('Assignment'),
	})
	.passthrough();

export const updateWorkPeriodSchema = workPeriodFieldsSchema
	.extend({
		manager: managerSchema,
		projectId: projectIdSchema,
		id: requiredIdentifier('id'),
	})
	.passthrough()
	.refine((data) => data.manager || Boolean(data.remarks), requiredDescription);

export const deleteWorkPeriodSchema = workPeriodMutationScopeSchema;

export const workPeriodQuerySchema = z.object({
	projectId: z.preprocess(
		(value) => (value === '' ? undefined : value),
		requiredIdentifier('projectId').optional()
	),
	userId: z.preprocess(
		(value) => (value === '' ? undefined : value),
		z
			.string({ error: 'userId must be a valid User Account id.' })
			.trim()
			.regex(/^\d+$/, { error: 'userId must be a valid User Account id.' })
			.optional()
	),
	week: z
		.string({
			error: 'week must be a valid Monday in YYYY-MM-DD format.',
		})
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/, {
			error: 'week must be a valid Monday in YYYY-MM-DD format.',
		})
		.optional(),
});
