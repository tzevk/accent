/**
 * Disposable creators and authored drafts for the Company and Vendor master
 * browser journeys.
 *
 * Each seed creates one ordinary active identity with a namespaced custom role
 * that carries exactly the grants its master page needs:
 *
 * - Company: `companies:read` + `companies:create`.
 * - Vendor: `vendors:read` + `vendors:create`.
 *
 * There is no super-admin, no shared role, and no extra module right. The
 * master row itself is authored in the browser, not seeded here: each test's
 * starting state is "no row with this namespaced name".
 *
 * Only `vendor_name` and `company_name` are required by the server. Every
 * other authored value below is optional form data the journey chooses to
 * fill, so the proof can distinguish a real save from a default row.
 *
 * `dispose()` resolves the single owned row from the exact namespaced name the
 * draft produced (unique per worker and test), then deletes it by its primary
 * key before deleting the identity. That keeps failure paths clean without
 * matching another worker's rows by a loose name.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createJourneyUser } from './journey-user.ts';

/** Exactly what the Company page and its create endpoint require. */
export const COMPANY_CREATOR_PERMISSIONS = [
	'companies:read',
	'companies:create',
] as const;

/** Exactly what the Vendor pages and their create endpoint require. */
export const VENDOR_CREATOR_PERMISSIONS = [
	'vendors:read',
	'vendors:create',
] as const;

export interface CompanyDraft {
	companyName: string;
	industry: string;
	sector: string;
	website: string;
	description: string;
	contactPerson: string;
	designation: string;
	email: string;
	phone: string;
	mobileNumber: string;
}

export interface VendorDraft {
	vendorName: string;
	vendorType: string;
	industryCategory: string;
	status: string;
	contactPerson: string;
	contactDesignation: string;
	phone: string;
	email: string;
	addressStreet: string;
	addressCity: string;
	addressState: string;
	addressCountry: string;
	addressPin: string;
	website: string;
	bankName: string;
	bankAccountNo: string;
	ifscSwiftCode: string;
	currencyPreference: string;
	paymentTerms: string;
	creditLimit: string;
}

export interface CompanyCreatorFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	draft: CompanyDraft;
	/** Delete the owned master row (if created) and then the identity. */
	dispose(): Promise<void>;
}

export interface VendorCreatorFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	draft: VendorDraft;
	/** Delete the owned master row (if created) and then the identity. */
	dispose(): Promise<void>;
}

export interface StoredCompany {
	id: number;
	companyId: string | null;
	companyName: string;
	industry: string | null;
	sector: string | null;
	website: string | null;
	description: string | null;
	contactPerson: string | null;
	designation: string | null;
	email: string | null;
	phone: string | null;
	mobileNumber: string | null;
	isDelete: number;
}

export interface StoredVendor {
	id: number;
	vendorId: string | null;
	vendorName: string;
	vendorType: string | null;
	industryCategory: string | null;
	status: string | null;
	contactPerson: string | null;
	contactDesignation: string | null;
	phone: string | null;
	email: string | null;
	addressStreet: string | null;
	addressCity: string | null;
	addressState: string | null;
	addressCountry: string | null;
	addressPin: string | null;
	website: string | null;
	bankName: string | null;
	bankAccountNo: string | null;
	ifscSwiftCode: string | null;
	currencyPreference: string | null;
	paymentTerms: string | null;
	creditLimit: string | null;
	isDelete: number;
}

interface IdRow extends RowDataPacket {
	id: number | string;
}

interface CompanyRow extends RowDataPacket {
	id: number | string;
	company_id: string | null;
	company_name: string;
	industry: string | null;
	sector: string | null;
	website: string | null;
	description: string | null;
	contact_person: string | null;
	designation: string | null;
	email: string | null;
	phone: string | null;
	mobile_number: string | null;
	isDelete: number | string | null;
}

