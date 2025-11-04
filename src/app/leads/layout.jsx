import { redirect } from 'next/navigation'
import { requireServerAuth } from '@/utils/server-auth'

export default async function LeadsLayout({ children }) {
  // Use proper JWT authentication with user permissions loading
  const auth = await requireServerAuth('/leads')
  
  if (!auth.authenticated) {
    redirect(auth.redirectTo)
  }
  
  return children
}
