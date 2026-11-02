import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

import {
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  Building2,
  ArrowRight,
  MapPin,
  BarChart3,
  Calendar,
  RefreshCw,
  Sparkles,
  UserPlus,
  UserCheck,
  UserX,
  Phone,
  Loader2,
} from 'lucide-react';

interface Stats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
}

interface Structure {
  id: string;
  name: string;
}

export default function DashboardManager() {
  const { role, profile, isRhManager } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats>({
    totalEmployees: 0,
    presentToday: 0,
    lateToday: 0,
    absentToday: 0,
  });

  const [structure, setStructure] = useState<Structure | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inscriptions en attente
  const [pendingRegistrations, setPendingRegistrations] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedRejectEmployee, setSelectedRejectEmployee] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchDashboard = async () => {
    if ((role !== 'manager' && !isRhManager) || !profile?.structure_id) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const structureId = profile.structure_id;

      const structureRes = await supabase
        .from('structures')
        .select('id, name')
        .eq('id', structureId)
        .single();

      if (structureRes.error) throw structureRes.error;
      setStructure(structureRes.data);

      const employeesRes = await supabase
        .from('employees')
        .select('id')
        .eq('structure_id', structureId)
        .eq('is_active', true);

      if (employeesRes.error) throw employeesRes.error;

      const employees = employeesRes.data || [];
      const employeeIds = employees.map((employee) => employee.id);

      if (employeeIds.length === 0) {
        setStats({
          totalEmployees: 0,
          presentToday: 0,
          lateToday: 0,
          absentToday: 0,
        });
        return;
      }

      const today = new Date().toISOString().split('T')[0];

      const attendanceRes = await supabase
        .from('attendances')
        .select('id, employee_id, check_in, validation_status')
        .eq('attendance_date', today)
        .in('employee_id', employeeIds);

      if (attendanceRes.error) throw attendanceRes.error;

      const attendances = attendanceRes.data || [];

      let present = 0;
      let late = 0;
      const processedEmployees = new Set<string>();

      for (const attendance of attendances) {
        if (!attendance.check_in) continue;
        if (processedEmployees.has(attendance.employee_id)) continue;
        processedEmployees.add(attendance.employee_id);
        present++;
        if (attendance.validation_status === 'late') late++;
      }

      const absent = Math.max(employees.length - present, 0);

      setStats({
        totalEmployees: employees.length,
        presentToday: present,
        lateToday: late,
        absentToday: absent,
      });
    } catch (err: any) {
      console.error('Erreur Dashboard Manager:', err);
      setError(
        err?.message || 'Impossible de charger les données du tableau de bord.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchPendingRegistrations = useCallback(async () => {
    if (!profile?.structure_id) return;
    try {
      setPendingLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select(`
          id,
          first_name,
          last_name,
          phone,
          created_at,
          account_status,
          services (id, name),
          positions (id, name)
        `)
        .eq('structure_id', profile.structure_id)
        .eq('account_status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingRegistrations(data || []);
    } catch (err: any) {
      console.error('Erreur chargement inscriptions en attente:', err);
    } finally {
      setPendingLoading(false);
    }
  }, [profile?.structure_id]);

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
    fetchPendingRegistrations();

    if (!profile?.structure_id) return;

    // Écoute en temps réel des nouveaux enregistrements d'employés
    const channel = supabase
      .channel(`pending-reg-${profile.structure_id}-${Math.random().toString(36).substring(2, 9)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employees',
          filter: `structure_id=eq.${profile.structure_id}`,
        },
        () => {
          fetchPendingRegistrations();
          fetchDashboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, profile?.structure_id, fetchPendingRegistrations]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    fetchDashboard();
    fetchPendingRegistrations();
  };

  const handleApproveRegistration = async (employeeId: string) => {
    try {
      setActionLoadingId(employeeId);
      // Appel de la RPC Postgres
      const { error: rpcError } = await supabase.rpc('approve_registration', {
        p_employee_id: employeeId,
      });

      if (rpcError) {
        console.warn('RPC approve_registration fallback direct update:', rpcError);
        // Fallback update direct
        const { error: updateError } = await supabase
          .from('employees')
          .update({
            account_status: 'active',
            is_active: true,
            approved_by: profile?.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', employeeId);

        if (updateError) throw updateError;

        // Insertion notification directe vers l'employé (Direction Manager -> Employé)
        await supabase.from('notifications').insert({
          recipient_employee_id: employeeId,
          type: 'registration_approved',
          title: 'Inscription validée !',
          message: 'Votre compte a été validé et activé avec succès par votre responsable. Vous pouvez maintenant accéder à tous les services.',
          entity_type: 'employee',
          entity_id: employeeId,
        });
      }

      toast({
        title: 'Inscription validée !',
        description: 'Le compte a été activé et l’employé a été notifié en temps réel.',
      });

      fetchPendingRegistrations();
      fetchDashboard();
    } catch (err: any) {
      console.error('Erreur validation inscription:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de valider l’inscription.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRejectRegistration = async () => {
    if (!selectedRejectEmployee) return;
    try {
      setActionLoadingId(selectedRejectEmployee.id);
      const reason = rejectReason.trim() || 'Inscription non conforme ou non autorisée.';
      const { error: rpcError } = await supabase.rpc('reject_registration', {
        p_employee_id: selectedRejectEmployee.id,
        p_reason: reason,
      });

      if (rpcError) {
        console.warn('RPC reject_registration fallback direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('employees')
          .update({
            account_status: 'rejected',
            is_active: false,
            rejection_reason: reason,
          })
          .eq('id', selectedRejectEmployee.id);

        if (updateError) throw updateError;

        await supabase.from('notifications').insert({
          recipient_employee_id: selectedRejectEmployee.id,
          type: 'registration_rejected',
          title: 'Inscription refusée',
          message: `Votre demande d'inscription a été refusée : ${reason}`,
          entity_type: 'employee',
          entity_id: selectedRejectEmployee.id,
        });
      }

      toast({
        title: 'Inscription refusée',
        description: 'La décision a été enregistrée et l’utilisateur en a été notifié.',
      });

      setRejectDialogOpen(false);
      setSelectedRejectEmployee(null);
      setRejectReason('');
      fetchPendingRegistrations();
    } catch (err: any) {
      console.error('Erreur rejet inscription:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de refuser l’inscription.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
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
      label: 'Employés Structure',
      value: stats.totalEmployees,
      badge: 'Effectif actif',
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
      label: 'Employés en Retard',
      value: stats.lateToday,
      badge: `${lateRate}% des présents`,
      icon: Clock,
      bgIcon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    },
    {
      label: 'Absents / Sans Pointage',
      value: stats.absentToday,
      badge: `${absentRate}% d'absence`,
      icon: AlertTriangle,
      bgIcon: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      badgeColor: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
    },
  ];

  const quickLinks = [
    ...(isRhManager
      ? [
          {
            title: 'Pointage Itinérant (Tous sites)',
            desc: 'Enregistrer vos arrivées et départs sur n’importe quel site visité',
            path: '/attendance',
            icon: Clock,
            color: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20',
          },
        ]
      : []),
    {
      title: 'Liste des Employés',
      desc: 'Consulter et administrer les collaborateurs de votre structure',
      path: '/employees',
      icon: Users,
      color: 'text-primary bg-primary/10',
    },
    {
      title: 'Validation des Pointages',
      desc: 'Contrôler les pointages, horaires et justificatifs',
      path: '/manager/attendance',
      icon: Clock,
      color: 'text-emerald-600 bg-emerald-500/10',
    },
    {
      title: 'Sites d’Affectation',
      desc: 'Visualiser les sites rattachés et les périmètres géographiques',
      path: '/manager/sites',
      icon: MapPin,
      color: 'text-blue-600 bg-blue-500/10',
    },
    {
      title: 'Rapports Périodiques',
      desc: 'Générer des états de présence pour votre structure',
      path: '/reports/manager',
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <Building2 className="h-3 w-3" />
                {structure?.name ? `Structure : ${structure.name}` : 'Espace Manager'}
              </span>
              {isRhManager && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                  <Sparkles className="h-3 w-3 text-indigo-500" />
                  Poste : Responsable RH (Pouvoirs Manager & Pointage Itinérant)
                </span>
              )}
            </div>
            <h1 className="page-title mt-2">
              Bonjour, {profile?.first_name} {profile?.last_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isRhManager
                ? 'Gestion complète des équipes, validation des présences et pointage actif sur l’ensemble des sites.'
                : 'Suivi en temps réel de votre équipe et contrôle opérationnel des présences.'}
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

        {/* Pending Registrations Alert Section */}
        {pendingRegistrations.length > 0 && (
          <div className="rounded-2xl border-2 border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-sm space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-amber-500/20">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <UserPlus className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-foreground text-base">
                      Nouvelles demandes d'inscription
                    </h3>
                    <Badge variant="outline" className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40 text-xs font-bold">
                      {pendingRegistrations.length} en attente
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ces collaborateurs attendent votre validation pour accéder à l'application.
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/employees')}
                className="text-xs border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                Gérer tous les employés
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingRegistrations.map((cand) => {
                const serviceName = Array.isArray(cand.services) ? cand.services[0]?.name : cand.services?.name;
                const posName = Array.isArray(cand.positions) ? cand.positions[0]?.name : cand.positions?.name;
                const isOperating = actionLoadingId === cand.id;

                return (
                  <div
                    key={cand.id}
                    className="flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-card/90 backdrop-blur-sm shadow-xs hover:border-amber-500/40 transition-all space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground">
                          {cand.first_name} {cand.last_name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {cand.created_at ? formatDistanceToNow(parseISO(cand.created_at), { addSuffix: true, locale: fr }) : 'récent'}
                        </span>
                      </div>

                      {cand.phone && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-primary/70" />
                          <span>{cand.phone}</span>
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {serviceName && (
                          <Badge variant="secondary" className="text-[10px]">
                            {serviceName}
                          </Badge>
                        )}
                        {posName && (
                          <Badge variant="outline" className="text-[10px]">
                            {posName}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                      <Button
                        size="sm"
                        disabled={isOperating}
                        onClick={() => handleApproveRegistration(cand.id)}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 shadow-xs"
                      >
                        {isOperating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 mr-1" />
                        )}
                        Valider l'accès
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isOperating}
                        onClick={() => {
                          setSelectedRejectEmployee(cand);
                          setRejectReason('');
                          setRejectDialogOpen(true);
                        }}
                        className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30"
                      >
                        <UserX className="h-3.5 w-3.5 mr-1" />
                        Refuser
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Alert if any */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3 text-destructive text-sm animate-fade-in">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

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
                  Taux de présence du jour
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Situation actuelle des collaborateurs actifs de la structure
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span>Aujourd'hui</span>
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
                    <span>Assiduité globale de l'équipe</span>
                    <span className="font-semibold text-foreground">{presenceRate}% de présence</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex shadow-inner">
                    <div
                      title={`À l'heure: ${onTimeCount}`}
                      style={{
                        width: stats.totalEmployees > 0
                          ? `${(onTimeCount / stats.totalEmployees) * 100}%`
                          : '0%',
                      }}
                      className="bg-emerald-500 transition-all duration-500"
                    />
                    <div
                      title={`En retard: ${stats.lateToday}`}
                      style={{
                        width: stats.totalEmployees > 0
                          ? `${(stats.lateToday / stats.totalEmployees) * 100}%`
                          : '0%',
                      }}
                      className="bg-amber-500 transition-all duration-500"
                    />
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
                      {stats.lateToday} retard(s) enregistré(s)
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
                      {stats.absentToday} sans pointage
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Shortcuts */}
        <div>
          <h2 className="text-base font-bold font-display text-foreground mb-3 flex items-center gap-2">
            <span>Actions & Outils Manager</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <span>Accéder</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Dialogue de Refus d'inscription */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-600">
                <UserX className="h-5 w-5" />
                <span>Refuser l'inscription</span>
              </DialogTitle>
              <DialogDescription>
                Vous êtes sur le point de refuser l'accès à{' '}
                <strong>
                  {selectedRejectEmployee?.first_name} {selectedRejectEmployee?.last_name}
                </strong>
                . Cette personne sera notifiée et ne pourra pas accéder aux services de la structure.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <label className="text-xs font-medium text-foreground">
                Motif du refus (sera envoyé à l'employé) :
              </label>
              <Textarea
                placeholder="Ex : Profil ou matricule non reconnu, contactez les RH..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoadingId === selectedRejectEmployee?.id}
                onClick={handleRejectRegistration}
              >
                {actionLoadingId === selectedRejectEmployee?.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : null}
                Confirmer le refus
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
