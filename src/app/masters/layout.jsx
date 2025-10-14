import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function MastersLayout({ children }) {
  const auth = cookies().get('auth')?.value
  if (!auth) redirect('/signin?from=/masters')
  return children
}
