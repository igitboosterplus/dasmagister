import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Clock,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Shield,
  MapPin,
  Building2,
  ChevronRight,
} from 'lucide-react';
import guimsLogo from '@/assets/guims-logo.png';
import { supabase } from '@/integrations/supabase/client';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  roles: string[];
  requiresSiteResponsibility?: boolean;
  requiresDasSarlStructure?: boolean;
  requiresMagistereStructure?: boolean;
  isSpace?: boolean;
}

const navItems: NavItem[] = [
  {
    label: 'Tableau de bord',
    icon: LayoutDashboard,
    path: '/dashboard',
    roles: ['admin', 'manager', 'employee'],
  },
  {
    label: 'Pointage',
    icon: Clock,
    path: '/attendance',
    roles: ['employee'],
  },
  {
    label: 'Employés',
    icon: Users,
    path: '/employees',
    roles: ['admin', 'manager'],
  },
  {
    label: 'Sites',
    icon: MapPin,
    path: '/manager/sites',
    roles: ['manager'],
  },
  {
    label: 'Gestion pointage',
    icon: Clock,
    path: '/manager/attendance',
    roles: ['admin', 'manager'],
  },
  {
    label: 'Rapports',
    icon: BarChart3,
    path: '/reports/admin',
    roles: ['admin'],
  },
  {
    label: 'Rapports',
    icon: BarChart3,
    path: '/reports/manager',
    roles: ['manager'],
  },
  {
    label: 'set',
    icon: Settings,
    path: '/settings',
    roles: ['admin'],
  },
  {
    label: 'Rapports',
    icon: BarChart3,
    path: '/reports/employer',
    roles: ['employee'],
  },
  {
    label: 'Gestion Site',
    icon: Settings,
    path: '/responsablesite',
    roles: ['employee'],
    requiresSiteResponsibility: true,
  },
  {
    label: 'Espace Das-Sarl',
    icon: Building2,
    path: '/dassarl',
    roles: ['manager', 'employee'],
    requiresDasSarlStructure: true,
    isSpace: true,
  },
  {
    label: 'Espace Magistère',
    icon: Building2,
    path: '/magistere',
    roles: ['manager', 'employee'],
    requiresMagistereStructure: true,
    isSpace: true,
  },
];

