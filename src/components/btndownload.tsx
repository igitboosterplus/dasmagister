import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

export default function InstallButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    console.log('InstallButton monté')

    const handler = (event: Event) => {
      console.log('beforeinstallprompt détecté')

      event.preventDefault()

      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const installApp = async () => {
    if (!installPrompt) {
      console.log('Aucun prompt d’installation disponible')
      return
    }

    await installPrompt.prompt()

    const result = await installPrompt.userChoice

    console.log('Résultat installation:', result.outcome)

    setInstallPrompt(null)
  }

  if (!installPrompt) {
    return null
  }

  return (
    <button
      onClick={installApp}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      Installer l'application
    </button>
  )
}