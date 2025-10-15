import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function CompanyLayout({ children }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('auth')?.value
  if (!auth) redirect('/signin?from=/company')
  return children
}
