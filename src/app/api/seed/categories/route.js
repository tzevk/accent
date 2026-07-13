import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

const CATEGORIES = [
	'Cash in Hand',
	'Petty Cash',
	'Office Expenses',
	'Stationery & Printing Expenses',
	'Printing & Photocopy Expenses',
	'Tea & Refreshment Expenses',
	'Pantry Expenses',
	'Housekeeping Expenses',
	'Courier & Postage Expenses',
	'Telephone Expenses',
	'Mobile Expenses',
	'Internet Expenses',
	'Electricity Expenses',
	'Water Expenses',
	'Office Rent',
	'Office Maintenance Expenses',
	'Repairs & Maintenance Expenses',
	'Staff Welfare Expenses',
	'Employee Reimbursement',
	'Salary Advance',
	'Conveyance Expenses',
	'Travelling Expenses',
	'Fuel Expenses',
	'Vehicle Maintenance Expenses',
	'Parking & Toll Charges',
	'Site Expenses',
	'Material Purchase',
	'Consumables Purchase',
	'Labour Charges',
	'Contract Labour Charges',
	'Loading & Unloading Charges',
	'Freight & Transportation Charges',
	'Equipment Hire Charges',
	'Professional Fees',
	'Consultancy Charges',
	'Legal & Professional Charges',
	'Bank Charges',
	'Software & Subscription Expenses',
	'Advertisement & Marketing Expenses',
	'Business Promotion Expenses',
	'Miscellaneous Expenses',
	'Vendor Advance',
	'Employee Advance',
	'Customer Advance Received',
	'Customer Receipt',
	'Security Deposit Paid',
	'Security Deposit Received',
	'Loan Received',
	'Loan Repayment',
	'Interest Received',
	'Interest Paid',
	'Miscellaneous Income',
	'Cash Deposited into Bank',
	'Cash Withdrawn from Bank',
	'GST Payment',
	'GST Refund Received',
	'TDS Payment',
	'Fixed Asset Purchase',
	'Accounts Receivable',
	'Accounts Payable',
];

export async function POST() {
	try {
		const user = await getCurrentUser();
		if (!user || !user.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 403 }
			);
		}

		const db = await dbConnect();
		try {
			let inserted = 0;
			let skipped = 0;

			for (const name of CATEGORIES) {
				try {
					await db.execute(
						'INSERT INTO category_master (category_name, is_active) VALUES (?, TRUE)',
						[name]
					);
					inserted++;
				} catch (e) {
					if (e.errno === 1062) {
						skipped++;
					} else {
						throw e;
					}
				}
			}

			return NextResponse.json({
				success: true,
				inserted,
				skipped,
				total: CATEGORIES.length,
			});
		} finally {
			db.release();
		}
	} catch (error) {
		console.error('Error seeding categories:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
}
