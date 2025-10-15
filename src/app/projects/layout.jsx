import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function ProjectsLayout({ children }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('auth')?.value
  if (!auth) redirect('/signin?from=/projects')
  return children
}
