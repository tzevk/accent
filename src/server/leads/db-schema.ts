import {
	date,
	int,
	mysqlTable,
	tinyint,
	varchar,
} from 'drizzle-orm/mysql-core';

// Pilot Drizzle query mappings, not a full description of the database.
export const leadWorkLeads = mysqlTable('leads', {
	id: int('id').primaryKey(),
	companyName: varchar('company_name', { length: 255 }).notNull(),
	isDelete: tinyint('isDelete'),
});

export const leadWorkActivities = mysqlTable('lead_activities', {
	id: int('id').primaryKey(),
	leadId: int('lead_id').notNull(),
	activityType: varchar('activity_type', { length: 16 }),
	status: varchar('status', { length: 16 }).notNull(),
	scheduledFor: date('scheduled_for', { mode: 'string' }),
	nextAction: varchar('next_action', { length: 255 }),
	isDelete: tinyint('isDelete').notNull(),
	transferredFollowupId: int('transferred_followup_id'),
});
