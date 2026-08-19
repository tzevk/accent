/**
 * Dev-only seed — idempotent, never runs in production.
 * Run manually: `npm run seed` or `npm run seed:dev`
 * Covers: roles_master, users (admin + rahul.sharma), employees, companies,
 *         deliverable_categories, projects (5 with all tabs).
 *
 * This was previously a migration (20260819120000_seed_dummy_data.js) — moved
 * to seeds/ so `knex migrate:latest` in prod never seeds dummy data.
 */
import bcrypt from 'bcrypt';

export async function seed(knex) {
	if (process.env.NODE_ENV === 'production') {
		console.log('[seed:01_dev_dummy_data] skipped in production');
		return;
	}

	const hasUsers = await knex('users').count('* as cnt').first();
	if (Number(hasUsers?.cnt || 0) > 0) {
		console.log(
			'[seed:01_dev_dummy_data] users already exist, checking masters/projects'
		);
	} else {
		await ensureRoles(knex);
		const { adminId, regularId } = await ensureUsers(knex);
		await ensureCompanies(knex);
		await ensureDeliverableCategories(knex);
		await ensureProjects(knex, { adminId, regularId });
		return;
	}

	await ensureCompanies(knex);
	await ensureDeliverableCategories(knex);
	const hasProjects = await knex('projects')
		.where({ isDelete: 0 })
		.count('* as cnt')
		.first();
	if (Number(hasProjects?.cnt || 0) === 0) {
		const adminRow = await knex('users').where({ is_super_admin: 1 }).first();
		const regularRow = await knex('users').where({ is_super_admin: 0 }).first();
		const adminId = adminRow?.id || 1;
		const regularId = regularRow?.id || 2;
		await ensureProjects(knex, { adminId, regularId });
	}
}

async function ensureRoles(knex) {
	const existing = await knex('roles_master').count('* as cnt').first();
	if (Number(existing?.cnt || 0) > 0) return;
	await knex('roles_master').insert([
		{
			role_code: 'super_admin',
			role_name: 'Super Admin',
			role_hierarchy: 1,
			department: 'Management',
			permissions: JSON.stringify([
				'projects:read',
				'projects:create',
				'projects:update',
				'projects:delete',
				'projects:close',
				'leads:read',
				'leads:create',
				'leads:update',
				'leads:delete',
				'quotations:read',
				'quotations:update',
				'purchase_orders:read',
				'purchase_orders:update',
				'invoices:read',
				'invoices:update',
				'employees:read',
				'employees:update',
				'users:read',
				'users:create',
				'users:update',
				'users:delete',
				'companies:read',
				'companies:update',
				'reports:read',
			]),
			description: 'Full system access',
			status: 'active',
		},
		{
			role_code: 'project_manager',
			role_name: 'Project Manager',
			role_hierarchy: 2,
			department: 'Projects',
			permissions: JSON.stringify([
				'projects:read',
				'projects:update',
				'projects:close',
				'leads:read',
				'quotations:read',
				'purchase_orders:read',
				'invoices:read',
				'reports:read',
			]),
			description: 'Manages projects',
			status: 'active',
		},
		{
			role_code: 'employee',
			role_name: 'Employee',
			role_hierarchy: 10,
			department: 'Engineering',
			permissions: JSON.stringify(['projects:read', 'leads:read']),
			description: 'Standard employee',
			status: 'active',
		},
	]);
}

