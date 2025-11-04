import { redirect } from 'next/navigation'
import { requireServerAuth } from '@/utils/server-auth'

export default async function ProjectsLayout({ children }) {
  // Use proper JWT authentication with user permissions loading
  const auth = await requireServerAuth('/projects')
  
  if (!auth.authenticated) {
    redirect(auth.redirectTo)
  }
  
  return children
}
