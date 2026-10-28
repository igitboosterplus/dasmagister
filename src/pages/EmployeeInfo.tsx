import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  Clock,
  UserCheck,
  UserX,
  Building2,
  MapPin,
  Phone,
  Briefcase,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Loader2,
  Activity,
  Shield,
  FileText,
  Navigation,
  Sparkles,
} from 'lucide-react';
import {
  format,
  differenceInCalendarDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  isAfter,
  isBefore,
  parseISO,
} from 'date-fns';
import { fr } from 'date-fns/locale';

// ============================================================
// TYPES
// ============================================================

interface EmployeeProfile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  structure_id: string | null;
  service_id: string | null;
  position_id: string | null;
  is_active: boolean;
  account_status: string;
  created_at: string;
  positions?: { id: string; name: string } | null;
  services?: { id: string; name: string } | null;
  structures?: { id: string; name: string } | null;
  employee_roles?: Array<{ role: string }> | { role: string } | null;
  employee_sites?: Array<{
    id: string;
    site_id: string;
    is_active: boolean;
    is_responsible: boolean;
    sites?: { id: string; name: string } | null;
  }>;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  site_id: string | null;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_in_accuracy_m: number | null;
  check_out_accuracy_m: number | null;
  check_in_distance_m: number | null;
  check_out_distance_m: number | null;
  validation_method: string | null;
  validation_status: string | null;
  late_minutes: number | null;
  attendance_status: string | null;
  created_at: string;
  site?: { id: string; name: string } | null;
}

interface AbsenceRecord {
  id: string;
  employee_id: string;
  structure_id: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  rejection_reason?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
}

// ============================================================
// HELPERS
// ============================================================

function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '0 min';
  const total = Math.floor(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  return `${hours}h ${remaining > 0 ? `${remaining}m` : ''}`;
}

function calculateWorkDuration(
  checkIn: string | null,
  checkOut: string | null
): string {
  if (!checkIn || !checkOut) return '—';
  try {
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return '—';
    const diffMinutes = Math.floor((end - start) / (1000 * 60));
    const h = Math.floor(diffMinutes / 60);
    const m = diffMinutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  paid_leave: 'Congé payé',
  sick_leave: 'Maladie',
  unpaid_leave: 'Congé sans solde',
  maternity: 'Maternité / Paternité',
  permission: 'Permission exceptionnelle',
  family: 'Événement familial',
  other: 'Autre motif',
};

const ABSENCE_STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'En attente', variant: 'secondary' },
  approved: { label: 'Approuvée', variant: 'default' },
  rejected: { label: 'Refusée', variant: 'destructive' },
};

