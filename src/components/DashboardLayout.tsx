import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import AppSidebar from './AppSidebar';
import NotificationBell from './NotificationBell';
import {
  Loader2,
  Menu,
  Calendar,
  ShieldCheck,
  User,
  LogOut,
  AlertCircle,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import guimsLogo from '@/assets/guims-logo.png';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, role, loading, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Écoute en temps réel de l'activation du compte + polling de sécurité
  useEffect(() => {
    if (profile?.id && profile?.account_status === 'pending') {
      const channel = supabase
        .channel(`emp-status-${profile.id}-${Math.random().toString(36).substring(2, 9)}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'employees',
            filter: `id=eq.${profile.id}`,
          },
          (payload) => {
            const updated = payload.new as any;
            if (updated?.account_status === 'active' || updated?.is_active) {
              refreshProfile();
            }
          }
        )
        .subscribe();

      const interval = setInterval(() => {
        refreshProfile();
      }, 4000);

      return () => {
        supabase.removeChannel(channel);
        clearInterval(interval);
      };
    }
  }, [profile?.id, profile?.account_status, refreshProfile]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center space-y-4 animate-fade-in text-center">
          <div className="relative flex items-center justify-center">
            <div className="absolute h-16 w-16 rounded-full bg-primary/20 animate-ping" />
            <img
              src={guimsLogo}
              alt="DasMAGISTER"
              className="h-12 w-12 relative z-10 drop-shadow"
            />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-foreground">
              DasMAGISTER
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              Chargement de votre espace sécurisé...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (profile && profile.account_status) {
    if (profile.account_status === 'pending') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full rounded-2xl border bg-card p-8 text-center shadow-lg space-y-5 animate-fade-in">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/15 text-warning">
              <Clock className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display text-foreground">
                Inscription en attente
              </h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Votre compte a bien été enregistré. Il est actuellement en cours de validation par votre responsable. Vous pourrez accéder à l'application dès son approbation.
              </p>
            </div>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={async () => {
                  setCheckingStatus(true);
                  await refreshProfile();
                  setCheckingStatus(false);
                }}
                disabled={checkingStatus}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${checkingStatus ? 'animate-spin' : ''}`} />
                <span>{checkingStatus ? 'Vérification...' : 'Vérifier mon statut'}</span>
              </button>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (profile.account_status === 'rejected' || profile.account_status === 'suspended' || !profile.is_active) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full rounded-2xl border bg-card p-8 text-center shadow-lg space-y-5 animate-fade-in">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
              <AlertCircle className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display text-destructive">
                Accès restreint
              </h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Votre compte est actuellement inactif ou suspendu par l'administration. Veuillez contacter votre service des ressources humaines pour débloquer votre accès.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={signOut}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  const todayFormatted = format(new Date(), 'EEEE d MMMM yyyy', { locale: fr });
  const capitalizedDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

  const getRoleLabel = (r: string | null) => {
    switch (r) {
      case 'admin':
        return 'Administrateur';
      case 'manager':
        return 'Manager';
      case 'employee':
        return 'Employé';
      default:
        return r || 'Utilisateur';
    }
  };

  const userInitials =
    ((profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')).toUpperCase() || 'U';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Desktop Top Header */}
        <header className="hidden md:flex glass-header px-6 py-3 items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full border border-border/50">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span>{capitalizedDate}</span>
            </div>
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Système opérationnel</span>
            </div>
          </div>

          {/* User & Notifications */}
          <div className="flex items-center gap-3">
            <NotificationBell />

            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2.5 pl-2.5 pr-3 py-1 rounded-full border border-border/80 bg-card hover:bg-muted/60 hover:border-primary/30 transition-all text-left group"
              title="Consulter mon profil"
            >
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs ring-2 ring-primary/20 group-hover:ring-primary/40 transition-all">
                {userInitials}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                  {profile?.first_name} {profile?.last_name}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {getRoleLabel(role)}
                </span>
              </div>
            </button>
          </div>
        </header>

        {/* Mobile Header */}
        <header className="md:hidden glass-header flex items-center justify-between px-4 py-3 sticky top-0 z-20">
          <div className="flex items-center gap-2.5">
            <img src={guimsLogo} alt="Logo" className="w-7 h-7" />
            <div>
              <h2 className="font-display font-bold text-base leading-tight">
                DasMAGISTER
              </h2>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Portail RH
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell />

            <button
              onClick={() => navigate('/profile')}
              className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs border border-primary/20"
              title="Mon profil"
            >
              {userInitials}
            </button>

            <Sheet>
              <SheetTrigger asChild>
                <button
                  aria-label="Ouvrir le menu de navigation"
                  className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 border-none w-72">
                <AppSidebar />
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
