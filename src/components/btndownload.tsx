import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface Window {
    deferredPrompt: BeforeInstallPromptEvent | null
  }
}

export default function InstallButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(window.deferredPrompt || null)

  useEffect(() => {
    console.log('InstallButton monté')

    // Capture si l'événement a déjà eu lieu et été stocké sur window
    if (window.deferredPrompt) {
      setInstallPrompt(window.deferredPrompt)
    }

    const handler = (event: Event) => {
      console.log('beforeinstallprompt détecté')
      event.preventDefault()
      const promptEvent = event as BeforeInstallPromptEvent
      window.deferredPrompt = promptEvent
      setInstallPrompt(promptEvent)
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

    window.deferredPrompt = null;
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