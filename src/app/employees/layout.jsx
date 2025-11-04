import { redirect } from 'next/navigation'
import { requireServerAuth } from '@/utils/server-auth'

export default async function EmployeesLayout({ children }) {
  // Use proper JWT authentication with user permissions loading
  const auth = await requireServerAuth('/employees')
  
  if (!auth.authenticated) {
    redirect(auth.redirectTo)
  }
  
  return children
}
