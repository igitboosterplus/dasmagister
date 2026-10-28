import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

import { Button } from '@/components/ui/button';

import {
  Clock,
  CheckCircle,
  LogIn,
  LogOut,
  CalendarDays,
  MapPin,
  BriefcaseBusiness,
  Timer,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  Calendar,
  Sparkles,
} from 'lucide-react';

interface Attendance {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  validation_status?: string | null;
}

export default function Dashboardemployee() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();

  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [structureName, setStructureName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    fetchTodayData();
  }, [profile?.id]);

  const fetchTodayData = async () => {
    if (!profile?.id) return;

    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      // Pointage du jour
      const { data: attendance } = await supabase
        .from('attendances')
        .select('id, employee_id, attendance_date, check_in, check_out, validation_status')
        .eq('employee_id', profile.id)
        .eq('attendance_date', today)
        .maybeSingle();

      setTodayAttendance(attendance || null);

      // Récupérer le site affecté
      const { data: employeeSite } = await supabase
        .from('employee_sites')
        .select(`
          sites (
            name
          )
        `)
        .eq('employee_id', profile.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (employeeSite && (employeeSite as any).sites?.name) {
        setSiteName((employeeSite as any).sites.name);
      }

      // Récupérer la structure
      if (profile.structure_id) {
        const { data: struct } = await supabase
          .from('structures')
          .select('name')
          .eq('id', profile.structure_id)
          .maybeSingle();

        if (struct?.name) {
          setStructureName(struct.name);
        }
      }
    } catch (error) {
      console.error('Erreur chargement données employé:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateString: string | null | undefined) => {
    if (!dateString) return '--:--';
    return new Date(dateString).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formattedDate = currentTime.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

  const formattedTime = currentTime.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isLate = todayAttendance?.validation_status === 'late';

  const calculateWorkDuration = () => {
    if (!todayAttendance?.check_in) {
      return '--';
    }

    const start = new Date(todayAttendance.check_in);
    const end = todayAttendance.check_out
      ? new Date(todayAttendance.check_out)
      : currentTime;

    const difference = end.getTime() - start.getTime();
    if (difference <= 0) {
      return '0h 00min';
    }

    const totalMinutes = Math.floor(difference / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  };

  const getStatus = () => {
    if (!todayAttendance?.check_in) {
      return {
        label: 'Non pointé',
        description: 'Vous n’avez pas encore enregistré votre prise de service aujourd’hui.',
        badgeColor: 'bg-muted text-muted-foreground border-border',
        icon: Clock,
        iconBg: 'bg-muted text-muted-foreground',
      };
    }

    if (todayAttendance.check_in && !todayAttendance.check_out) {
      return {
        label: isLate ? 'Présent (En retard)' : 'Présent (En service)',
        description: `Arrivée validée à ${formatTime(todayAttendance.check_in)}. Pointage actif.`,
        badgeColor: isLate
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        icon: CheckCircle,
        iconBg: isLate
          ? 'bg-amber-500/10 text-amber-600'
          : 'bg-emerald-500/10 text-emerald-600',
      };
    }

    return {
      label: 'Journée terminée',
      description: `Départ enregistré à ${formatTime(todayAttendance.check_out)}. Bon repos !`,
      badgeColor: 'bg-primary/10 text-primary border-primary/20',
      icon: CheckCircle,
      iconBg: 'bg-primary/10 text-primary',
    };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Chargement de votre espace personnel...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in space-y-6">
        {/* Welcome and Clock Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="h-3 w-3" />
                Espace Collaborateur
              </span>
              {structureName && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                  <Building2 className="h-3 w-3" />
                  {structureName}
                </span>
              )}
            </div>
            <h1 className="page-title mt-2">
              Bonjour, {profile?.first_name} {profile?.last_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Bienvenue sur votre portail RH quotidien.
            </p>
          </div>

          {/* Digital Clock Card */}
          <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/80 bg-card shadow-sm self-start lg:self-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground capitalize">
                {capitalizedDate}
              </p>
              <p className="font-display text-2xl font-bold tracking-tight text-foreground font-mono">
                {formattedTime}
              </p>
            </div>
          </div>
        </div>

        {/* Hero Attendance Status Card */}
        <Card className="rounded-xl border border-border/80 shadow-sm overflow-hidden bg-gradient-to-br from-card via-card to-primary/5">
          <CardContent className="p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start sm:items-center gap-4">
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${status.badgeColor}`}
                >
                  <StatusIcon className="h-7 w-7" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Statut aujourd'hui
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${status.badgeColor}`}>
                      {status.label}
                    </span>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold font-display text-foreground">
                    {status.description}
                  </h2>

                  {siteName && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span>Site assigné : <strong className="text-foreground">{siteName}</strong></span>
                    </p>
                  )}
                </div>
              </div>

              {/* Pointage CTA Button */}
              <div className="shrink-0">
                <Button
                  size="lg"
                  onClick={() => navigate('/attendance')}
                  disabled={Boolean(todayAttendance?.check_out)}
                  className="w-full sm:w-auto min-w-[230px] font-semibold shadow-md hover:shadow-lg transition-all"
                >
                  {todayAttendance?.check_in && !todayAttendance?.check_out ? (
                    <>
                      <LogOut className="mr-2 h-5 w-5" />
                      Gérer mon départ
                    </>
                  ) : todayAttendance?.check_out ? (
                    <>
                      <CheckCircle className="mr-2 h-5 w-5" />
                      Journée terminée
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-5 w-5" />
                      Pointer mon arrivée
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Daily Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* ARRIVÉE */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Heure d'arrivée
              </CardTitle>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <LogIn className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-bold tracking-tight">
                {formatTime(todayAttendance?.check_in)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {todayAttendance?.check_in ? 'Pointage enregistré' : 'En attente'}
              </p>
            </CardContent>
          </Card>

          {/* DÉPART */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Heure de départ
              </CardTitle>
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 border border-blue-500/20">
                <LogOut className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-bold tracking-tight">
                {formatTime(todayAttendance?.check_out)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {todayAttendance?.check_out ? 'Départ validé' : 'Non clôturé'}
              </p>
            </CardContent>
          </Card>

          {/* TEMPS DE TRAVAIL */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Temps travaillé
              </CardTitle>
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Timer className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-bold tracking-tight">
                {calculateWorkDuration()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Durée cumulée aujourd'hui
              </p>
            </CardContent>
          </Card>

          {/* PONCTUALITÉ */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Ponctualité
              </CardTitle>
              <div
                className={`p-2 rounded-xl border ${
                  isLate
                    ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                }`}
              >
                {isLate ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display tracking-tight flex items-center gap-2">
                {todayAttendance?.check_in ? (
                  isLate ? (
                    <span className="text-amber-600">En retard</span>
                  ) : (
                    <span className="text-emerald-600">À l'heure</span>
                  )
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {todayAttendance?.check_in
                  ? isLate
                    ? 'Retard enregistré par le système'
                    : 'Prise de poste ponctuelle'
                  : 'Pointage non débuté'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Profile Details & Quick Shortcuts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* PROFIL PROFESSIONNEL */}
          <Card className="rounded-xl border border-border/80 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base font-bold font-display">
                Mes informations professionnelles
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Détails de votre affectation actuelle
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3.5">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <BriefcaseBusiness className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Fonction / Rôle</p>
                    <p className="text-sm font-semibold text-foreground">
                      {role === 'employee' ? 'Employé(e)' : role || 'Collaborateur'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Site d'affectation</p>
                    <p className="text-sm font-semibold text-foreground">
                      {siteName || 'Site principal par défaut'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Statut du compte</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Actif & Validé
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ACTIONS RAPIDES COLLABORATEUR */}
          <Card className="rounded-xl border border-border/80 shadow-sm flex flex-col justify-between">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base font-bold font-display">
                Outils & Raccourcis
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Accédez directement à vos fonctionnalités
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3">
              <button
                onClick={() => navigate('/attendance')}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border/70 hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 group-hover:scale-105 transition-transform">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      Interface de Pointage Géolocalisé
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Pointer avec contrôle GPS et vérification de périmètre
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => navigate('/reports/employer')}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border/70 hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:scale-105 transition-transform">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      Mes Rapports d'Assiduité
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Consulter l'historique complet de vos heures travaillées
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => navigate('/profile')}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border/70 hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 group-hover:scale-105 transition-transform">
                    <BriefcaseBusiness className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      Mon Profil & Préférences
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Coordonnées, mot de passe et notifications
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
