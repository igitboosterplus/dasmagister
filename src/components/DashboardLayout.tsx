import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import AppSidebar from './AppSidebar';
import { Loader2, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (profile && profile.account_status) {
    if (profile.account_status === 'pending') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold font-display">Inscription en attente</h1>
            <p className="text-muted-foreground">
              Votre compte est en cours de validation par votre responsable. Vous recevrez une notification d&apos;ici peu.
            </p>
          </div>
        </div>
      );
    }
    if (profile.account_status === 'rejected' || profile.account_status === 'suspended' || !profile.is_active) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold font-display text-destructive">Accès restreint</h1>
            <p className="text-muted-foreground">
              Votre compte est inactif ou suspendu. Veuillez contacter un administrateur.
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-bold text-lg">DasMAGISTER</h2>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <button className="p-2 -mr-2 rounded-md hover:bg-muted text-muted-foreground focus:outline-none">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle menu</span>
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 border-none w-64">
              <AppSidebar />
            </SheetContent>
          </Sheet>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
