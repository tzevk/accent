import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function CompanyLayout({ children }) {
  const auth = cookies().get('auth')?.value
  if (!auth) redirect('/signin?from=/company')
  return children
}
