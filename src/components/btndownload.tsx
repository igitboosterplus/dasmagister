import { useEffect, useState } from 'react'

export default function InstallButton() {
  const [prompt, setPrompt] = useState<any>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setPrompt(event)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const installApp = async () => {
    if (!prompt) return

    prompt.prompt()

    const result = await prompt.userChoice

    if (result.outcome === 'accepted') {
      console.log('Application installée')
    }

    setPrompt(null)
  }

  if (!prompt) return null

  return (
    <button onClick={installApp}>
      Installer l'application
    </button>
  )
}