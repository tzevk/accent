/**
 * The failure a financial command or validation raises, mapped onto an HTTP
 * status by the routes. Shared by every cost source (#306 direct expenses,
 * #311 supplier invoices) and the source-link seam.
 */

export class CostError extends Error {
	readonly code: string;
	readonly status: number;
	readonly detail: Record<string, unknown>;

	constructor(
		code: string,
		message: string,
		status: number,
		detail: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'CostError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}
