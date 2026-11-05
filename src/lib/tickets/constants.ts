/**
 * Ticket status values stored by `support_tickets.status`.
 *
 * This module is client-safe: it must stay free of server imports so client
 * components can share the exact enum labels without pulling in the database
 * layer. The values match the database enum; do not add display-only values.
 */
export const TICKET_STATUSES = [
	{ value: 'open', label: 'New' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'pending_info', label: 'Waiting for Employee' },
	{ value: 'resolved', label: 'Resolved' },
	{ value: 'closed', label: 'Closed' },
] as const;