async function ensureUsers(knex) {
	const adminHash = await bcrypt.hash('Admin@123', 10);
	const userHash = await bcrypt.hash('User@123', 10);
	const adminEmpId = await getOrCreateEmployee(knex, {
		employee_id: 'EMP-001',
		first_name: 'Admin',
		last_name: 'User',
		email: 'admin@accent.test',
		department: 'Management',
		position: 'Super Administrator',
		phone: '9999999999',
		status: 'active',
	});
	const regularEmpId = await getOrCreateEmployee(knex, {
		employee_id: 'EMP-002',
		first_name: 'Rahul',
		last_name: 'Sharma',
		email: 'rahul.sharma@accent.test',
		department: 'Engineering',
		position: 'Design Engineer',
		phone: '8888888888',
		status: 'active',
	});
	const superAdminRole = await knex('roles_master')
		.where({ role_code: 'super_admin' })
		.first();
	const employeeRole = await knex('roles_master')
		.where({ role_code: 'employee' })
		.first();
	const [adminId] = await knex('users').insert({
		username: 'admin',
		password_hash: adminHash,
		email: 'admin@accent.test',
		full_name: 'Admin User',
		employee_id: adminEmpId,
		role_id: superAdminRole?.id || null,
		is_super_admin: 1,
		is_active: 1,
		status: 'active',
		account_type: 'employee',
		isDelete: 0,
	});
	const [regularId] = await knex('users').insert({
		username: 'rahul.sharma',
		password_hash: userHash,
		email: 'rahul.sharma@accent.test',
		full_name: 'Rahul Sharma',
		employee_id: regularEmpId,
		role_id: employeeRole?.id || null,
		is_super_admin: 0,
		is_active: 1,
		status: 'active',
		account_type: 'employee',
		isDelete: 0,
	});
	return { adminId, regularId };
}

async function getOrCreateEmployee(knex, data) {
	const existing = await knex('employees')
		.where({ employee_id: data.employee_id })
		.first();
	if (existing) return existing.id;
	const [id] = await knex('employees').insert({
		employee_id: data.employee_id,
		first_name: data.first_name,
		last_name: data.last_name,
		email: data.email,
		department: data.department,
		position: data.position,
		phone: data.phone,
		status: data.status,
		isDelete: 0,
		city: 'Mumbai',
		state: 'Maharashtra',
		country: 'India',
		present_address: 'Accent Techno Solutions, Mumbai',
	});
	return id;
}

async function ensureCompanies(knex) {
	const cnt = await knex('companies').count('* as cnt').first();
	if (Number(cnt?.cnt || 0) > 0) return;
	await knex('companies').insert([
		{
			company_name: 'Mumbai Metro Rail Corporation',
			industry: 'Infrastructure',
			city: 'Mumbai',
			state: 'Maharashtra',
			country: 'India',
			email: 'contact@mmrcl.test',
			phone: '022-12345678',
			isDelete: 0,
		},
		{
			company_name: 'Adani Power Ltd',
			industry: 'Energy',
			city: 'Ahmedabad',
			state: 'Gujarat',
			country: 'India',
			email: 'projects@adani.test',
			phone: '079-23456789',
			isDelete: 0,
		},
		{
			company_name: 'L&T Construction',
			industry: 'Construction',
			city: 'Chennai',
			state: 'Tamil Nadu',
			country: 'India',
			email: 'info@lnt.test',
			phone: '044-34567890',
			isDelete: 0,
		},
	]);
}

async function ensureDeliverableCategories(knex) {
	const cnt = await knex('deliverable_categories')
		.where({ isDelete: 0 })
		.count('* as cnt')
		.first();
	if (Number(cnt?.cnt || 0) > 0) return;
	await knex('deliverable_categories').insert([
		{ category_name: 'Civil & Structural', isDelete: 0 },
		{ category_name: 'Piping', isDelete: 0 },
		{ category_name: 'Electrical', isDelete: 0 },
		{ category_name: 'Instrumentation', isDelete: 0 },
		{ category_name: 'Mechanical', isDelete: 0 },
	]);
}