interface VendorRow extends RowDataPacket {
	id: number | string;
	vendor_id: string | null;
	vendor_name: string;
	vendor_type: string | null;
	industry_category: string | null;
	status: string | null;
	contact_person: string | null;
	contact_designation: string | null;
	phone: string | null;
	email: string | null;
	address_street: string | null;
	address_city: string | null;
	address_state: string | null;
	address_country: string | null;
	address_pin: string | null;
	website: string | null;
	bank_name: string | null;
	bank_account_no: string | null;
	ifsc_swift_code: string | null;
	currency_preference: string | null;
	payment_terms: string | null;
	credit_limit: string | number | null;
	isDelete: number | string | null;
}

const COMPANY_COLUMNS = `id, company_id, company_name, industry, sector, website,
  description, contact_person, designation, email, phone, mobile_number, isDelete`;

const VENDOR_COLUMNS = `id, vendor_id, vendor_name, vendor_type, industry_category,
  status, contact_person, contact_designation, phone, email, address_street,
  address_city, address_state, address_country, address_pin, website, bank_name,
  bank_account_no, ifsc_swift_code, currency_preference, payment_terms,
  credit_limit, isDelete`;

/**
 * Seed the Company creator and its authored draft. The caller owns the
 * fixture and must call `dispose()` in a `finally` block.
 */
export async function seedCompanyCreator(
	db: Connection,
	namespace: string
): Promise<CompanyCreatorFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-company`,
		COMPANY_CREATOR_PERMISSIONS
	);
	const draft = buildCompanyDraft(namespace);
	return {
		userId: identity.userId,
		username: identity.username,
		password: identity.password,
		draft,
		async dispose(): Promise<void> {
			try {
				await deleteRowsNamed(
					db,
					'companies',
					'company_name',
					draft.companyName
				);
			} finally {
				await identity.dispose();
			}
		},
	};
}

/**
 * Seed the Vendor creator and its authored draft. The caller owns the fixture
 * and must call `dispose()` in a `finally` block.
 */
export async function seedVendorCreator(
	db: Connection,
	namespace: string
): Promise<VendorCreatorFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-vendor`,
		VENDOR_CREATOR_PERMISSIONS
	);
	const draft = buildVendorDraft(namespace);
	return {
		userId: identity.userId,
		username: identity.username,
		password: identity.password,
		draft,
		async dispose(): Promise<void> {
			try {
				await deleteRowsNamed(db, 'vendors', 'vendor_name', draft.vendorName);
			} finally {
				await identity.dispose();
			}
		},
	};
}

/** Values a person authors in the Company form. */
function buildCompanyDraft(namespace: string): CompanyDraft {
	const slug = identifierSlug(namespace);
	return {
		companyName: `${namespace} Company`,
		industry: 'Technology',
		sector: `${namespace} Sector`,
		website: `${slug}.company.invalid`,
		description: `${namespace} company captured through the browser`,
		contactPerson: 'Meera Company',
		designation: 'Procurement Lead',
		email: `${slug}-company@e2e.invalid`,
		phone: '+91 98765 40011',
		mobileNumber: '+91 98765 40012',
	};
}

/** Values a person authors across the Vendor Basic, Contact and Financial tabs. */
function buildVendorDraft(namespace: string): VendorDraft {
	const slug = identifierSlug(namespace);
	return {
		vendorName: `${namespace} Vendor`,
		vendorType: 'Supplier',
		industryCategory: 'Piping',
		status: 'Active',
		contactPerson: 'Karan Vendor',
		contactDesignation: 'Accounts Manager',
		phone: '+91 98765 40013',
		email: `${slug}-vendor@e2e.invalid`,
		addressStreet: `${namespace} Industrial Estate`,
		addressCity: 'Pune',
		addressState: 'Maharashtra',
		addressCountry: 'India',
		addressPin: '411001',
		website: `https://${slug}.vendor.invalid`,
		bankName: 'Bank of E2E',
		bankAccountNo: '000123456789',
		ifscSwiftCode: 'SBIN0001234',
		currencyPreference: 'USD',
		paymentTerms: '30 days credit',
		creditLimit: '1000',
	};
}

/**
 * Read the owned Company row through an independent connection. Returns
 * `null` while the starting state is still empty.
 */
