import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'

export default async function LandingPage() {
  const user = await getCurrentUser()
  if (user) redirect('/groups')

  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-3xl font-semibold">OpenSplit</h1>
      <p className="text-muted-foreground">
        Split shared expenses with the people you actually share them with.
      </p>
      <Button asChild>
        <a href="/auth/login">Log in</a>
      </Button>
    </main>
  )
}
