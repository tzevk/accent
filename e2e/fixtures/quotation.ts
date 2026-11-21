/**
 * Disposable base company for the standalone outgoing-quotation browser
 * journey.
 *
 * The create form has no free-text client name: it fills `client_name`,
 * `client_address`, GST/PAN and Kind Attn when an existing company is chosen
 * from its searchable picker. The journey therefore seeds one owned company
 * and selects it through the real picker.
 *
 * The authored money is deliberately independent of the form's calculator:
 * qty 3 at rate 12500 is gross 37500, GST at 18% is 6750, and net is 44250.
 * A broken save or reopen cannot make those stored/rendered values agree.
 *
 * The quotation number is namespaced because the create route upserts when the
 * client supplies a number; using the generated sequence could silently update
 * another worker's row. The active-number unique index still has to accept
 * this new row.
 *
 * Every row is tracked by primary key. Cleanup removes only this fixture's
 * quotation (by its captured id, or by the unique number owned by the journey
 * user when the test failed before the response id was read) and then the
 * company.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

export const QUOTATION_QTY = '3';
export const QUOTATION_RATE = '12500';
export const QUOTATION_AMOUNT = '37500.00';
export const QUOTATION_GST_PERCENTAGE = 18;
export const QUOTATION_GROSS = 37500;
export const QUOTATION_GST = 6750;
export const QUOTATION_NET = 44250;
export const QUOTATION_SCOPE_LINE =
	'E2E quotation scope line: supply, install and commission one control panel';

const COMPANY_ADDRESS_LINE = 'Plot 7, E2E Quotation Estate';
const COMPANY_CITY = 'Pune';
const COMPANY_STATE = 'Maharashtra';
const COMPANY_COUNTRY = 'India';
const COMPANY_POSTAL_CODE = '411001';
const COMPANY_GSTIN = '27ABCDE1234F1Z5';
const COMPANY_PAN = 'ABCDE1234F';
const COMPANY_CONTACT = 'E2E Quotation Contact';

export interface QuotationFixture {
	companyId: number;
	companyName: string;
	/** Exactly the address the edit form derives from the company fields. */
	clientAddress: string;
	contactPerson: string;
	quotationNumber: string;
	scopeLine: string;
	qty: string;
	rate: string;
	amount: string;
	gstPercentage: number;
	grossAmount: number;
	gstAmount: number;
	netAmount: number;
}

export interface StoredQuotationRow extends RowDataPacket {
	id: number;
	quotation_number: string;
	client_name: string;
	client_address: string | null;
	scope_items: unknown;
	gross_amount: string | number;
	gst_percentage: string | number;
	gst_amount: string | number;
	net_amount: string | number;
	total: string | number;
	created_by: number | null;
	isDelete: number;
}

interface QuotationIdRow extends RowDataPacket {
	id: number;
}

/** Insert one owned company the quotation form can select. */
export async function seedQuotationFixture(
	connection: Connection,
	namespace: string
): Promise<QuotationFixture> {
	const companyCode = fitIdentifier(`${namespace}-CO`, 50);
	const companyName = `${namespace} Client`;
	const clientAddress = [
		COMPANY_ADDRESS_LINE,
		COMPANY_CITY,
		COMPANY_STATE,
		COMPANY_COUNTRY,
		COMPANY_POSTAL_CODE,
	].join('\n');

	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO companies (
        company_id, company_name, address, city, state, country, postal_code,
        gstin, pan_number, contact_person
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			companyCode,
			companyName,
			COMPANY_ADDRESS_LINE,
			COMPANY_CITY,
			COMPANY_STATE,
			COMPANY_COUNTRY,
			COMPANY_POSTAL_CODE,
			COMPANY_GSTIN,
			COMPANY_PAN,
			COMPANY_CONTACT,
		]
	);

	return {
		companyId: Number(result.insertId),
		companyName,
		clientAddress,
		contactPerson: COMPANY_CONTACT,
		quotationNumber: fitIdentifier(`${namespace}-Q`, 100),
		scopeLine: QUOTATION_SCOPE_LINE,
		qty: QUOTATION_QTY,
		rate: QUOTATION_RATE,
		amount: QUOTATION_AMOUNT,
		gstPercentage: QUOTATION_GST_PERCENTAGE,
		grossAmount: QUOTATION_GROSS,
		gstAmount: QUOTATION_GST,
		netAmount: QUOTATION_NET,
	};
}

/**
 * Remove the quotation this journey created, then its company. The fallback
 * lookup still filters by the unique quotation number and owning user, so it
 * can never delete another test's row.
 */
export async function cleanupQuotationFixture(
	connection: Connection,
	fixture: QuotationFixture,
	ownerUserId: number,
	quotationId: number | null
): Promise<void> {
	let removed = 0;
	if (quotationId !== null) {
		const [result] = await connection.execute<ResultSetHeader>(
			'DELETE FROM quotations WHERE id = ? AND created_by = ?',
			[quotationId, ownerUserId]
		);
		removed = result.affectedRows;
	}

	if (removed === 0) {
		const [rows] = await connection.execute<QuotationIdRow[]>(
			`SELECT id FROM quotations
        WHERE quotation_number = ? AND created_by = ?`,
			[fixture.quotationNumber, ownerUserId]
		);
		for (const row of rows) {
			await connection.execute(
				'DELETE FROM quotations WHERE id = ? AND created_by = ?',
				[row.id, ownerUserId]
			);
		}
	}

	await connection.execute('DELETE FROM companies WHERE id = ?', [
		fixture.companyId,
	]);
}
