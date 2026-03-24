'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { signup } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await signup(formData)
      if (result?.error) {
        setError(result.error)
      } else if (result?.success) {
        setSuccess(result.success)
      }
    })
  }

  return (
    <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-feis-charcoal">FeisTab</h1>
          <p className="text-sm text-muted-foreground mt-1">Create your account</p>
        </div>

        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-feis-charcoal">Sign up</CardTitle>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4">
                <div className="rounded-md bg-feis-green-light px-4 py-3 text-sm text-feis-green font-medium">
                  {success}
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Once confirmed, you can{' '}
                  <Link
                    href="/auth/login"
                    className="text-feis-green font-medium hover:underline transition-colors"
                  >
                    sign in
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="full_name" className="font-medium text-sm text-feis-charcoal">
                    Full name
                  </Label>
                  <Input
                    id="full_name"
                    name="full_name"
                    type="text"
                    autoComplete="name"
                    required
                    autoFocus
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="font-medium text-sm text-feis-charcoal">
                    Email
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="font-medium text-sm text-feis-charcoal">
                    Password
                  </Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    disabled={isPending}
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive rounded-md bg-destructive/5 px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={isPending} className="w-full">
                  {isPending ? 'Creating account…' : 'Create account'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/auth/login"
            className="text-feis-green font-medium hover:underline transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
