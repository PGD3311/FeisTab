import { redirect } from 'next/navigation'

export default function Home() {
  // No auth for prototype — go straight to dashboard
  redirect('/dashboard')
}
