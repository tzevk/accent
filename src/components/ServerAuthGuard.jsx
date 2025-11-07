import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Server-side auth guard — check for the JWT cookie `auth_token` (set on login)
export default async function ServerAuthGuard({ children, from = '/' }) {
  const cookieStore = await cookies()
  const authToken = cookieStore.get('auth_token')?.value
  if (!authToken) {
    // Redirect to signin if token missing
    redirect(`/signin?from=${encodeURIComponent(from)}`)
  }
  return children
}
