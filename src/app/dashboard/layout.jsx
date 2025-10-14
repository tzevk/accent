import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function DashboardLayout({ children }) {
  const auth = cookies().get('auth')?.value
  if (!auth) {
    redirect('/signin?from=/dashboard')
  }
  return children
}