export default function EmployeeInfo() {
  const { id } = useParams<{ id: string }>();
  const { role, profile: currentProfile } = useAuth();
  const navigate = useNavigate();

  // État des données
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);

  // États UI
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'this_month' | 'last_month' | 'last_3_months' | 'this_year'>('all');
  const [siteFilter, setSiteFilter] = useState<string>('all');

  // ==========================================================
  // CHARGEMENT DES DONNÉES
  // ==========================================================
  const loadEmployeeData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Profil employé avec relations
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .select(`
          id,
          first_name,
          last_name,
          phone,
          structure_id,
          service_id,
          position_id,
          is_active,
          account_status,
          created_at,
          positions ( id, name ),
          services ( id, name ),
          structures ( id, name ),
          employee_roles ( role ),
          employee_sites!employee_sites_employee_id_fkey (
            id,
            site_id,
            is_active,
            is_responsible,
            sites ( id, name )
          )
        `)
        .eq('id', id)
        .single();

      if (empError) throw empError;
      if (!empData) throw new Error("Profil de l'employé introuvable.");

      // Normalisation du profil
      const normalizedEmp: EmployeeProfile = {
        ...empData,
        positions: Array.isArray(empData.positions)
          ? empData.positions[0] ?? null
          : empData.positions,
        services: Array.isArray(empData.services)
          ? empData.services[0] ?? null
          : empData.services,
        structures: Array.isArray(empData.structures)
          ? empData.structures[0] ?? null
          : empData.structures,
        employee_roles: Array.isArray(empData.employee_roles)
          ? empData.employee_roles[0] ?? null
          : empData.employee_roles,
        employee_sites: Array.isArray(empData.employee_sites)
          ? empData.employee_sites.map((es: any) => ({
              ...es,
              sites: Array.isArray(es.sites) ? es.sites[0] ?? null : es.sites,
            }))
          : [],
      };

      setEmployee(normalizedEmp);

      // 2. Historique des pointages
      const { data: attData, error: attError } = await supabase
        .from('attendances')
        .select(`
          id,
          employee_id,
          site_id,
          attendance_date,
          check_in,
          check_out,
          check_in_latitude,
          check_in_longitude,
          check_in_accuracy_m,
          check_out_accuracy_m,
          check_in_distance_m,
          check_out_distance_m,
          validation_method,
          validation_status,
          late_minutes,
          attendance_status,
          created_at,
          site:sites ( id, name )
        `)
        .eq('employee_id', id)
        .order('attendance_date', { ascending: false });

      if (attError) throw attError;

      const normalizedAttendances: AttendanceRecord[] = (attData || []).map((row: any) => ({
        ...row,
        site: Array.isArray(row.site) ? row.site[0] ?? null : row.site,
      }));

      setAttendances(normalizedAttendances);

      // 3. Déclarations d'absences
      const { data: absData, error: absError } = await supabase
        .from('employee_absences')
        .select('*')
        .eq('employee_id', id)
        .order('start_date', { ascending: false });

      if (absError) {
        console.warn('Erreur chargement absences:', absError);
      } else {
        setAbsences(absData || []);
      }
    } catch (err: any) {
      console.error('Erreur chargement fiche employé:', err);
      setError(
        err?.message ||
        "Impossible de charger les informations de cet employé. Vérifiez vos droits d'accès."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadEmployeeData();
  }, [loadEmployeeData]);

  // ==========================================================
  // FILTRAGE PAR PÉRIODE ET SITE
  // ==========================================================
  const dateInterval = useMemo(() => {
    const now = new Date();
    switch (periodFilter) {
      case 'this_month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'last_month': {
        const last = subMonths(now, 1);
        return { start: startOfMonth(last), end: endOfMonth(last) };
      }
      case 'last_3_months':
        return { start: subMonths(now, 3), end: now };
      case 'this_year':
        return { start: startOfYear(now), end: now };
      case 'all':
      default:
        return null;
    }
  }, [periodFilter]);

  const filteredAttendances = useMemo(() => {
    return attendances.filter((att) => {
      // Filtre de période
      if (dateInterval) {
        try {
          const d = parseISO(att.attendance_date);
          if (isBefore(d, dateInterval.start) || isAfter(d, dateInterval.end)) {
            return false;
          }
        } catch {
          // keep row
        }
      }

      // Filtre de site
      if (siteFilter !== 'all' && att.site_id !== siteFilter) {
        return false;
      }

      // Recherche texte
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const dateStr = att.attendance_date.toLowerCase();
        const siteName = att.site?.name?.toLowerCase() || '';
        const statusStr = (att.validation_status || att.attendance_status || '').toLowerCase();
        if (!dateStr.includes(q) && !siteName.includes(q) && !statusStr.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [attendances, dateInterval, siteFilter, searchQuery]);

  const filteredAbsences = useMemo(() => {
    return absences.filter((abs) => {
      if (dateInterval) {
        try {
          const s = parseISO(abs.start_date);
          const e = parseISO(abs.end_date);
          // Si l'absence intersecte la période
          if (isAfter(s, dateInterval.end) || isBefore(e, dateInterval.start)) {
            return false;
          }
        } catch {
          // keep
        }
      }
      return true;
    });
  }, [absences, dateInterval]);

  // ==========================================================
  // CALCULS STATISTIQUES ET SOMMATION
  // ==========================================================
  const stats = useMemo(() => {
    // 1. Présences
    const presentRecords = filteredAttendances.filter(
      (a) => a.check_in !== null || a.validation_status === 'present' || a.attendance_status === 'present'
    );
    const totalPresences = presentRecords.length;

    // Retards
    const lateRecords = filteredAttendances.filter(
      (a) => (a.late_minutes && a.late_minutes > 0) || a.validation_status === 'late'
    );
    const totalLateCount = lateRecords.length;
    const totalLateMinutes = filteredAttendances.reduce(
      (acc, a) => acc + (a.late_minutes && a.late_minutes > 0 ? a.late_minutes : 0),
      0
    );

    // À l'heure
    const onTimeCount = Math.max(0, totalPresences - totalLateCount);

    // 2. Absences sommées
    // A. Jours d'absence approuvés (déclarations officielles)
    const approvedAbsenceRecords = filteredAbsences.filter((a) => a.status === 'approved');
    const approvedAbsenceDays = approvedAbsenceRecords.reduce((acc, a) => {
      try {
        const start = parseISO(a.start_date);
        const end = parseISO(a.end_date);
        const diff = Math.max(1, differenceInCalendarDays(end, start) + 1);
        return acc + diff;
      } catch {
        return acc + 1;
      }
    }, 0);

    // B. Jours d'absence en attente
    const pendingAbsenceRecords = filteredAbsences.filter((a) => a.status === 'pending');
    const pendingAbsenceDays = pendingAbsenceRecords.reduce((acc, a) => {
      try {
        const start = parseISO(a.start_date);
        const end = parseISO(a.end_date);
        const diff = Math.max(1, differenceInCalendarDays(end, start) + 1);
        return acc + diff;
      } catch {
        return acc + 1;
      }
    }, 0);

    // C. Absences constatées dans les logs de pointage (statut absent / non pointé)
    const attendanceAbsentCount = filteredAttendances.filter(
      (a) => a.validation_status === 'absent' || a.attendance_status === 'absent'
    ).length;

    // Somme totale des absences
    const totalAbsencesSomme = approvedAbsenceDays + attendanceAbsentCount;

    // 3. Taux d'assiduité / présence
    const totalWorkingDays = totalPresences + totalAbsencesSomme;
    const attendanceRate =
      totalWorkingDays > 0 ? ((totalPresences / totalWorkingDays) * 100).toFixed(1) : '100';

    return {
      totalPresences,
      totalLateCount,
      totalLateMinutes,
      onTimeCount,
      approvedAbsenceDays,
      pendingAbsenceDays,
      attendanceAbsentCount,
      totalAbsencesSomme,
      attendanceRate,
    };
  }, [filteredAttendances, filteredAbsences]);

  // Liste des sites uniques pour le filtre
  const assignedSites = useMemo(() => {
    return employee?.employee_sites?.map((es) => es.sites).filter(Boolean) || [];
  }, [employee]);

  // Rôle de l'employé
  const employeeRole = useMemo(() => {
    const rolesObj = employee?.employee_roles;
    if (!rolesObj) return 'Employé';
    const r = Array.isArray(rolesObj) ? rolesObj[0]?.role : rolesObj.role;
    if (r === 'admin') return 'Administrateur';
    if (r === 'manager') return 'Manager';
    return 'Employé';
  }, [employee]);

  // ==========================================================
  // RENDU CHARGEMENT / ERREUR
  // ==========================================================
  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">
            Chargement de la fiche et des pointages de l'employé...
          </p>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !employee) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-12">
          <Card className="border-destructive/30">
            <CardHeader className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <CardTitle>Employé introuvable</CardTitle>
              <CardDescription>
                {error || "Vous n'avez pas l'autorisation d'accéder à ce profil."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => navigate('/employees')} variant="outline" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Retour à l'annuaire des employés
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-12 animate-fade-in">
        {/* ====================================================
         * BOUTON RETOUR & TITRE
         * ================================================== */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/employees')}
              className="gap-2 shrink-0 shadow-sm"
            >
              <ArrowLeft className="h-4 w-4" />
              Retour
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                {employee.first_name} {employee.last_name}
                <Badge
                  variant={employee.is_active ? 'default' : 'destructive'}
                  className="text-xs font-normal"
                >
                  {employee.is_active ? 'Compte actif' : 'Désactivé'}
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Fiche détaillée, synthèse des présences/absences et historique complet
              </p>
            </div>
          </div>
        </div>

        {/* ====================================================
         * BANDEAU INFORMATIONS EMPLOYÉ
         * ================================================== */}
        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
              {/* Avatar + Infos principales */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold border-2 border-primary/20 shrink-0 shadow-inner">
                  {employee.first_name?.[0]}
                  {employee.last_name?.[0]}
                </div>

                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold">
                      {employee.first_name} {employee.last_name}
                    </span>
                    <Badge variant="outline" className="text-primary border-primary/40 font-medium">
                      <Shield className="h-3 w-3 mr-1" />
                      {employeeRole}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Briefcase className="h-3.5 w-3.5" />
                      {employee.positions?.name || 'Poste non défini'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {employee.structures?.name || 'Structure non assignée'}
                    </span>
                    {employee.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {employee.phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Inscrit le {format(parseISO(employee.created_at), 'dd/MM/yyyy')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sites affectés */}
              <div className="border-t lg:border-t-0 lg:border-l pt-4 lg:pt-0 lg:pl-6 w-full lg:w-auto">
                <div className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  Sites attribués :
                </div>
                <div className="flex flex-wrap gap-1.5 max-w-md">
                  {employee.employee_sites && employee.employee_sites.length > 0 ? (
                    employee.employee_sites.map((es) => (
                      <Badge
                        key={es.id}
                        variant={es.is_responsible ? 'default' : 'secondary'}
                        className="text-xs font-normal"
                      >
                        {es.sites?.name || 'Site'}
                        {es.is_responsible && ' (Resp.)'}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      Aucun site rattaché
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ====================================================
         * FILTRES DE PÉRIODE ET SITE
         * ================================================== */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-muted/40 p-3 rounded-lg border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 mr-1">
              <CalendarDays className="h-3.5 w-3.5" /> Période :
            </span>
            <Select
              value={periodFilter}
              onValueChange={(val: any) => setPeriodFilter(val)}
            >
              <SelectTrigger className="w-[170px] h-8 text-xs bg-background">
                <SelectValue placeholder="Période" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tout l'historique</SelectItem>
                <SelectItem value="this_month">Ce mois-ci</SelectItem>
                <SelectItem value="last_month">Mois dernier</SelectItem>
                <SelectItem value="last_3_months">3 derniers mois</SelectItem>
                <SelectItem value="this_year">Cette année</SelectItem>
              </SelectContent>
            </Select>

            {assignedSites.length > 1 && (
              <Select
                value={siteFilter}
                onValueChange={(val) => setSiteFilter(val)}
              >
                <SelectTrigger className="w-[170px] h-8 text-xs bg-background">
                  <SelectValue placeholder="Tous les sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les sites</SelectItem>
                  {assignedSites.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Rechercher date, statut..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>
        </div>

        {/* ====================================================
         * CARTES DE STATISTIQUES (COMPTABILISÉES & SOMMÉES)
         * ================================================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* PRÉSENCES TOTALES */}
          <Card className="border-l-4 border-l-emerald-500 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium">Présences Totales</CardDescription>
                <div className="p-2 rounded-full bg-emerald-500/10 text-emerald-600">
                  <UserCheck className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">
                {stats.totalPresences}{' '}
                <span className="text-xs font-normal text-muted-foreground">jours</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <span className="text-emerald-600 font-medium">
                  {stats.onTimeCount} à l'heure
                </span>
                <span>•</span>
                <span className={stats.totalLateCount > 0 ? 'text-amber-600 font-medium' : ''}>
                  {stats.totalLateCount} en retard
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ABSENCES COMPTABILISÉES ET SOMMÉES */}
          <Card className="border-l-4 border-l-destructive shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium">
                  Absences Comptabilisées
                </CardDescription>
                <div className="p-2 rounded-full bg-destructive/10 text-destructive">
                  <UserX className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-destructive">
                {stats.totalAbsencesSomme}{' '}
                <span className="text-xs font-normal text-muted-foreground">jours sommés</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-xs text-muted-foreground flex flex-col gap-0.5 mt-1">
                <div className="flex items-center justify-between">
                  <span>Congés approuvés :</span>
                  <span className="font-semibold text-foreground">
                    {stats.approvedAbsenceDays} j.
                  </span>
                </div>
                {stats.attendanceAbsentCount > 0 && (
                  <div className="flex items-center justify-between text-destructive">
                    <span>Non pointé / Absent :</span>
                    <span className="font-semibold">{stats.attendanceAbsentCount} j.</span>
                  </div>
                )}
                {stats.pendingAbsenceDays > 0 && (
                  <div className="flex items-center justify-between text-amber-600">
                    <span>En attente validation :</span>
                    <span className="font-semibold">{stats.pendingAbsenceDays} j.</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* RETARDS CUMULÉS */}
          <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium">Retards Cumulés</CardDescription>
                <div className="p-2 rounded-full bg-amber-500/10 text-amber-600">
                  <Clock className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">
                {stats.totalLateCount}{' '}
                <span className="text-xs font-normal text-muted-foreground">fois</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-xs text-muted-foreground flex items-center justify-between mt-1">
                <span>Temps total perdu :</span>
                <span className="font-semibold text-amber-600">
                  {formatMinutes(stats.totalLateMinutes)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* TAUX D'ASSIDUITÉ */}
          <Card className="border-l-4 border-l-blue-500 shadow-sm hover:shadow transition-shadow">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium">Taux de Présence</CardDescription>
                <div className="p-2 rounded-full bg-blue-500/10 text-blue-600">
                  <Activity className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-blue-600">
                {stats.attendanceRate}%
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, Number(stats.attendanceRate)))}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 text-right">
                Présences / Total jours comptabilisés
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ====================================================
         * ONGLETS : HISTORIQUE POINTAGES & ABSENCES DÉCLARÉES
         * ================================================== */}
        <Tabs defaultValue="attendances" className="w-full">
          <TabsList className="grid grid-cols-2 max-w-md mb-4">
            <TabsTrigger value="attendances" className="gap-2">
              <Clock className="h-4 w-4" />
              Historique de Pointage ({filteredAttendances.length})
            </TabsTrigger>
            <TabsTrigger value="absences" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              Déclarations d'Absences ({filteredAbsences.length})
            </TabsTrigger>
          </TabsList>

          {/* ==================================================
           * CONTENU ONGLET 1 : HISTORIQUE DES POINTAGES
           * ================================================= */}
          <TabsContent value="attendances">
            <Card className="border shadow-sm">
              <CardHeader className="p-4 border-b">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Journal chronologique des pointages
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Enregistrements d'arrivées, départs, temps de présence et précisions GPS
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {filteredAttendances.length} entrée(s)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {filteredAttendances.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground space-y-2">
                    <Clock className="h-8 w-8 mx-auto opacity-30" />
                    <p className="text-sm font-medium">Aucun pointage trouvé pour cette période.</p>
                    <p className="text-xs">Modifiez les filtres de période ou le terme de recherche.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[140px]">Date</TableHead>
                          <TableHead>Site</TableHead>
                          <TableHead>Arrivée</TableHead>
                          <TableHead>Départ</TableHead>
                          <TableHead>Durée</TableHead>
                          <TableHead>Retard</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead className="text-right">Détails GPS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAttendances.map((att) => {
                          const isLate = (att.late_minutes && att.late_minutes > 0) || att.validation_status === 'late';
                          const isAbsent = att.validation_status === 'absent' || att.attendance_status === 'absent';
                          const hasCheckedOut = Boolean(att.check_out);
                          const duration = calculateWorkDuration(att.check_in, att.check_out);

                          return (
                            <TableRow key={att.id} className="hover:bg-muted/30 transition-colors">
                              {/* Date */}
                              <TableCell className="font-medium whitespace-nowrap">
                                {format(parseISO(att.attendance_date), 'EEE dd MMM yyyy', { locale: fr })}
                              </TableCell>

                              {/* Site */}
                              <TableCell className="whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 text-xs">
                                  <MapPin className="h-3 w-3 text-muted-foreground" />
                                  {att.site?.name || 'Site non spécifié'}
                                </span>
                              </TableCell>

                              {/* Heure Arrivée */}
                              <TableCell className="whitespace-nowrap">
                                {att.check_in ? (
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-emerald-600">
                                      {format(new Date(att.check_in), 'HH:mm')}
                                    </span>
                                    {att.validation_method && (
                                      <span className="text-[10px] text-muted-foreground capitalize">
                                        {att.validation_method}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </TableCell>

                              {/* Heure Départ */}
                              <TableCell className="whitespace-nowrap">
                                {att.check_out ? (
                                  <span className="font-semibold text-slate-700">
                                    {format(new Date(att.check_out), 'HH:mm')}
                                  </span>
                                ) : att.check_in ? (
                                  <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50">
                                    En cours
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </TableCell>

                              {/* Durée de travail */}
                              <TableCell className="whitespace-nowrap text-xs font-mono">
                                {duration}
                              </TableCell>

                              {/* Retard */}
                              <TableCell className="whitespace-nowrap">
                                {isLate ? (
                                  <Badge variant="destructive" className="text-xs bg-amber-500 hover:bg-amber-600 border-none font-medium">
                                    +{att.late_minutes || 0} min
                                  </Badge>
                                ) : att.check_in ? (
                                  <span className="text-xs text-emerald-600 font-medium">À l'heure</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>

                              {/* Statut Badge */}
                              <TableCell className="whitespace-nowrap">
                                {isAbsent ? (
                                  <Badge variant="destructive" className="text-xs">
                                    Absent
                                  </Badge>
                                ) : isLate ? (
                                  <Badge variant="secondary" className="text-xs text-amber-700 bg-amber-50 border-amber-200">
                                    Retard
                                  </Badge>
                                ) : att.check_in && !hasCheckedOut ? (
                                  <Badge variant="secondary" className="text-xs text-blue-700 bg-blue-50 border-blue-200">
                                    Sur site
                                  </Badge>
                                ) : att.check_in && hasCheckedOut ? (
                                  <Badge variant="default" className="text-xs bg-emerald-600 hover:bg-emerald-700">
                                    Présent
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Inconnu
                                  </Badge>
                                )}
                              </TableCell>

                              {/* Détails GPS */}
                              <TableCell className="text-right whitespace-nowrap text-xs text-muted-foreground">
                                {att.check_in_distance_m !== null ? (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <Navigation className="h-3 w-3 text-primary" />
                                    {Math.round(att.check_in_distance_m)} m
                                    {att.check_in_accuracy_m && ` (±${Math.round(att.check_in_accuracy_m)}m)`}
                                  </span>
                                ) : (
                                  <span>—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================================================
           * CONTENU ONGLET 2 : DÉCLARATIONS D'ABSENCES
           * ================================================= */}
          <TabsContent value="absences">
            <Card className="border shadow-sm">
              <CardHeader className="p-4 border-b">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Déclarations et demandes d'absences
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Congés, permissions, arrêts maladie et motifs déclarés
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {filteredAbsences.length} demande(s)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {filteredAbsences.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground space-y-2">
                    <CalendarDays className="h-8 w-8 mx-auto opacity-30" />
                    <p className="text-sm font-medium">Aucune déclaration d'absence enregistrée.</p>
                    <p className="text-xs">L'employé n'a soumis aucune demande sur cette période.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Période</TableHead>
                          <TableHead>Durée</TableHead>
                          <TableHead>Motif / Justification</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead className="text-right">Décision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAbsences.map((abs) => {
                          const statusConfig = ABSENCE_STATUS_LABELS[abs.status] || {
                            label: abs.status,
                            variant: 'outline' as const,
                          };
                          let durationDays = 1;
                          try {
                            const start = parseISO(abs.start_date);
                            const end = parseISO(abs.end_date);
                            durationDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
                          } catch {
                            durationDays = 1;
                          }

                          return (
                            <TableRow key={abs.id} className="hover:bg-muted/30 transition-colors">
                              {/* Type */}
                              <TableCell className="font-medium whitespace-nowrap">
                                <Badge variant="outline" className="text-xs font-medium">
                                  {ABSENCE_TYPE_LABELS[abs.type] || abs.type}
                                </Badge>
                              </TableCell>

                              {/* Période */}
                              <TableCell className="whitespace-nowrap text-xs">
                                {format(parseISO(abs.start_date), 'dd/MM/yyyy')} au{' '}
                                {format(parseISO(abs.end_date), 'dd/MM/yyyy')}
                              </TableCell>

                              {/* Durée */}
                              <TableCell className="whitespace-nowrap text-xs font-semibold">
                                {durationDays} jour{durationDays > 1 ? 's' : ''}
                              </TableCell>

                              {/* Motif */}
                              <TableCell className="text-xs max-w-xs truncate text-muted-foreground">
                                {abs.reason || 'Aucun motif renseigné'}
                              </TableCell>

                              {/* Statut */}
                              <TableCell className="whitespace-nowrap">
                                <Badge variant={statusConfig.variant} className="text-xs">
                                  {statusConfig.label}
                                </Badge>
                              </TableCell>

                              {/* Décision / Remarques */}
                              <TableCell className="text-right whitespace-nowrap text-xs">
                                {abs.status === 'approved' && abs.approved_at && (
                                  <span className="text-emerald-600 flex items-center justify-end gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Validé le {format(new Date(abs.approved_at), 'dd/MM/yyyy')}
                                  </span>
                                )}
                                {abs.status === 'rejected' && (
                                  <span className="text-destructive flex items-center justify-end gap-1">
                                    <XCircle className="h-3 w-3" />
                                    {abs.rejection_reason || 'Refusé sans motif'}
                                  </span>
                                )}
                                {abs.status === 'pending' && (
                                  <span className="text-muted-foreground italic">
                                    En attente d'approbation
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
