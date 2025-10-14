import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function ServerAuthGuard({ children, from = '/' }) {
  const auth = cookies().get('auth')?.value
  if (!auth) {
    redirect(`/signin?from=${encodeURIComponent(from)}`)
  }
  return children
}
