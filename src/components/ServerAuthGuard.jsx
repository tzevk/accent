import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Server-side auth guard — ensure we have the session cookies set by login
export default async function ServerAuthGuard({ children, from = '/' }) {
  const cookieStore = await cookies()
  const hasSession = cookieStore.get('auth')?.value && cookieStore.get('user_id')?.value

  if (!hasSession) {
    redirect(`/signin?from=${encodeURIComponent(from)}`)
  }

  return children
}
