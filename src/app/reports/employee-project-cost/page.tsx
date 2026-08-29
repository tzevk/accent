import { redirect } from 'next/navigation';

export default function LegacyRedirect() {
	redirect('/reports/employee-project-monthly-cost');
}
