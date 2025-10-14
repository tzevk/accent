import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function ProjectsLayout({ children }) {
  const auth = cookies().get('auth')?.value
  if (!auth) redirect('/signin?from=/projects')
  return children
}
