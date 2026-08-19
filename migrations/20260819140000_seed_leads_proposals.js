/**
 * Seed mock leads + proposals for empty DBs — idempotent.
 * Runs only if tables are empty (count === 0). Safe to re-run.
 * Reuses companies seeded in 20260819120000_seed_dummy_data.js.
 */

export async function up(knex) {
	const leadCnt = await knex('leads')
		.where({ isDelete: 0 })
		.count('* as cnt')
		.first()
		.catch(() => ({ cnt: 1 }));
	if (Number(leadCnt?.cnt || 0) === 0) {
		await seedLeads(knex);
	} else {
		console.log('[seed_leads_proposals] leads already exist, skipping');
	}

	const propCnt = await knex('proposals')
		.where({ isDelete: 0 })
		.count('* as cnt')
		.first()
		.catch(() => ({ cnt: 1 }));
	if (Number(propCnt?.cnt || 0) === 0) {
		await seedProposals(knex);
	} else {
		console.log('[seed_leads_proposals] proposals already exist, skipping');
	}
}

async function seedLeads(knex) {
	const companies = await knex('companies')
		.where({ isDelete: 0 })
		.select('id', 'company_name', 'city', 'email', 'phone');
	const byName = Object.fromEntries(companies.map((c) => [c.company_name, c]));
	const getCompany = (name) =>
		byName[name] ||
		companies[0] || { id: null, company_name: name, city: 'Mumbai' };

	const today = new Date();
	const daysAgo = (n) => {
		const d = new Date(today);
		d.setDate(d.getDate() - n);
		return d.toISOString().slice(0, 10);
	};
	const nextWeek = () => {
		const d = new Date(today);
		d.setDate(d.getDate() + 7);
		return d.toISOString().slice(0, 10);
	};

	const leads = [
		{
			company_id: getCompany('Mumbai Metro Rail Corporation').id,
			company_name: 'Mumbai Metro Rail Corporation',
			contact_name: 'Sanjay Patel',
			contact_email: 'sanjay.patel@mmrcl.test',
			inquiry_email: 'projects@mmrcl.test',
			cc_emails: 'pm@mmrcl.test, contracts@mmrcl.test',
			designation: 'Chief Engineer',
			phone: '022-12345678',
			city: 'Mumbai',
			project_description:
				'Detailed design of underground metro station — civil + structural + MEP coordination',
			enquiry_type: 'Email',
			enquiry_status: 'Under Discussion',
			enquiry_date: daysAgo(5),
			lead_source: 'Email',
			priority: 'High',
			assigned_to: 'Admin User',
			notes:
				'Follow up with site visit schedule. Client expects draft proposal in 7 days.',
			follow_up_date: nextWeek(),
			lead_id: `001-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			project_schedule: 'Q1 foundation, Q2 superstructure',
			input_document: 'Soil report, Architectural drawings (R1)',
			list_of_deliverables: 'GA drawings, Structural calcs, MEP clash report',
			isDelete: 0,
		},
		{
			company_id: getCompany('Adani Power Ltd').id,
			company_name: 'Adani Power Ltd',
			contact_name: 'Priya Shah',
			contact_email: 'priya.shah@adani.test',
			inquiry_email: 'power.projects@adani.test',
			cc_emails: 'procurement@adani.test',
			designation: 'Project Manager',
			phone: '079-23456789',
			city: 'Ahmedabad',
			project_description:
				'100MW solar plant electrical package — SLD, cable sizing, earthing & lightning protection',
			enquiry_type: 'Referral',
			enquiry_status: 'Awarded',
			enquiry_date: daysAgo(12),
			lead_source: 'Referral',
			priority: 'High',
			assigned_to: 'Admin User',
			notes: 'Won — converted to proposal. Client PO expected next week.',
			follow_up_date: daysAgo(2),
			lead_id: `002-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
		{
			company_id: getCompany('L&T Construction').id,
			company_name: 'L&T Construction',
			contact_name: 'R. K. Menon',
			contact_email: 'rk.menon@lnt.test',
			inquiry_email: 'tenders@lnt.test',
			designation: 'DGM - Design',
			phone: '044-34567890',
			city: 'Chennai',
			project_description:
				'Peer review of 30-storey highrise structural design + wind tunnel report review',
			enquiry_type: 'Website',
			enquiry_status: 'Awaiting',
			enquiry_date: daysAgo(20),
			lead_source: 'Website',
			priority: 'Medium',
			assigned_to: 'Rahul Sharma',
			notes: 'Client shared ETABS model. Awaiting wind tunnel data.',
			follow_up_date: nextWeek(),
			lead_id: `003-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
		{
			company_name: 'Godrej Properties',
			contact_name: 'Anjali Desai',
			contact_email: 'anjali.desai@godrej.test',
			inquiry_email: 'projects@godrej.test',
			designation: 'Head - Projects',
			phone: '022-98765000',
			city: 'Mumbai',
			project_description:
				'Luxury residential tower MEP concept + BIM coordination for 45 floors',
			enquiry_type: 'LinkedIn',
			enquiry_status: 'Regretted',
			enquiry_date: daysAgo(30),
			lead_source: 'LinkedIn',
			priority: 'Low',
			assigned_to: 'Rahul Sharma',
			notes: 'Regretted — budget below threshold. Keep for future.',
			follow_up_date: null,
			lead_id: `004-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
		{
			company_name: 'Tata Motors - Pune Plant',
			contact_name: 'Vikram Joshi',
			contact_email: 'vikram.joshi@tatamotors.test',
			inquiry_email: 'plant.engg@tatamotors.test',
			designation: 'Plant Engineering Head',
			phone: '020-11223344',
			city: 'Pune',
			project_description:
				'Flexibility analysis for refinery piping loops using CAESAR II — critical lines',
			enquiry_type: 'Justdial',
			enquiry_status: 'Under Discussion',
			enquiry_date: daysAgo(3),
			lead_source: 'Justdial',
			priority: 'Medium',
			assigned_to: 'Admin User',
			notes: 'Site visit done. Awaiting inputs: P&IDs + isometric sketches.',
			follow_up_date: nextWeek(),
			lead_id: `005-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
		{
			company_name: 'Infosys - Hyderabad Campus',
			contact_name: 'Neha Reddy',
			contact_email: 'neha.reddy@infosys.test',
			inquiry_email: 'facilities@infosys.test',
			designation: 'Facilities Lead',
			phone: '040-99887766',
			city: 'Hyderabad',
			project_description:
				'BIM standards + Revit template development for campus expansion',
			enquiry_type: 'Call',
			enquiry_status: 'Close',
			enquiry_date: daysAgo(45),
			lead_source: 'Call',
			priority: 'Low',
			assigned_to: 'Admin User',
			notes: 'Closed — deferred to next FY. Move to cold list.',
			follow_up_date: null,
			lead_id: `006-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
		{
			company_name: 'Reliance Industries - Jamnagar',
			contact_name: 'Amit Khanna',
			contact_email: 'amit.khanna@ril.test',
			inquiry_email: 'engg@ril.test',
			cc_emails: 'capex@ril.test, qa@ril.test',
			designation: 'VP Engineering',
			phone: '0288-5555000',
			city: 'Jamnagar',
			project_description:
				'Revamp of instrumentation & electrical for refinery unit — DCS migration',
			enquiry_type: 'Email',
			enquiry_status: 'Converted to Proposal',
			enquiry_date: daysAgo(8),
			lead_source: 'Email',
			priority: 'High',
			assigned_to: 'Admin User',
			notes:
				'Converted to proposal PROP-002. Proposal sent, awaiting client approval.',
			follow_up_date: daysAgo(1),
			lead_id: `007-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`,
			isDelete: 0,
		},
	];

	for (const l of leads) {
		await knex('leads').insert(l);
	}
	console.log(`[seed_leads_proposals] inserted ${leads.length} leads`);
}

async function seedProposals(knex) {
	const companies = await knex('companies')
		.where({ isDelete: 0 })
		.select('id', 'company_name');
	const byName = Object.fromEntries(companies.map((c) => [c.company_name, c]));
	const getCompanyId = (name) => byName[name]?.id ?? null;

	// Try to link some proposals to leads (if leads were just seeded, fetch them)
	const leads = await knex('leads')
		.where({ isDelete: 0 })
		.select('id', 'company_name')
		.limit(10);
	const leadByCompany = Object.fromEntries(
		leads.map((l) => [l.company_name, l.id])
	);

	const today = new Date();
	const iso = (d) => d.toISOString().slice(0, 10);
	const daysAgo = (n) => {
		const d = new Date(today);
		d.setDate(d.getDate() - n);
		return iso(d);
	};
	const daysAhead = (n) => {
		const d = new Date(today);
		d.setDate(d.getDate() + n);
		return iso(d);
	};

	const month = String(today.getMonth() + 1).padStart(2, '0');
	const year = today.getFullYear();

	const proposals = [
		{
			proposal_id: `PROP-${year}-${month}-001`,
			proposal_title:
				'Mumbai Metro Line 3 — Underground Station Detailed Design',
			description:
				'Detailed design of underground metro station including foundation, superstructure and MEP coordination with BIM clash detection.',
			company_id: getCompanyId('Mumbai Metro Rail Corporation'),
			client_name: 'Mumbai Metro Rail Corporation',
			client_contact_details:
				'Sanjay Patel, Chief Engineer — sanjay.patel@mmrcl.test, +91 22-12345678',
			project_location_city: 'Mumbai',
			project_location_country: 'India',
			industry: 'Infrastructure',
			contract_type: 'CONSULTANCY',
			proposal_value: 4500000,
			currency: 'INR',
			payment_terms:
				'Net 30 — 30% advance, 40% on GA approval, 30% on final submission',
			planned_start_date: daysAgo(2),
			planned_end_date: daysAhead(180),
			target_date: daysAhead(180),
			project_schedule:
				'Q1: Foundation & geotech | Q2: Superstructure | Q3: MEP & handover',
			input_document:
				'Soil investigation report, Architectural drawings R1, Survey data',
			list_of_deliverables:
				'Foundation GA drawings, Structural calculations, MEP layouts, BIM clash report',
			annexure_scope_of_work:
				'<p>Complete detailed design including <strong>foundation, superstructure and MEP</strong> with 3D BIM coordination and clash resolution.</p>',
			annexure_deliverables:
				'GA drawings, Design calculations, BOQ, Clash report',
			annexure_duration: '6 months from LOA',
			annexure_exclusions: 'Site supervision, liaison with authorities',
			status: 'pending',
			priority: 'HIGH',
			lead_id: leadByCompany['Mumbai Metro Rail Corporation'] || null,
			enquiry_no: `ENQ-${year}-${month}-001`,
			quotation_number: `QT-${year}-${month}-001`,
			quotation_date: daysAgo(3),
			gross_amount: 4500000,
			gst_percentage: 18,
			gst_amount: 810000,
			net_amount: 5310000,
			scope_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'Foundation design',
					qty: 1,
					unit: 'lumpsum',
					charges: 1500000,
					amount: 1500000,
				},
				{
					sr_no: 2,
					description: 'Superstructure design',
					qty: 1,
					unit: 'lumpsum',
					charges: 2000000,
					amount: 2000000,
				},
				{
					sr_no: 3,
					description: 'MEP coordination',
					qty: 1,
					unit: 'lumpsum',
					charges: 1000000,
					amount: 1000000,
				},
			]),
			terms_and_conditions: 'Payment as per milestone. Taxes extra.',
			client_address: 'MMRCL HQ, BKC, Mumbai — 400051',
			kind_attn: 'Mr. Sanjay Patel',
			isDelete: 0,
		},
		{
			proposal_id: `PROP-${year}-${month}-002`,
			proposal_title: 'Adani Power — 100MW Solar Plant Electrical Package',
			description:
				'Electrical SLD, cable sizing, earthing and lightning protection design for ground-mount solar expansion.',
			company_id: getCompanyId('Adani Power Ltd'),
			client_name: 'Adani Power Ltd',
			industry: 'Energy',
			contract_type: 'EPC',
			proposal_value: 3200000,
			currency: 'INR',
			payment_terms: 'Net 45',
			planned_start_date: daysAgo(10),
			planned_end_date: daysAhead(120),
			target_date: daysAhead(120),
			status: 'approved',
			priority: 'MEDIUM',
			lead_id: leadByCompany['Adani Power Ltd'] || null,
			quotation_number: `QT-${year}-${month}-002`,
			quotation_date: daysAgo(11),
			gross_amount: 3200000,
			gst_percentage: 18,
			gst_amount: 576000,
			net_amount: 3776000,
			scope_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'SLD & protection',
					qty: 1,
					unit: 'set',
					charges: 1800000,
					amount: 1800000,
				},
				{
					sr_no: 2,
					description: 'Cable schedule & earthing',
					qty: 1,
					unit: 'set',
					charges: 1400000,
					amount: 1400000,
				},
			]),
			isDelete: 0,
		},
		{
			proposal_id: `PROP-${year}-${month}-003`,
			proposal_title: 'L&T Construction — 30-Storey Highrise Peer Review',
			description:
				'Independent peer review of structural calculations and drawings including wind tunnel report scrutiny.',
			company_id: getCompanyId('L&T Construction'),
			client_name: 'L&T Construction',
			industry: 'Construction',
			contract_type: 'PMC',
			proposal_value: 1800000,
			currency: 'INR',
			payment_terms: 'Advance — 50% on kickoff, 50% on report submission',
			status: 'draft',
			priority: 'HIGH',
			gross_amount: 1800000,
			gst_percentage: 18,
			gst_amount: 324000,
			net_amount: 2124000,
			scope_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'Structural calculations review',
					qty: 1,
					unit: 'lumpsum',
					charges: 1200000,
					amount: 1200000,
				},
				{
					sr_no: 2,
					description: 'Wind tunnel report review',
					qty: 1,
					unit: 'lumpsum',
					charges: 600000,
					amount: 600000,
				},
			]),
			isDelete: 0,
		},
		{
			proposal_id: `PROP-${year}-${month}-004`,
			proposal_title: 'Godrej Properties — Residential Tower MEP Concept & BIM',
			description:
				'MEP concept and BIM coordination for 45-floor luxury residential tower.',
			client_name: 'Godrej Properties',
			industry: 'Real Estate',
			proposal_value: 2600000,
			currency: 'INR',
			status: 'rejected',
			priority: 'LOW',
			gross_amount: 2600000,
			gst_percentage: 18,
			gst_amount: 468000,
			net_amount: 3068000,
			isDelete: 0,
		},
		{
			proposal_id: `PROP-${year}-${month}-005`,
			proposal_title:
				'Reliance Jamnagar — DCS Migration Electrical & Instrumentation',
			description:
				'Electrical and instrumentation revamp with DCS migration for refinery unit.',
			client_name: 'Reliance Industries - Jamnagar',
			industry: 'Oil & Gas',
			contract_type: 'CONSULTANCY',
			proposal_value: 5100000,
			currency: 'INR',
			payment_terms: 'Net 30',
			status: 'pending',
			priority: 'HIGH',
			lead_id: leadByCompany['Reliance Industries - Jamnagar'] || null,
			gross_amount: 5100000,
			gst_percentage: 18,
			gst_amount: 918000,
			net_amount: 6018000,
			scope_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'Electrical revamp design',
					qty: 1,
					unit: 'lumpsum',
					charges: 2500000,
					amount: 2500000,
				},
				{
					sr_no: 2,
					description: 'Instrumentation & DCS migration',
					qty: 1,
					unit: 'lumpsum',
					charges: 2600000,
					amount: 2600000,
				},
			]),
			isDelete: 0,
		},
		{
			proposal_id: `PROP-${year}-${month}-006`,
			proposal_title: 'Infosys Hyderabad — Campus Expansion BIM Standards',
			description:
				'BIM execution plan, Revit templates and training for campus expansion.',
			client_name: 'Infosys - Hyderabad Campus',
			industry: 'IT Campus',
			status: 'approved',
			priority: 'MEDIUM',
			gross_amount: 900000,
			gst_percentage: 18,
			gst_amount: 162000,
			net_amount: 1062000,
			isDelete: 0,
		},
	];

	for (const p of proposals) {
		// Avoid duplicate proposal_id (unique)
		const exists = await knex('proposals')
			.where({ proposal_id: p.proposal_id })
			.first();
		if (exists) continue;
		await knex('proposals').insert(p);
	}
	console.log(
		`[seed_leads_proposals] proposals seeding done (attempted ${proposals.length})`
	);
}

export async function down(knex) {
	await knex('leads')
		.whereIn(
			'lead_id',
			['001-', '002-', '003-', '004-', '005-', '006-', '007-'].map((prefix) =>
				knex.raw(`CONCAT(?, DATE_FORMAT(NOW(), '%m-%Y'))`, [prefix])
			)
		)
		.del()
		.catch(() => {});
	// Fallback: delete by company_name + project_description pattern for seeded rows
	await knex('proposals')
		.where('proposal_id', 'like', 'PROP-%')
		.whereIn('client_name', [
			'Mumbai Metro Rail Corporation',
			'Adani Power Ltd',
			'L&T Construction',
			'Godrej Properties',
			'Reliance Industries - Jamnagar',
			'Infosys - Hyderabad Campus',
		])
		.del()
		.catch(() => {});
}
