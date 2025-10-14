import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function ProposalsLayout({ children }) {
  const auth = cookies().get('auth')?.value
  if (!auth) redirect('/signin?from=/proposals')
  return children
}
