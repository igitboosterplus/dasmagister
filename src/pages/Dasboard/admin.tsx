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
import {
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  TrendingUp,
  BarChart3,
  Building2,
  Calendar,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

interface DashboardStats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
}

export default function Dashadmin() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 0,
    presentToday: 0,
    lateToday: 0,
    absentToday: 0,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      const [employeesRes, attendanceRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id')
          .eq('is_active', true),

        supabase
          .from('attendances')
          .select('id, employee_id, check_in, validation_status')
          .eq('attendance_date', today),
      ]);

      if (employeesRes.error) {
        console.error('Erreur employés:', employeesRes.error);
        return;
      }
      if (attendanceRes.error) {
        console.error('Erreur pointages:', attendanceRes.error);
        return;
      }

      const employees = employeesRes.data || [];
      const attendances = attendanceRes.data || [];

      // Dédupliquer par employé (garder le plus récent check_in)
      const seenEmployees = new Set<string>();
      let present = 0;
      let late = 0;

      for (const att of attendances) {
        if (!att.check_in) continue;
        if (seenEmployees.has(att.employee_id)) continue;
        seenEmployees.add(att.employee_id);
        present++;
        if (att.validation_status === 'late') late++;
      }

      const absent = Math.max(employees.length - present, 0);

      setStats({
        totalEmployees: employees.length,
        presentToday: present,
        lateToday: late,
        absentToday: absent,
      });
    } catch (error) {
      console.error('Erreur chargement statistiques:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchStats();
  }, []);

  const handleManualRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  const onTimeCount = Math.max(stats.presentToday - stats.lateToday, 0);
  const presenceRate =
    stats.totalEmployees > 0
      ? Math.round((stats.presentToday / stats.totalEmployees) * 100)
      : 0;
  const lateRate =
    stats.presentToday > 0
      ? Math.round((stats.lateToday / stats.presentToday) * 100)
      : 0;
  const absentRate =
    stats.totalEmployees > 0
      ? Math.round((stats.absentToday / stats.totalEmployees) * 100)
      : 0;

  const statCards = [
    {
      label: 'Total Effectif Actif',
      value: stats.totalEmployees,
      badge: 'Employés enregistrés',
      icon: Users,
      bgIcon: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      badgeColor: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
    },
    {
      label: "Présents Aujourd'hui",
      value: stats.presentToday,
      badge: `${presenceRate}% de présence`,
      icon: CheckCircle,
      bgIcon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Retards Constatés',
      value: stats.lateToday,
      badge: `${lateRate}% des présents`,
      icon: Clock,
      bgIcon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    },
    {
      label: 'Absents du Jour',
      value: stats.absentToday,
      badge: `${absentRate}% d'absence`,
      icon: AlertTriangle,
      bgIcon: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      badgeColor: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
    },
  ];

  const quickLinks = [
    {
      title: 'Gestion des Employés',
      desc: 'Annuaire complet, rôles, fiches individuelles et pointages',
      path: '/employees',
      icon: Users,
      color: 'text-primary bg-primary/10',
    },
    {
      title: 'Supervision des Pointages',
      desc: 'Contrôle des flux, validation et géolocalisation en temps réel',
      path: '/manager/attendance',
      icon: Clock,
      color: 'text-emerald-600 bg-emerald-500/10',
    },
    {
      title: 'Rapports & Audit RH',
      desc: 'Analyses globales, taux d’assiduité et exports consolidés',
      path: '/reports/admin',
      icon: BarChart3,
      color: 'text-amber-600 bg-amber-500/10',
    },
  ];

  return (
    <DashboardLayout>
      <div className="animate-fade-in space-y-8">
        {/* Welcome Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="h-3 w-3" />
                Espace Administration
              </span>
            </div>
            <h1 className="page-title mt-2">
              Bonjour, {profile?.first_name} {profile?.last_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tableau de bord de supervision des présences et de l’activité en temps réel.
            </p>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border/80 bg-card hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-all shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-primary' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <Card key={stat.label} className="stat-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </CardTitle>
                <div className={`p-2 rounded-xl border ${stat.bgIcon}`}>
                  <stat.icon className="h-4 w-4" />
                </div>
              </CardHeader>

              <CardContent className="pt-1">
                {loading ? (
                  <div className="h-9 w-20 bg-muted animate-pulse rounded" />
                ) : (
                  <div>
                    <div className="text-3xl font-bold font-display tracking-tight">
                      {stat.value}
                    </div>
                    <div className="mt-2">
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${stat.badgeColor}`}>
                        {stat.badge}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Attendance Breakdown & Progress */}
        <Card className="rounded-xl border border-border/80 shadow-sm overflow-hidden bg-card">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-lg font-bold font-display">
                  Répartition de l’assiduité aujourd’hui
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Proportion des présences, retards et absences sur l'ensemble du personnel
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span>Données du jour</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                <div className="h-4 bg-muted animate-pulse rounded-full w-full" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="h-16 bg-muted animate-pulse rounded-lg" />
                  <div className="h-16 bg-muted animate-pulse rounded-lg" />
                  <div className="h-16 bg-muted animate-pulse rounded-lg" />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Segmented Visual Progress Bar */}
                <div>
                  <div className="flex justify-between items-center text-xs font-medium text-muted-foreground mb-2">
                    <span>Progression globale</span>
                    <span className="font-semibold text-foreground">{presenceRate}% de présence</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex shadow-inner">
                    {/* On time bar */}
                    <div
                      title={`À l'heure: ${onTimeCount}`}
                      style={{
                        width: stats.totalEmployees > 0
                          ? `${(onTimeCount / stats.totalEmployees) * 100}%`
                          : '0%',
                      }}
                      className="bg-emerald-500 transition-all duration-500"
                    />
                    {/* Late bar */}
                    <div
                      title={`En retard: ${stats.lateToday}`}
                      style={{
                        width: stats.totalEmployees > 0
                          ? `${(stats.lateToday / stats.totalEmployees) * 100}%`
                          : '0%',
                      }}
                      className="bg-amber-500 transition-all duration-500"
                    />
                    {/* Absent bar */}
                    <div
                      title={`Absents: ${stats.absentToday}`}
                      style={{
                        width: stats.totalEmployees > 0
                          ? `${(stats.absentToday / stats.totalEmployees) * 100}%`
                          : '0%',
                      }}
                      className="bg-rose-500/70 transition-all duration-500"
                    />
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      <span>À l'heure ({onTimeCount})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                      <span>En retard ({stats.lateToday})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      <span>Non pointés / Absents ({stats.absentToday})</span>
                    </div>
                  </div>
                </div>

                {/* Key Percentage Indicators */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition-colors">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Taux de Présence
                    </p>
                    <p className="text-2xl font-bold font-display text-emerald-700 dark:text-emerald-300 mt-1">
                      {presenceRate}%
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {stats.presentToday} employé(s) sur {stats.totalEmployees}
                    </p>
                  </div>

                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 transition-colors">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Taux de Retard
                    </p>
                    <p className="text-2xl font-bold font-display text-amber-700 dark:text-amber-300 mt-1">
                      {lateRate}%
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {stats.lateToday} retard(s) parmi les présents
                    </p>
                  </div>

                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 transition-colors">
                    <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
                      Taux d'Absence
                    </p>
                    <p className="text-2xl font-bold font-display text-rose-700 dark:text-rose-300 mt-1">
                      {absentRate}%
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {stats.absentToday} employé(s) sans pointage
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Shortcuts Grid */}
        <div>
          <h2 className="text-base font-bold font-display text-foreground mb-3 flex items-center gap-2">
            <span>Accès Rapides & Modules Clés</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickLinks.map((link) => (
              <button
                key={link.title}
                onClick={() => navigate(link.path)}
                className="group flex flex-col justify-between p-5 rounded-xl border border-border/80 bg-card hover:bg-muted/40 hover:border-primary/40 hover:shadow-md transition-all text-left"
              >
                <div>
                  <div className={`p-2.5 rounded-xl w-fit ${link.color} mb-3 transition-transform group-hover:scale-110`}>
                    <link.icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors flex items-center justify-between">
                    <span>{link.title}</span>
                    <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary" />
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {link.desc}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-primary flex items-center gap-1">
                  <span>Accéder au module</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
