import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

export function usePWAInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
        (window as any).deferredPrompt || null
    );

    const [isInstallable, setIsInstallable] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // Check if standalone
    const checkIsStandalone = useCallback(() => {
        return (
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as any).standalone === true ||
            document.referrer.includes('android-app://')
        );
    }, []);

    useEffect(() => {
        // 1. Check if already installed
        if (checkIsStandalone()) {
            setIsInstalled(true);
        }

        // 2. Check localStorage for dismissal
        const dismissedUntil = localStorage.getItem('pwa_install_prompt_dismissed');
        if (dismissedUntil) {
            if (new Date().getTime() < parseInt(dismissedUntil, 10)) {
                setDismissed(true);
            } else {
                localStorage.removeItem('pwa_install_prompt_dismissed');
            }
        }

        // Capture previous deferred event if existed
        if ((window as any).deferredPrompt) {
            setIsInstallable(true);
        }

        // Listen to beforeinstallprompt
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            const promptEvent = e as BeforeInstallPromptEvent;
            (window as any).deferredPrompt = promptEvent;
            setDeferredPrompt(promptEvent);
            setIsInstallable(true);
        };

        // Listen to appinstalled
        const handleAppInstalled = () => {
            setIsInstalled(true);
            setIsInstallable(false);
            setDeferredPrompt(null);
            (window as any).deferredPrompt = null;
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [checkIsStandalone]);

    const install = async () => {
        if (!deferredPrompt) {
            return false;
        }
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setIsInstallable(false);
            setDeferredPrompt(null);
            (window as any).deferredPrompt = null;
            return true;
        }
        return false;
    };

    const dismiss = () => {
        setDismissed(true);
        // Dismiss for 7 days
        const dismissTime = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
        localStorage.setItem('pwa_install_prompt_dismissed', dismissTime.toString());
    };

    // The popup can be shown if it's not installed, it is installable (or iOS fallback), and not dismissed
    // For iOS, beforeinstallprompt never fires, so isInstallable stays false.
    // We can add iOS specific logic here if needed, but the prompt says 
    // "Dans ce cas : NE PAS afficher une popup avec un bouton "Installer" qui ne fonctionne pas."
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const showPopup = !isInstalled && (isInstallable || isIOS) && !dismissed;

    return {
        isInstallable,
        isInstalled,
        isIOS,
        showPopup,
        install,
        dismiss,
    };
}