export async function readCompanyByName(
	db: Connection,
	companyName: string
): Promise<StoredCompany | null> {
	const [rows] = await db.execute<CompanyRow[]>(
		`SELECT ${COMPANY_COLUMNS} FROM companies WHERE company_name = ? LIMIT 1`,
		[companyName]
	);
	return rows[0] ? mapCompany(rows[0]) : null;
}

/** Read the saved Company row by its owned primary key. */
export async function readCompanyById(
	db: Connection,
	id: number
): Promise<StoredCompany | null> {
	const [rows] = await db.execute<CompanyRow[]>(
		`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ? LIMIT 1`,
		[id]
	);
	return rows[0] ? mapCompany(rows[0]) : null;
}

/**
 * Read the owned Vendor row through an independent connection. Returns
 * `null` while the starting state is still empty.
 */
export async function readVendorByName(
	db: Connection,
	vendorName: string
): Promise<StoredVendor | null> {
	const [rows] = await db.execute<VendorRow[]>(
		`SELECT ${VENDOR_COLUMNS} FROM vendors WHERE vendor_name = ? LIMIT 1`,
		[vendorName]
	);
	return rows[0] ? mapVendor(rows[0]) : null;
}

/** Read the saved Vendor row by its owned primary key. */
export async function readVendorById(
	db: Connection,
	id: number
): Promise<StoredVendor | null> {
	const [rows] = await db.execute<VendorRow[]>(
		`SELECT ${VENDOR_COLUMNS} FROM vendors WHERE id = ? LIMIT 1`,
		[id]
	);
	return rows[0] ? mapVendor(rows[0]) : null;
}

/**
 * Resolve the single row carrying this run's exact namespaced name, then
 * delete that row by primary key. The name belongs to one worker and test, so
 * a partially failed attempt never leaves data for its retry.
 */
async function deleteRowsNamed(
	db: Connection,
	table: 'companies' | 'vendors',
	nameColumn: 'company_name' | 'vendor_name',
	name: string
): Promise<void> {
	const [rows] = await db.execute<IdRow[]>(
		`SELECT id FROM ${table} WHERE ${nameColumn} = ?`,
		[name]
	);
	for (const row of rows) {
		await db.execute(`DELETE FROM ${table} WHERE id = ?`, [Number(row.id)]);
	}
}

function mapCompany(row: CompanyRow): StoredCompany {
	return {
		id: Number(row.id),
		companyId: textOrNull(row.company_id),
		companyName: row.company_name,
		industry: textOrNull(row.industry),
		sector: textOrNull(row.sector),
		website: textOrNull(row.website),
		description: textOrNull(row.description),
		contactPerson: textOrNull(row.contact_person),
		designation: textOrNull(row.designation),
		email: textOrNull(row.email),
		phone: textOrNull(row.phone),
		mobileNumber: textOrNull(row.mobile_number),
		isDelete: Number(row.isDelete ?? 0),
	};
}

function mapVendor(row: VendorRow): StoredVendor {
	return {
		id: Number(row.id),
		vendorId: textOrNull(row.vendor_id),
		vendorName: row.vendor_name,
		vendorType: textOrNull(row.vendor_type),
		industryCategory: textOrNull(row.industry_category),
		status: textOrNull(row.status),
		contactPerson: textOrNull(row.contact_person),
		contactDesignation: textOrNull(row.contact_designation),
		phone: textOrNull(row.phone),
		email: textOrNull(row.email),
		addressStreet: textOrNull(row.address_street),
		addressCity: textOrNull(row.address_city),
		addressState: textOrNull(row.address_state),
		addressCountry: textOrNull(row.address_country),
		addressPin: textOrNull(row.address_pin),
		website: textOrNull(row.website),
		bankName: textOrNull(row.bank_name),
		bankAccountNo: textOrNull(row.bank_account_no),
		ifscSwiftCode: textOrNull(row.ifsc_swift_code),
		currencyPreference: textOrNull(row.currency_preference),
		paymentTerms: textOrNull(row.payment_terms),
		creditLimit: textOrNull(row.credit_limit),
		isDelete: Number(row.isDelete ?? 0),
	};
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function identifierSlug(namespace: string): string {
	return namespace.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
