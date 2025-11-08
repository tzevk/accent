import { redirect } from 'next/navigation'
import { requireServerAuth } from '@/utils/server-auth'

export const dynamic = 'force-dynamic'

export default async function MastersLayout({ children }) {
  // Use proper JWT authentication with user permissions loading
  const auth = await requireServerAuth('/masters')
  
  if (!auth.authenticated) {
    redirect(auth.redirectTo)
  }
  
  return children
}
