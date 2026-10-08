'use client'

import Link from 'next/link'
import { Zap } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">NotifyMVP</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Create account</CardTitle>
            <CardDescription>
              Admin can use email and password on the sign-in page (configured in server env).
            </CardDescription>
          </CardHeader>
        </Card>

        <p className="text-center text-sm text-[var(--muted-foreground)]">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