async function ensureProjects(knex, { adminId, regularId }) {
	const companies = await knex('companies').where({ isDelete: 0 }).select('id');
	const companyId = companies[0]?.id || null;
	const teamJson = (aId, rId) =>
		JSON.stringify([
			{
				id: aId,
				name: 'Admin User',
				email: 'admin@accent.test',
				department: 'Management',
				position: 'Super Administrator',
				role: 'Project Manager',
			},
			{
				id: rId,
				name: 'Rahul Sharma',
				email: 'rahul.sharma@accent.test',
				department: 'Engineering',
				position: 'Design Engineer',
				role: 'Team Member',
			},
		]);
	const activities = JSON.stringify([
		{
			id: 'act-001',
			type: 'activity',
			activity_name: 'Detailed Design',
			name: 'Detailed Design',
			discipline: 'Civil & Structural',
			function_name: 'Civil & Structural',
			status: 'In Progress',
			assigned_users: [
				{
					user_id: regularId,
					start_date: '2026-02-01',
					due_date: '2026-04-30',
					status: 'In Progress',
					qty_assigned: 120,
					remarks: 'Ongoing',
				},
			],
		},
		{
			id: 'act-002',
			type: 'subactivity',
			activity_name: 'Piping Layout',
			sub_activity_name: 'Stress Analysis',
			name: 'Stress Analysis',
			discipline: 'Piping',
			function_name: 'Piping',
			status: 'Not Started',
			assigned_users: [
				{
					user_id: regularId,
					start_date: '2026-03-01',
					due_date: '2026-05-15',
					status: 'Not Started',
					qty_assigned: 80,
					remarks: '',
				},
			],
		},
	]);
	const schedule = JSON.stringify({
		locked: false,
		rows: [
			{
				id: 'sch-1',
				sr_no: '1',
				activity_description: 'Detailed Design - Foundation',
				discipline: 'Civil & Structural',
				legend: 'accent_activities',
				unit_qty: '120',
				start_date: '2026-02-01',
				end_date: '2026-04-30',
				time_required: '3 months',
				status_completed: 'Ongoing',
				remarks: 'In progress',
			},
			{
				id: 'sch-2',
				sr_no: '2',
				activity_description: 'Piping Stress Analysis',
				discipline: 'Piping',
				legend: 'piping_modelling',
				unit_qty: '80',
				start_date: '2026-03-01',
				end_date: '2026-05-15',
				time_required: '2.5 months',
				status_completed: 'Not Started',
				remarks: '',
			},
		],
	});
	const docsReceived = JSON.stringify([
		{
			id: 1,
			date_received: '2026-01-20',
			description: 'Soil Investigation Report',
			drawing_number: 'SOIL-001',
			revision_number: 'R0',
			unit_qty: '1',
			document_sent_by: 'Client',
			remarks: 'Received via email',
		},
		{
			id: 2,
			date_received: '2026-01-25',
			description: 'Architectural Drawings Set',
			drawing_number: 'ARCH-101',
			revision_number: 'R1',
			unit_qty: '12',
			document_sent_by: 'Consultant',
			remarks: 'Hard copy',
		},
	]);
	const docsIssued = JSON.stringify([
		{
			id: 101,
			document_name: 'Foundation GA Drawing',
			document_number: 'ACC-CIV-001',
			discipline: 'Civil & Structural',
			category: 'Civil & Structural',
			description: 'Foundation general arrangement',
			revision_number: 'R0',
			status: 'IFA',
			planned_date: '2026-03-15',
			actual_date: '2026-03-14',
			prepared_by: 'Rahul Sharma',
			checked_by: 'Admin User',
			approved_by: 'Admin User',
			client_approval: 'Approved',
			remarks: '',
		},
		{
			id: 102,
			document_name: 'Piping Isometric - Unit 1',
			document_number: 'ACC-PIP-010',
			discipline: 'Piping',
			category: 'Piping',
			description: 'Isometric drawing for unit 1',
			revision_number: 'R1',
			status: 'IFR',
			planned_date: '2026-04-01',
			actual_date: '',
			prepared_by: 'Rahul Sharma',
			checked_by: '',
			approved_by: '',
			client_approval: '',
			remarks: 'Under review',
		},
		{
			id: 103,
			document_name: 'Electrical SLD',
			document_number: 'ACC-ELE-005',
			discipline: 'Electrical',
			category: 'Electrical',
			description: 'Single line diagram',
			revision_number: 'R0',
			status: 'IFI',
			planned_date: '2026-04-10',
			actual_date: '2026-04-09',
			prepared_by: 'Rahul Sharma',
			checked_by: 'Admin User',
			approved_by: '',
			client_approval: '',
			remarks: '',
		},
	]);
	const handover = JSON.stringify([
		{
			id: 1,
			output_by_accent: 'Foundation Design Package',
			requirement_accomplished: 'Yes',
			remark: 'Submitted',
			hand_over: '2026-04-20',
		},
		{
			id: 2,
			output_by_accent: 'Piping Layout Package',
			requirement_accomplished: 'In Progress',
			remark: '60% done',
			hand_over: '',
		},
	]);
	const manhours = JSON.stringify([
		{
			id: 1,
			employee_id: String(regularId),
			employee_name: 'Rahul Sharma',
			salary_type: 'monthly',
			rate_company: 450,
			rate_accent: 500,
			monthly_hours: { jan: 160, feb: 168, mar: 176, apr: 144 },
		},
	]);
	const queryLog = JSON.stringify([
		{
			id: 1,
			query_description: 'Clarification on load combinations',
			query_issued_date: '2026-02-10',
			reply_from_client: 'Use IS 875',
			reply_received_date: '2026-02-12',
			query_updated_by: 'Rahul Sharma',
			query_resolved: 'Yes',
			remark: 'Closed',
		},
	]);
	const assumptions = JSON.stringify([
		{
			id: 1,
			assumption_description: 'Soil bearing capacity 200 kN/m2',
			reason: 'Based on SI report',
			assumption_taken_by: 'Rahul Sharma',
			remark: 'To be verified',
			sr_no: 1,
		},
	]);
	const lessons = JSON.stringify([
		{
			id: 1,
			what_was_new: 'BIM clash detection',
			difficulty_faced: 'Model coordination',
			what_you_learn: 'Early clash saves time',
			areas_of_improvement: 'Weekly BIM meets',
			remark: '',
			sr_no: 1,
		},
	]);
	const kickoff = JSON.stringify([
		{
			id: 1,
			meeting_no: 'KOM-001',
			meeting_title: 'Project Kickoff',
			meeting_date: '2026-01-18',
			organizer: 'Admin User',
			meeting_location: 'Mumbai HQ',
			client_representative: 'Mr. Patel',
			points_discussed: 'Scope finalization\nTimeline\nDeliverables',
			persons_involved: 'Admin, Rahul, Client Team',
			mom_document: null,
		},
	]);
	const internal = JSON.stringify([
		{
			id: 2,
			meeting_no: 'IM-001',
			meeting_title: 'Weekly Review',
			meeting_date: '2026-02-05',
			organizer: 'Admin User',
			meeting_location: 'Teams',
			client_representative: '',
			points_discussed: 'Design progress\nResource loading',
			persons_involved: 'Admin, Rahul',
			mom_document: null,
		},
	]);
	const inputDocsList = JSON.stringify([
		{
			id: 11,
			sr_no: '1',
			date_received: '2026-01-20',
			description: 'Soil Report - Lot 1',
			drawing_number: 'SOIL-001',
			sheet_number: '1',
			revision_number: 'R0',
			unit_qty: '1',
			document_sent_by: 'Client',
			remarks: '',
			category: 'lot',
			lotNumber: 'Lot 1',
			subLot: 'A',
		},
	]);
	const software = JSON.stringify([
		{
			id: 1,
			category_name: 'Design',
			software_name: 'STAAD Pro',
			provider: 'Bentley',
			version_name: 'V8i',
			release_date: '2024-01-01',
			notes: 'Structural analysis',
		},
	]);
	const projects = [
		{
			name: 'Mumbai Metro Line 3 - Station Design',
			project_code: 'PROJ-001',
			client_name: 'Mumbai Metro Rail Corporation',
			project_manager: 'Admin User',
			start_date: '2026-01-15',
			end_date: '2026-12-31',
			target_date: '2026-12-31',
			status: 'in-progress',
			type: 'CONSULTANCY',
			description:
				'Detailed design of underground metro station including civil, structural and architectural coordination.',
			scope_of_work:
				'<p>Complete detailed design including <strong>foundation, superstructure, and MEP coordination</strong> for metro station.</p>',
			additional_scope:
				'Additional ventilation design\nFire safety audit as per NFPA',
			list_of_deliverables: 'Foundation drawings\nStructural GA\nMEP layouts',
			estimated_manhours: 2400,
			unit_qty: 1,
			project_value: 4500000,
			currency: 'INR',
			payment_terms: 'Net 30',
			invoicing_status: 'Partially Invoiced',
			company_id: companyId,
			created_at: knex.fn.now(),
			updated_at: knex.fn.now(),
		},
		{
			name: 'Adani Solar Plant - Electrical Package',
			project_code: 'PROJ-002',
			client_name: 'Adani Power Ltd',
			project_manager: 'Admin User',
			start_date: '2026-02-01',
			end_date: '2026-11-30',
			target_date: '2026-11-30',
			status: 'planning',
			type: 'EPC',
			description:
				'Electrical system design and procurement for 100MW solar plant.',
			scope_of_work:
				'<p>Electrical SLD, cable sizing, earthing and lightning protection design.</p>',
			additional_scope: '',
			list_of_deliverables: 'SLD\nCable schedule\nEarthing layout',
			estimated_manhours: 1800,
			unit_qty: 1,
			project_value: 3200000,
			currency: 'INR',
			payment_terms: 'Net 45',
			invoicing_status: 'Uninvoiced',
			company_id: companyId,
			created_at: knex.fn.now(),
			updated_at: knex.fn.now(),
		},
		{
			name: 'L&T Highrise - Structural Review',
			project_code: 'PROJ-003',
			client_name: 'L&T Construction',
			project_manager: 'Rahul Sharma',
			start_date: '2026-03-10',
			end_date: '2026-09-30',
			target_date: '2026-09-30',
			status: 'in-progress',
			type: 'PMC',
			description: 'Peer review of highrise structural design.',
			scope_of_work:
				'<p>Review of structural calculations and drawings for 30-storey tower.</p>',
			additional_scope: 'Wind tunnel report review',
			list_of_deliverables: 'Review comments\nCompliance report',
			estimated_manhours: 900,
			unit_qty: 1,
			project_value: 1800000,
			currency: 'INR',
			payment_terms: 'Advance',
			invoicing_status: 'Paid',
			company_id: companyId,
			created_at: knex.fn.now(),
			updated_at: knex.fn.now(),
		},
		{
			name: 'Internal - BIM Standards Development',
			project_code: 'PROJ-004',
			client_name: 'Accent Internal',
			project_manager: 'Admin User',
			start_date: '2026-04-01',
			end_date: '2026-07-31',
			target_date: '2026-07-31',
			status: 'on-hold',
			type: 'ONGOING',
			description: 'Development of BIM execution plan and templates.',
			scope_of_work:
				'<p>Create BIM standards, templates and training material.</p>',
			additional_scope: '',
			list_of_deliverables: 'BEP document\nRevit templates',
			estimated_manhours: 400,
			unit_qty: 1,
			project_value: 0,
			currency: 'INR',
			payment_terms: '',
			invoicing_status: '',
			company_id: companyId,
			created_at: knex.fn.now(),
			updated_at: knex.fn.now(),
		},
		{
			name: 'Gujarat Refinery - Piping Flexibility',
			project_code: 'PROJ-005',
			client_name: 'Adani Power Ltd',
			project_manager: 'Rahul Sharma',
			start_date: '2026-05-01',
			end_date: '2026-10-31',
			target_date: '2026-10-31',
			status: 'NEW',
			type: 'CONSULTANCY',
			description: 'Flexibility analysis for refinery piping.',
			scope_of_work:
				'<p>Stress analysis using CAESAR II for critical piping loops.</p>',
			additional_scope: '',
			list_of_deliverables: 'Stress reports\nIsometrics',
			estimated_manhours: 1200,
			unit_qty: 1,
			project_value: 2100000,
			currency: 'INR',
			payment_terms: 'Net 30',
			invoicing_status: 'Uninvoiced',
			company_id: companyId,
			created_at: knex.fn.now(),
			updated_at: knex.fn.now(),
		},
	];
	for (const p of projects) {
		const base = {
			...p,
			project_team: teamJson(adminId, regularId),
			team_members: teamJson(adminId, regularId),
			project_activities_list: activities,
			project_schedule_list: schedule,
			documents_received_list: docsReceived,
			documents_issued_list: docsIssued,
			project_handover_list: handover,
			project_manhours_list: manhours,
			project_query_log_list: queryLog,
			project_assumption_list: assumptions,
			project_lessons_learnt_list: lessons,
			kickoff_meetings_list: kickoff,
			internal_meetings_list: internal,
			input_documents_list: inputDocsList,
			software_items: software,
			isDelete: 0,
		};
		await knex('projects').insert(base);
	}
}
