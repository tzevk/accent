import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function ProposalsLayout({ children }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('auth')?.value
  if (!auth) redirect('/signin?from=/proposals')
  return children
}
