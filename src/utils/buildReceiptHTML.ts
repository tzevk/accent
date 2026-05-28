import { numberToWords } from './numberToWords';

// Trigger rebuild 1
// Trigger rebuild 2

export interface ReceiptData {
	receipt_no: string;
	receipt_date: string;

	company_name: string;

	amount: number; // raw number
	amount_words?: string; // formatted words

	transaction_id?: string;
	payment_date?: string;
	bank_name: string;
	remark: string;

	invoice_no?: string;
	invoice_date?: string;
}

const formatAmount = (amount: number): string => {
	return amount.toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
};

export const buildReceiptHTML = (data: ReceiptData): string => {
	const amountWords = data.amount_words || numberToWords(data.amount);

	return `
<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Receipt</title>
	<style>
		${getCSS()}
	</style>
</head>

<body>
	<div class="receipt">
		<div class="header">
			<div class="ref-no">Ref. No.: ${data.receipt_no}</div>
			<div class="date">${data.receipt_date}</div>
		</div>

		<div class="title">RECEIPT</div>

		<div class="text">
			We gratefully acknowledge the receipt of the sum of 
			<span>Rupees ${amountWords} Only</span> from 
			<span>${data.company_name}</span>. 
			This payment is applied toward Invoice No. 
			<span>${data.invoice_no ?? '-'}</span> (Dated <span>${data.invoice_date ?? '-'}</span>). 
			The transaction was successfully processed on <span>${data.payment_date ?? '-'}</span> 
			under Transaction ID <span>${data.transaction_id ?? '-'}</span>.
		</div>

		<div class="amount">
			<span>₹ ${formatAmount(data.amount)}</span>
		</div>

		<div class="for">For Accent Techno Solutions Pvt. Ltd.</div>

		<div class="footer">
			<p class="name">Santosh Dinkar Mestry</p>
			<p class="designation">Director</p>
		</div>
	</div>
</body>
</html>
`;
};

const getCSS = (): string => {
	return `			* {
				margin: 0;
				padding: 0;
				box-sizing: border-box;
			}

			body {
				font-family: Arial, Helvetica, sans-serif;
			}

			.receipt {
				width: 100%;
				padding: 40px;
			}

			.header {
				display: flex;
				justify-content: space-between;
				align-items: center;
			}

			.title {
				text-align: center;
				text-decoration: underline;
				font-size: 20px;
				font-weight: bold;
				margin: 30px 0;
			}

			.text {
				text-align: justify;
			}

			.text span {
				font-weight: bold;
			}

			.amount {
				display: flex;
				align-items: center;
				justify-content: start;
				font-size: 30px;
				margin: 75px 0;
			}

			.amount > span {
				border: 3px solid black;
				padding: 5px;
			}

			.for {
				margin-bottom: 75px;
				font-weight: bold;
			}

			@media print {
				body {
					margin: 0;
				}

				.receipt {
					padding: 60mm 20mm 20mm 20mm; /* use mm for print accuracy */
					width: 100%;
				}

				/* Prevent content from breaking across pages */
				.header,
				.title,
				.text,
				.amount,
				.for,
				.footer {
					page-break-inside: avoid;
				}
			}`;
};
