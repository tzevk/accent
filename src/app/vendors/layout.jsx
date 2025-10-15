import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function VendorsLayout({ children }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('auth')?.value
  if (!auth) redirect('/signin?from=/vendors')
  return children
}
