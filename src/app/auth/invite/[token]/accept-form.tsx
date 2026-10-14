'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptAsSignedIn, acceptInvitation } from './actions'

export function AcceptForm({
  token,
  email,
  defaultName,
  loginHref,
}: {
  token: string
  email: string
  defaultName: string
  loginHref: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    if (formData.get('password') !== formData.get('confirm_password')) {
      setError("The two passwords don't match")
      return
    }
    startTransition(async () => {
      const result = await acceptInvitation(token, formData)
      if (result?.error) {
        setError(result.error)
        setAccountExists(result.accountExists === true)
      }
    })
  }

  if (accountExists) {
    return (
      <div className="space-y-4">
        <p className="text-base text-feis-charcoal leading-relaxed">
          {email} already has a FeisTab account. Sign in with it and you&apos;ll be added to this
          event.
        </p>
        <Link href={loginHref} className={buttonVariants({ className: 'w-full h-12 text-base' })}>
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Your email</p>
        <p className="text-base font-medium text-feis-charcoal break-all">{email}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="full_name" className="text-base font-medium text-feis-charcoal">
          Your name
        </Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          defaultValue={defaultName}
          required
          disabled={isPending}
          className="h-12 text-base"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-base font-medium text-feis-charcoal">
          Choose a password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isPending}
          className="h-12 text-base"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          At least 8 characters. You&apos;ll use it to sign in on the day.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password" className="text-base font-medium text-feis-charcoal">
          Type it again
        </Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isPending}
          className="h-12 text-base"
        />
      </div>

      {error && (
        <p role="alert" className="text-base text-destructive rounded-md bg-destructive/5 px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full h-14 text-lg">
        {isPending ? 'Setting up your account…' : 'Accept invitation'}
      </Button>

      <p className="text-center text-base text-muted-foreground">
        Already have a FeisTab account?{' '}
        <Link href={loginHref} className="text-feis-green font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}

export function AcceptSignedIn({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAccept() {
    setError(null)
    startTransition(async () => {
      const result = await acceptAsSignedIn(token)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">Signed in as {email}.</p>
      {error && (
        <p role="alert" className="text-base text-destructive rounded-md bg-destructive/5 px-3 py-2">
          {error}
        </p>
      )}
      <Button onClick={handleAccept} disabled={isPending} className="w-full h-14 text-lg">
        {isPending ? 'Adding you to the event…' : 'Accept invitation'}
      </Button>
    </div>
  )
}
