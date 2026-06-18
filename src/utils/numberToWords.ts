export function numberToWords(num: number): string {
	if (num === 0) return 'Zero';

	const a = [
		'',
		'One ',
		'Two ',
		'Three ',
		'Four ',
		'Five ',
		'Six ',
		'Seven ',
		'Eight ',
		'Nine ',
		'Ten ',
		'Eleven ',
		'Twelve ',
		'Thirteen ',
		'Fourteen ',
		'Fifteen ',
		'Sixteen ',
		'Seventeen ',
		'Eighteen ',
		'Nineteen ',
	];
	const b = [
		'',
		'',
		'Twenty',
		'Thirty',
		'Forty',
		'Fifty',
		'Sixty',
		'Seventy',
		'Eighty',
		'Ninety',
	];

	const convertChunk = (n: number) => {
		let str = '';
		if (n > 99) {
			str += a[Math.floor(n / 100)] + 'Hundred ';
			n = n % 100;
		}
		if (n > 19) {
			str += b[Math.floor(n / 10)] + ' ';
			n = n % 10;
		}
		if (n > 0) {
			str += a[n];
		}
		return str;
	};

	let res = '';
	const crores = Math.floor(num / 10000000);
	num %= 10000000;
	const lakhs = Math.floor(num / 100000);
	num %= 100000;
	const thousands = Math.floor(num / 1000);
	num %= 1000;
	const hundreds = num;

	if (crores > 0) res += convertChunk(crores) + 'Crore ';
	if (lakhs > 0) res += convertChunk(lakhs) + 'Lakh ';
	if (thousands > 0) res += convertChunk(thousands) + 'Thousand ';
	if (hundreds > 0) res += convertChunk(hundreds);

	return res.trim();
}