export default function AppSidebar() {
  const { profile, role, isRhManager, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSiteResponsible, setIsSiteResponsible] = useState(false);
  const [checkingResponsibility, setCheckingResponsibility] = useState(true);
  const [isDasSarlStructure, setIsDasSarlStructure] = useState(false);
  const [isMagistereStructure, setIsMagistereStructure] = useState(false);

  useEffect(() => {
    const checkSiteResponsibilityAndStructure = async () => {
      if (!profile?.id) {
        setIsSiteResponsible(false);
        setCheckingResponsibility(false);
        return;
      }

      setCheckingResponsibility(true);

      try {
        if (profile.structure_id) {
          const { data: stData } = await supabase
            .from('structures')
            .select('name')
            .eq('id', profile.structure_id)
            .single();
          const rawName = stData?.name || '';
          const normalized = rawName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

          setIsDasSarlStructure(
            normalized.includes('das-sarl') ||
            normalized.includes('das sarl') ||
            rawName === 'Das-Sarl'
          );
          setIsMagistereStructure(
            normalized.includes('magister')
          );
        }

        if (role === 'employee') {
          const { data, error } = await supabase
            .from('employee_sites')
            .select('id')
            .eq('employee_id', profile.id)
            .eq('is_responsible', true)
            .eq('is_active', true)
            .limit(1);

          if (error) {
            console.error('Erreur lors de la vérification du responsable de site:', error);
            setIsSiteResponsible(false);
          } else {
            setIsSiteResponsible((data?.length ?? 0) > 0);
          }
        }
      } catch (error) {
        console.error('Erreur inattendue lors de la vérification:', error);
        setIsSiteResponsible(false);
      } finally {
        setCheckingResponsibility(false);
      }
    };

    checkSiteResponsibilityAndStructure();
  }, [profile?.id, profile?.structure_id, role]);

  const filteredItems = navItems.filter((item) => {
    // Si l'utilisateur est Responsable RH, il a les pouvoirs du manager et pointe également
    if (isRhManager) {
      if (item.path === '/attendance') return true;
      if (item.path === '/reports/employer') return false;
      if (item.path === '/reports/manager') return true;
      if (item.roles.includes('manager')) {
        if (item.requiresDasSarlStructure) return isDasSarlStructure;
        if (item.requiresMagistereStructure) return isMagistereStructure;
        return true;
      }
      if (item.path === '/dashboard') return true;
      return false;
    }

    if (!role || !item.roles.includes(role)) return false;
    if (item.requiresSiteResponsibility) return isSiteResponsible;
    if (item.requiresDasSarlStructure) return isDasSarlStructure;
    if (item.requiresMagistereStructure) return isMagistereStructure;
    return true;
  });

  const mainNavItems = filteredItems.filter((i) => !i.isSpace);
  const spaceNavItems = filteredItems.filter((i) => i.isSpace);

  const getRoleBadge = (r: string | null) => {
    if (isRhManager) return 'Responsable RH (Manager)';
    const labels: Record<string, string> = {
      admin: 'Administrateur',
      manager: 'Manager',
      employee: 'Employé',
    };
    return labels[r || ''] || r;
  };

  const userInitials =
    ((profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')).toUpperCase() || 'U';

  const renderNavButton = (item: NavItem) => {
    const isActive = location.pathname === item.path ||
      (item.path === '/dashboard' && location.pathname.startsWith('/dashboard'));

    return (
      <button
        key={item.path}
        onClick={() => navigate(item.path)}
        className={`group relative flex items-center justify-between w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-primary font-semibold shadow-sm'
            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Active Accent Indicator */}
          {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-sidebar-primary" />
          )}
          <item.icon
            className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${
              isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </div>
        {isActive && (
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-primary/70 shrink-0" />
        )}
      </button>
    );
  };

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border select-none">
      {/* Brand Logo Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-sidebar-border/80 bg-sidebar-accent/20">
        <div className="relative flex items-center justify-center p-1 rounded-lg bg-sidebar-accent/40 border border-sidebar-border">
          <img
            src={guimsLogo}
            alt="Guims Group"
            className="w-8 h-8 object-contain"
          />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-sidebar-foreground tracking-tight flex items-center gap-1.5">
            DasMAGISTER
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary animate-pulse" />
            <span className="text-[10px] uppercase font-semibold tracking-wider text-sidebar-foreground/60">
              Système RH
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {!checkingResponsibility && (
          <>
            {/* Main Menu */}
            <div className="space-y-1">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                Menu Principal
              </p>
              {mainNavItems.map(renderNavButton)}
            </div>

            {/* Dedicated Spaces (if any) */}
            {spaceNavItems.length > 0 && (
              <div className="space-y-1 pt-2">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  Espaces Structure
                </p>
                {spaceNavItems.map(renderNavButton)}
              </div>
            )}
          </>
        )}
      </nav>

      {/* User Footer Profile & Logout */}
      <div className="border-t border-sidebar-border/80 p-3 bg-sidebar-accent/20 space-y-2">
        {/* Profile Card Button */}
        <button
          onClick={() => navigate('/profile')}
          className="w-full flex items-center gap-3 p-2 rounded-lg bg-sidebar-accent/40 hover:bg-sidebar-accent border border-sidebar-border/60 transition-all text-left group"
          title="Voir mon profil"
        >
          <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 text-sidebar-primary border border-sidebar-primary/40 flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform">
            {userInitials}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-sidebar-foreground truncate group-hover:text-sidebar-primary transition-colors">
              {profile?.first_name} {profile?.last_name}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Shield className="h-2.5 w-2.5 text-sidebar-primary shrink-0" />
              <span className="text-[10px] text-sidebar-foreground/60 truncate">
                {getRoleBadge(role)}
              </span>
            </div>
          </div>
        </button>

        {/* Logout Button */}
        <button
          onClick={signOut}
          className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
