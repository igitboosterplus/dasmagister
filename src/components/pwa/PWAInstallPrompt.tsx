import { usePWAInstall } from '@/hooks/usePWAInstall';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share, PlusSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function PWAInstallPrompt() {
    const { isInstallable, isInstalled, isIOS, showPopup, install, dismiss } = usePWAInstall();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        // Petit délai avant d'afficher la popup s'il vient d'ouvrir l'app
        if (showPopup) {
            const timer = setTimeout(() => setOpen(true), 1500);
            return () => clearTimeout(timer);
        } else {
            setOpen(false);
        }
    }, [showPopup]);

    const handleInstall = async () => {
        await install();
        setOpen(false);
    };

    const handleDismiss = () => {
        dismiss();
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) handleDismiss();
        }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
                        <Download className="h-7 w-7 text-primary" />
                    </div>
                    <DialogTitle className="text-center text-xl">Installer l'application</DialogTitle>
                    <DialogDescription className="text-center">
                        Installez l'application sur votre appareil pour y accéder plus rapidement,
                        profiter du mode plein écran et des fonctionnalités hors-ligne.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-4">
                    {!isInstallable && isIOS ? (
                        <div className="bg-muted p-4 rounded-md text-sm text-center">
                            Pour installer l'application sur iOS :
                            <br />
                            1. Appuyez sur le bouton Partager <Share className="inline h-4 w-4 mx-1" />
                            <br />
                            2. Sélectionnez <strong>Sur l'écran d'accueil</strong> <PlusSquare className="inline h-4 w-4 mx-1" />
                        </div>
                    ) : (
                        <Button onClick={handleInstall} className="w-full">
                            Installer
                        </Button>
                    )}
                </div>

                <DialogFooter className="sm:justify-center">
                    <Button variant="ghost" className="w-full sm:w-auto" onClick={handleDismiss}>
                        Plus tard
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
