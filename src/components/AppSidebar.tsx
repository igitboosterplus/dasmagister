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
} from 'lucide-react';
import guimsLogo from '@/assets/guims-logo.png';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  roles: string[];
}

const navItems: NavItem[] = [
  { label: 'Tableau de bord', icon: LayoutDashboard, path: '/dashboard', roles: ['admin', 'manager', 'employee'] },
  { label: 'Pointage', icon: Clock, path: '/attendance', roles: ['admin', 'manager', 'employee'] },
  { label: 'Employés', icon: Users, path: '/employees', roles: ['admin', 'manager'] },
  { label: 'Sites', icon: MapPin, path: '/manager/sites', roles: ['manager'] },
  { label: 'Rapports', icon: BarChart3, path: '/reports', roles: ['admin', 'manager', 'employee'] },
  { label: 'Paramètres', icon: Settings, path: '/settings', roles: ['admin'] },
];

export default function AppSidebar() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const filteredItems = navItems.filter((item) => role && item.roles.includes(role));

  const getRoleBadge = (role: string | null) => {
    const labels: Record<string, string> = {
      admin: 'Administrateur',
      manager: 'Manager',
      employee: 'Employé',
    };
    return labels[role || ''] || role;
  };

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <img src={guimsLogo} alt="Guims Group" className="w-9 h-9" />
        <div>
          <h2 className="font-display text-sm font-bold text-sidebar-primary-foreground">GUIMS GROUP</h2>
          <p className="text-[10px] uppercase tracking-widest opacity-60">Gestion RH</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`sidebar-nav-item w-full text-left ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* User info */}
      <div className="border-t border-sidebar-border p-4">
        <div className="mb-3">
          < a href="/profile">
          <p className="text-sm font-medium text-sidebar-primary-foreground truncate">
            {profile?.first_name} {profile?.last_name}
          </p>
          </a>
          <div className="flex items-center gap-1.5 mt-1">
            <Shield className="h-3 w-3 text-sidebar-primary" />
            <span className="text-[11px] text-sidebar-primary">{getRoleBadge(role)}</span>
          </div>
        </div>
        <button
          onClick={signOut}
          className="sidebar-nav-item w-full text-left text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
