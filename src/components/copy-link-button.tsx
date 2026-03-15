'use client'

import { useState } from 'react'

export function CopyLinkButton({ url, className }: { url?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const textToCopy = url || window.location.href
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = textToCopy
      document.body.appendChild(input)
      input.select()
      const success = document.execCommand('copy')
      document.body.removeChild(input)
      if (success) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={className ?? 'text-xs font-mono uppercase tracking-wider transition-colors px-3 py-1.5 rounded border border-gray-200 text-muted-foreground hover:text-foreground hover:border-gray-400'}
    >
      {copied ? 'Copied!' : 'Copy Link'}
    </button>
  )
}
