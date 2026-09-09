import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Badge } from '@/components/ui/badge';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Textarea } from '@/components/ui/textarea';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
  Users,
  X,
  XCircle,
} from 'lucide-react';

import { format, differenceInMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';


// ============================================================
// TYPES
// ============================================================

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
}

interface Site {
  id: string;
  name: string;
}

interface AttendanceRow {
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

  client_timestamp: string | null;
  synced_at: string | null;

  employee: Employee | null;
  site: Site | null;
}


// ============================================================
// CONSTANTES
// ============================================================

const PENDING_STATUSES = [
  'out_of_zone',
  'pending_review',
  'low_accuracy',
  'no_gps',
];

const STATUS_LABELS: Record<
  string,
  {
    label: string;
    className: string;
  }
> = {
  valid: {
    label: 'Validé',
    className:
      'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  },

  out_of_zone: {
    label: 'Hors zone',
    className:
      'bg-red-500/10 text-red-700 border-red-200',
  },

  low_accuracy: {
    label: 'GPS imprécis',
    className:
      'bg-amber-500/10 text-amber-700 border-amber-200',
  },

  late: {
    label: 'En retard',
    className:
      'bg-orange-500/10 text-orange-700 border-orange-200',
  },

  no_gps: {
    label: 'Sans GPS',
    className:
      'bg-slate-500/10 text-slate-700 border-slate-200',
  },

  pending_review: {
    label: 'À vérifier',
    className:
      'bg-blue-500/10 text-blue-700 border-blue-200',
  },

  rejected: {
    label: 'Rejeté',
    className:
      'bg-red-500/10 text-red-700 border-red-200',
  },
};


// ============================================================
// HELPERS
// ============================================================

const getStatus = (row: AttendanceRow) => {
  const status = row.validation_status || 'valid';

  return (
    STATUS_LABELS[status] || {
      label: status,
      className:
        'bg-muted text-muted-foreground border-border',
    }
  );
};


const getEmployeeName = (
  employee: Employee | null
) => {
  if (!employee) {
    return 'Employé inconnu';
  }

  return `${employee.first_name} ${employee.last_name}`;
};


const formatTime = (
  value: string | null
) => {
  if (!value) {
    return '—';
  }

  return format(
    new Date(value),
    'HH:mm'
  );
};


const calculateWorkedMinutes = (
  checkIn: string | null,
  checkOut: string | null
) => {
  if (!checkIn || !checkOut) {
    return null;
  }

  return differenceInMinutes(
    new Date(checkOut),
    new Date(checkIn)
  );
};


const formatDuration = (
  minutes: number | null
) => {
  if (minutes === null || minutes < 0) {
    return '—';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes} min`;
  }

  return `${hours}h ${String(
    remainingMinutes
  ).padStart(2, '0')}`;
};


// ============================================================
// COMPONENT
// ============================================================

export default function ManagerAttendanceReview() {
  const { profile, role } = useAuth();

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [rows, setRows] =
    useState<AttendanceRow[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  // ----------------------------------------------------------
  // FILTERS
  // ----------------------------------------------------------

  const [selectedDate, setSelectedDate] =
    useState(
      format(new Date(), 'yyyy-MM-dd')
    );

  const [search, setSearch] =
    useState('');

  const [selectedSite, setSelectedSite] =
    useState('all');

  const [selectedStatus, setSelectedStatus] =
    useState('all');

  const [selectedPresence, setSelectedPresence] =
    useState('all');

  // ----------------------------------------------------------
  // DETAILS
  // ----------------------------------------------------------

  const [selectedRow, setSelectedRow] =
    useState<AttendanceRow | null>(null);

  const [detailsOpen, setDetailsOpen] =
    useState(false);

  // ----------------------------------------------------------
  // REJECTION
  // ----------------------------------------------------------

  const [rejectRow, setRejectRow] =
    useState<AttendanceRow | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] =
    useState(false);

  const [rejectReason, setRejectReason] =
    useState('');

  // ----------------------------------------------------------
  // ACTION
  // ----------------------------------------------------------

  const [processingId, setProcessingId] =
    useState<string | null>(null);

  // ----------------------------------------------------------
  // ERROR
  // ----------------------------------------------------------

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);


  // ==========================================================
  // LOAD ATTENDANCES
  // ==========================================================

  const load = useCallback(
    async (
      silent = false
    ) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setErrorMessage(null);

        /*
         * ------------------------------------------------------
         * IMPORTANT
         *
         * Le manager ne récupère pas lui-même une structure.
         *
         * La RLS de Supabase limite les pointages à sa structure.
         *
         * On filtre ensuite la date côté requête.
         * ------------------------------------------------------
         */

        const {
          data,
          error,
        } = await supabase
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

            client_timestamp,
            synced_at,

            employee:employees (
              id,
              first_name,
              last_name
            ),

            site:sites (
              id,
              name
            )
          `)
          .eq(
            'attendance_date',
            selectedDate
          )
          .order(
            'check_in',
            {
              ascending: true,
              nullsFirst: false,
            }
          );

        if (error) {
          throw error;
        }

        setRows(
          (data as unknown as AttendanceRow[]) ||
          []
        );

      } catch (error: any) {
        console.error(
          'Erreur de chargement des présences :',
          error
        );

        setRows([]);

        setErrorMessage(
          error?.message ||
          'Impossible de charger les présences.'
        );

      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedDate]
  );


  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    if (
      role !== 'manager' &&
      role !== 'admin'
    ) {
      setLoading(false);
      return;
    }

    load();

  }, [
    role,
    load,
  ]);


  // ==========================================================
  // SITES
  // ==========================================================

  const sites = useMemo(() => {
    const map =
      new Map<string, string>();

    rows.forEach((row) => {
      if (
        row.site_id &&
        row.site?.name
      ) {
        map.set(
          row.site_id,
          row.site.name
        );
      }
    });

    return Array.from(
      map.entries()
    ).map(([id, name]) => ({
      id,
      name,
    }));
  }, [rows]);


  // ==========================================================
  // FILTERED ROWS
  // ==========================================================

  const filteredRows = useMemo(() => {
    const normalizedSearch =
      search
        .trim()
        .toLowerCase();

    return rows.filter((row) => {
      // ------------------------------------------------------
      // Recherche
      // ------------------------------------------------------

      if (normalizedSearch) {
        const employeeName =
          getEmployeeName(
            row.employee
          ).toLowerCase();

        const siteName =
          row.site?.name
            ?.toLowerCase() || '';

        if (
          !employeeName.includes(
            normalizedSearch
          ) &&
          !siteName.includes(
            normalizedSearch
          )
        ) {
          return false;
        }
      }

      // ------------------------------------------------------
      // Site
      // ------------------------------------------------------

      if (
        selectedSite !== 'all' &&
        row.site_id !== selectedSite
      ) {
        return false;
      }

      // ------------------------------------------------------
      // Statut
      // ------------------------------------------------------

      if (
        selectedStatus !== 'all' &&
        (
          row.validation_status ||
          'valid'
        ) !== selectedStatus
      ) {
        return false;
      }

      // ------------------------------------------------------
      // Présence
      // ------------------------------------------------------

      if (
        selectedPresence === 'complete' &&
        (
          !row.check_in ||
          !row.check_out
        )
      ) {
        return false;
      }

      if (
        selectedPresence === 'present' &&
        !row.check_in
      ) {
        return false;
      }

      if (
        selectedPresence === 'missing_checkout' &&
        (
          !row.check_in ||
          row.check_out
        )
      ) {
        return false;
      }

      if (
        selectedPresence === 'anomaly' &&
        !PENDING_STATUSES.includes(
          row.validation_status || ''
        )
      ) {
        return false;
      }

      return true;
    });
  }, [
    rows,
    search,
    selectedSite,
    selectedStatus,
    selectedPresence,
  ]);


  // ==========================================================
  // STATISTICS
  // ==========================================================

  const statistics = useMemo(() => {
    const total = rows.length;

    const present = rows.filter(
      (row) => !!row.check_in
    ).length;

    const complete = rows.filter(
      (row) =>
        !!row.check_in &&
        !!row.check_out
    ).length;

    const incomplete = rows.filter(
      (row) =>
        !!row.check_in &&
        !row.check_out
    ).length;

    const anomalies = rows.filter(
      (row) =>
        PENDING_STATUSES.includes(
          row.validation_status || ''
        )
    ).length;

    const rejected = rows.filter(
      (row) =>
        row.validation_status ===
        'rejected'
    ).length;

    const late = rows.filter(
      (row) =>
        row.validation_status ===
        'late'
    ).length;

    return {
      total,
      present,
      complete,
      incomplete,
      anomalies,
      rejected,
      late,
    };
  }, [rows]);


  // ==========================================================
  // LOG ACTION
  // ==========================================================

  const logAction = async (
    row: AttendanceRow,
    action:
      | 'attendance_approved'
      | 'attendance_rejected',
    reason?: string
  ) => {
    if (!profile) {
      return;
    }

    const {
      error,
    } = await supabase
      .from('employee_actions')
      .insert({
        employee_id:
          row.employee_id,

        performed_by:
          profile.id,

        action,

        old_data: {
          validation_status:
            row.validation_status,
        },

        new_data: {
          validation_status:
            action ===
            'attendance_approved'
              ? 'valid'
              : 'rejected',
        },

        reason:
          reason || null,
      });

    if (error) {
      console.error(
        'Erreur historique action :',
        error
      );
    }
  };


  // ==========================================================
  // APPROVE
  // ==========================================================

  const handleApprove = async (
    row: AttendanceRow
  ) => {
    try {
      setProcessingId(row.id);

      const {
        error,
      } = await supabase
        .from('attendances')
        .update({
          validation_status:
            'valid',
        })
        .eq(
          'id',
          row.id
        );

      if (error) {
        throw error;
      }

      await logAction(
        row,
        'attendance_approved'
      );

      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                validation_status:
                  'valid',
              }
            : item
        )
      );

    } catch (error: any) {
      console.error(
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de valider ce pointage.'
      );

    } finally {
      setProcessingId(null);
    }
  };


  // ==========================================================
  // OPEN REJECT
  // ==========================================================

  const openRejectDialog = (
    row: AttendanceRow
  ) => {
    setRejectRow(row);
    setRejectReason('');
    setRejectDialogOpen(true);
  };


  // ==========================================================
  // REJECT
  // ==========================================================

  const handleReject = async () => {
    if (!rejectRow) {
      return;
    }

    try {
      setProcessingId(
        rejectRow.id
      );

      const {
        error,
      } = await supabase
        .from('attendances')
        .update({
          validation_status:
            'rejected',
        })
        .eq(
          'id',
          rejectRow.id
        );

      if (error) {
        throw error;
      }

      await logAction(
        rejectRow,
        'attendance_rejected',
        rejectReason.trim() ||
          undefined
      );

      setRows((current) =>
        current.map((item) =>
          item.id === rejectRow.id
            ? {
                ...item,
                validation_status:
                  'rejected',
              }
            : item
        )
      );

      setRejectDialogOpen(false);
      setRejectRow(null);
      setRejectReason('');

    } catch (error: any) {
      console.error(
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de rejeter ce pointage.'
      );

    } finally {
      setProcessingId(null);
    }
  };


  // ==========================================================
  // RESET FILTERS
  // ==========================================================

  const resetFilters = () => {
    setSearch('');
    setSelectedSite('all');
    setSelectedStatus('all');
    setSelectedPresence('all');
  };


  // ==========================================================
  // ACCESS CONTROL
  // ==========================================================

  if (
    role !== 'manager' &&
    role !== 'admin'
  ) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">
            Vous n'avez pas accès à cette page.
          </p>
        </div>
      </DashboardLayout>
    );
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <DashboardLayout>
      <div className="animate-fade-in space-y-6">

        {/* ==================================================
            HEADER
        ================================================== */}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div>
            <div className="flex items-center gap-3">

              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <Activity className="h-5 w-5 text-primary" />
              </div>

              <div>
                <h1 className="page-title">
                  Suivi des présences
                </h1>

                <p className="text-sm text-muted-foreground">
                  Vue globale des pointages de votre structure
                </p>
              </div>

            </div>
          </div>


          <div className="flex items-center gap-2">

            <Button
              variant="outline"
              onClick={() =>
                load(true)
              }
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing
                    ? 'animate-spin'
                    : ''
                }`}
              />

              Actualiser
            </Button>

          </div>

        </div>


        {/* ==================================================
            ERROR
        ================================================== */}

        {errorMessage && (
          <Alert variant="destructive">

            <AlertTriangle className="h-4 w-4" />

            <AlertTitle>
              Une erreur est survenue
            </AlertTitle>

            <AlertDescription>
              {errorMessage}
            </AlertDescription>

          </Alert>
        )}


        {/* ==================================================
            DATE + STATS
        ================================================== */}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {/* TOTAL */}

          <Card>
            <CardContent className="p-5">

              <div className="flex items-center justify-between">

                <div>
                  <p className="text-sm text-muted-foreground">
                    Pointages
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {statistics.total}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    pour cette journée
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>

              </div>

            </CardContent>
          </Card>


          {/* PRESENTS */}

          <Card>
            <CardContent className="p-5">

              <div className="flex items-center justify-between">

                <div>
                  <p className="text-sm text-muted-foreground">
                    Présents
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {statistics.present}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    avec arrivée enregistrée
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                  <UserCheck className="h-5 w-5 text-emerald-600" />
                </div>

              </div>

            </CardContent>
          </Card>


          {/* INCOMPLETS */}

          <Card>
            <CardContent className="p-5">

              <div className="flex items-center justify-between">

                <div>
                  <p className="text-sm text-muted-foreground">
                    Pointages incomplets
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {statistics.incomplete}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    sans heure de départ
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <Clock3 className="h-5 w-5 text-orange-600" />
                </div>

              </div>

            </CardContent>
          </Card>


          {/* ANOMALIES */}

          <Card>
            <CardContent className="p-5">

              <div className="flex items-center justify-between">

                <div>
                  <p className="text-sm text-muted-foreground">
                    À vérifier
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {statistics.anomalies}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    anomalies détectées
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>

              </div>

            </CardContent>
          </Card>

        </div>


        {/* ==================================================
            FILTER BAR
        ================================================== */}

        <Card>

          <CardHeader className="pb-4">

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

              <div className="flex items-center gap-2">

                <Filter className="h-4 w-4 text-muted-foreground" />

                <CardTitle className="text-base">
                  Filtrer les présences
                </CardTitle>

              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
              >
                Réinitialiser
              </Button>

            </div>

          </CardHeader>


          <CardContent>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">

              {/* DATE */}

              <div className="relative">

                <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(event) =>
                    setSelectedDate(
                      event.target.value
                    )
                  }
                  className="pl-9"
                />

              </div>


              {/* SEARCH */}

              <div className="relative lg:col-span-2">

                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  placeholder="Rechercher un employé ou un site..."
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value
                    )
                  }
                  className="pl-9"
                />

              </div>


              {/* SITE */}

              <Select
                value={selectedSite}
                onValueChange={
                  setSelectedSite
                }
              >

                <SelectTrigger>
                  <SelectValue placeholder="Tous les sites" />
                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="all">
                    Tous les sites
                  </SelectItem>

                  {sites.map(
                    (site) => (
                      <SelectItem
                        key={site.id}
                        value={site.id}
                      >
                        {site.name}
                      </SelectItem>
                    )
                  )}

                </SelectContent>

              </Select>


              {/* STATUS */}

              <Select
                value={selectedStatus}
                onValueChange={
                  setSelectedStatus
                }
              >

                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="all">
                    Tous les statuts
                  </SelectItem>

                  <SelectItem value="valid">
                    Validé
                  </SelectItem>

                  <SelectItem value="late">
                    En retard
                  </SelectItem>

                  <SelectItem value="out_of_zone">
                    Hors zone
                  </SelectItem>

                  <SelectItem value="low_accuracy">
                    GPS imprécis
                  </SelectItem>

                  <SelectItem value="no_gps">
                    Sans GPS
                  </SelectItem>

                  <SelectItem value="pending_review">
                    À vérifier
                  </SelectItem>

                  <SelectItem value="rejected">
                    Rejeté
                  </SelectItem>

                </SelectContent>

              </Select>

            </div>


            {/* SECOND FILTER ROW */}

            <div className="mt-3 flex flex-wrap gap-2">

              <Button
                size="sm"
                variant={
                  selectedPresence === 'all'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSelectedPresence('all')
                }
              >
                Tous
              </Button>

              <Button
                size="sm"
                variant={
                  selectedPresence === 'present'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSelectedPresence(
                    'present'
                  )
                }
              >
                Présents
              </Button>

              <Button
                size="sm"
                variant={
                  selectedPresence === 'complete'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSelectedPresence(
                    'complete'
                  )
                }
              >
                Journées complètes
              </Button>

              <Button
                size="sm"
                variant={
                  selectedPresence === 'missing_checkout'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSelectedPresence(
                    'missing_checkout'
                  )
                }
              >
                Sans départ
              </Button>

              <Button
                size="sm"
                variant={
                  selectedPresence === 'anomaly'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSelectedPresence(
                    'anomaly'
                  )
                }
              >
                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                Anomalies
              </Button>

            </div>

          </CardContent>

        </Card>


        {/* ==================================================
            RESULTS HEADER
        ================================================== */}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

          <div>

            <h2 className="font-semibold">
              Pointages du{' '}
              {format(
                new Date(
                  `${selectedDate}T00:00:00`
                ),
                'EEEE dd MMMM yyyy',
                {
                  locale: fr,
                }
              )}
            </h2>

            <p className="text-sm text-muted-foreground">
              {filteredRows.length} résultat(s)
              {filteredRows.length !== rows.length &&
                ` sur ${rows.length}`}
            </p>

          </div>

        </div>


        {/* ==================================================
            EMPTY
        ================================================== */}

        {filteredRows.length === 0 ? (

          <Card>

            <CardContent className="flex flex-col items-center justify-center py-16 text-center">

              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">

                <UserX className="h-6 w-6 text-muted-foreground" />

              </div>

              <h3 className="font-semibold">
                Aucun pointage trouvé
              </h3>

              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Aucun pointage ne correspond aux
                filtres sélectionnés pour cette journée.
              </p>

              <Button
                variant="outline"
                className="mt-4"
                onClick={resetFilters}
              >
                Réinitialiser les filtres
              </Button>

            </CardContent>

          </Card>

        ) : (

          <>
            {/* ==================================================
                DESKTOP TABLE
            ================================================== */}

            <Card className="hidden overflow-hidden lg:block">

              <div className="overflow-x-auto">

                <table className="w-full">

                  <thead>

                    <tr className="border-b bg-muted/30">

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Employé
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Site
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Arrivée
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Départ
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Durée
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        GPS
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Statut
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Action
                      </th>

                    </tr>

                  </thead>


                  <tbody>

                    {filteredRows.map(
                      (row) => {

                        const status =
                          getStatus(row);

                        const workedMinutes =
                          calculateWorkedMinutes(
                            row.check_in,
                            row.check_out
                          );

                        const isPending =
                          PENDING_STATUSES.includes(
                            row.validation_status || ''
                          );

                        return (
                          <tr
                            key={row.id}
                            className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                          >

                            {/* EMPLOYEE */}

                            <td className="px-4 py-3">

                              <div className="flex items-center gap-3">

                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">

                                  <span className="text-xs font-semibold text-primary">
                                    {row.employee?.first_name?.[0] || '?'}
                                    {row.employee?.last_name?.[0] || ''}
                                  </span>

                                </div>

                                <div>

                                  <p className="text-sm font-medium">
                                    {getEmployeeName(
                                      row.employee
                                    )}
                                  </p>

                                  <p className="text-xs text-muted-foreground">
                                    {row.employee_id.slice(
                                      0,
                                      8
                                    )}
                                  </p>

                                </div>

                              </div>

                            </td>


                            {/* SITE */}

                            <td className="px-4 py-3">

                              <div className="flex items-center gap-2 text-sm">

                                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />

                                {row.site?.name || '—'}

                              </div>

                            </td>


                            {/* CHECK IN */}

                            <td className="px-4 py-3">

                              <div className="flex items-center gap-2">

                                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10">

                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />

                                </div>

                                <span className="text-sm font-medium">
                                  {formatTime(
                                    row.check_in
                                  )}
                                </span>

                              </div>

                            </td>


                            {/* CHECK OUT */}

                            <td className="px-4 py-3">

                              <div className="flex items-center gap-2">

                                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">

                                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />

                                </div>

                                <span className="text-sm font-medium">
                                  {formatTime(
                                    row.check_out
                                  )}
                                </span>

                              </div>

                            </td>


                            {/* DURATION */}

                            <td className="px-4 py-3">

                              <span className="text-sm">
                                {formatDuration(
                                  workedMinutes
                                )}
                              </span>

                            </td>


                            {/* GPS */}

                            <td className="px-4 py-3">

                              {row.check_in_distance_m != null ? (

                                <div>

                                  <p className="text-sm font-medium">
                                    {Math.round(
                                      row.check_in_distance_m
                                    )}{' '}
                                    m
                                  </p>

                                  {row.check_in_accuracy_m != null && (
                                    <p className="text-xs text-muted-foreground">
                                      ±
                                      {Math.round(
                                        row.check_in_accuracy_m
                                      )}{' '}
                                      m
                                    </p>
                                  )}

                                </div>

                              ) : (

                                <span className="text-sm text-muted-foreground">
                                  —
                                </span>

                              )}

                            </td>


                            {/* STATUS */}

                            <td className="px-4 py-3">

                              <Badge
                                variant="outline"
                                className={status.className}
                              >
                                {status.label}
                              </Badge>

                            </td>


                            {/* ACTION */}

                            <td className="px-4 py-3 text-right">

                              <div className="flex justify-end gap-1">

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Voir les détails"
                                  onClick={() => {
                                    setSelectedRow(row);
                                    setDetailsOpen(true);
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>

                                {isPending && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Valider"
                                      disabled={
                                        processingId ===
                                        row.id
                                      }
                                      onClick={() =>
                                        handleApprove(
                                          row
                                        )
                                      }
                                    >
                                      <Check className="h-4 w-4 text-emerald-600" />
                                    </Button>

                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Rejeter"
                                      disabled={
                                        processingId ===
                                        row.id
                                      }
                                      onClick={() =>
                                        openRejectDialog(
                                          row
                                        )
                                      }
                                    >
                                      <X className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}

                              </div>

                            </td>

                          </tr>
                        );
                      }
                    )}

                  </tbody>

                </table>

              </div>

            </Card>


            {/* ==================================================
                MOBILE / TABLET
            ================================================== */}

            <div className="space-y-3 lg:hidden">

              {filteredRows.map(
                (row) => {

                  const status =
                    getStatus(row);

                  const workedMinutes =
                    calculateWorkedMinutes(
                      row.check_in,
                      row.check_out
                    );

                  const isPending =
                    PENDING_STATUSES.includes(
                      row.validation_status || ''
                    );

                  return (
                    <Card key={row.id}>

                      <CardContent className="p-4">

                        <div className="flex items-start justify-between gap-3">

                          <div className="flex items-center gap-3">

                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">

                              <span className="text-xs font-semibold text-primary">
                                {row.employee?.first_name?.[0] || '?'}
                                {row.employee?.last_name?.[0] || ''}
                              </span>

                            </div>

                            <div>

                              <p className="font-medium">
                                {getEmployeeName(
                                  row.employee
                                )}
                              </p>

                              <p className="flex items-center gap-1 text-xs text-muted-foreground">

                                <MapPin className="h-3 w-3" />

                                {row.site?.name ||
                                  'Site non renseigné'}

                              </p>

                            </div>

                          </div>

                          <Badge
                            variant="outline"
                            className={status.className}
                          >
                            {status.label}
                          </Badge>

                        </div>


                        <div className="mt-4 grid grid-cols-3 gap-3">

                          <div className="rounded-lg bg-muted/40 p-3">

                            <p className="text-xs text-muted-foreground">
                              Arrivée
                            </p>

                            <p className="mt-1 font-semibold">
                              {formatTime(
                                row.check_in
                              )}
                            </p>

                          </div>


                          <div className="rounded-lg bg-muted/40 p-3">

                            <p className="text-xs text-muted-foreground">
                              Départ
                            </p>

                            <p className="mt-1 font-semibold">
                              {formatTime(
                                row.check_out
                              )}
                            </p>

                          </div>


                          <div className="rounded-lg bg-muted/40 p-3">

                            <p className="text-xs text-muted-foreground">
                              Durée
                            </p>

                            <p className="mt-1 font-semibold">
                              {formatDuration(
                                workedMinutes
                              )}
                            </p>

                          </div>

                        </div>


                        <div className="mt-3 flex items-center justify-between">

                          <div className="text-xs text-muted-foreground">

                            {row.check_in_distance_m != null
                              ? `GPS : ${Math.round(
                                  row.check_in_distance_m
                                )} m`
                              : 'GPS : —'}

                          </div>


                          <div className="flex gap-1">

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedRow(row);
                                setDetailsOpen(true);
                              }}
                            >
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              Détails
                            </Button>

                            {isPending && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={
                                    processingId ===
                                    row.id
                                  }
                                  onClick={() =>
                                    handleApprove(
                                      row
                                    )
                                  }
                                >
                                  <Check className="h-4 w-4 text-emerald-600" />
                                </Button>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={
                                    processingId ===
                                    row.id
                                  }
                                  onClick={() =>
                                    openRejectDialog(
                                      row
                                    )
                                  }
                                >
                                  <X className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}

                          </div>

                        </div>

                      </CardContent>

                    </Card>
                  );
                }
              )}

            </div>
          </>
        )}


        {/* ==================================================
            DETAILS DIALOG
        ================================================== */}

        <Dialog
          open={detailsOpen}
          onOpenChange={
            setDetailsOpen
          }
        >

          <DialogContent className="max-w-2xl">

            <DialogHeader>

              <DialogTitle>
                Détails du pointage
              </DialogTitle>

              <DialogDescription>
                Informations détaillées concernant
                le pointage sélectionné.
              </DialogDescription>

            </DialogHeader>


            {selectedRow && (

              <div className="space-y-5">

                {/* EMPLOYEE */}

                <div className="rounded-lg border p-4">

                  <div className="flex items-center gap-3">

                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">

                      <span className="font-semibold text-primary">
                        {selectedRow.employee?.first_name?.[0] || '?'}
                        {selectedRow.employee?.last_name?.[0] || ''}
                      </span>

                    </div>

                    <div>

                      <p className="font-semibold">
                        {getEmployeeName(
                          selectedRow.employee
                        )}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {selectedRow.site?.name ||
                          'Site non renseigné'}
                      </p>

                    </div>

                  </div>

                </div>


                {/* HOURS */}

                <div className="grid grid-cols-2 gap-3">

                  <div className="rounded-lg border p-4">

                    <p className="text-sm text-muted-foreground">
                      Arrivée
                    </p>

                    <p className="mt-1 text-xl font-semibold">
                      {formatTime(
                        selectedRow.check_in
                      )}
                    </p>

                  </div>

                  <div className="rounded-lg border p-4">

                    <p className="text-sm text-muted-foreground">
                      Départ
                    </p>

                    <p className="mt-1 text-xl font-semibold">
                      {formatTime(
                        selectedRow.check_out
                      )}
                    </p>

                  </div>

                </div>


                {/* GPS */}

                <div className="rounded-lg border p-4">

                  <div className="mb-3 flex items-center gap-2">

                    <MapPin className="h-4 w-4 text-primary" />

                    <p className="font-medium">
                      Informations GPS
                    </p>

                  </div>


                  <div className="grid gap-3 sm:grid-cols-3">

                    <div>

                      <p className="text-xs text-muted-foreground">
                        Distance
                      </p>

                      <p className="font-medium">
                        {selectedRow.check_in_distance_m != null
                          ? `${Math.round(
                              selectedRow.check_in_distance_m
                            )} m`
                          : '—'}
                      </p>

                    </div>


                    <div>

                      <p className="text-xs text-muted-foreground">
                        Précision
                      </p>

                      <p className="font-medium">
                        {selectedRow.check_in_accuracy_m != null
                          ? `±${Math.round(
                              selectedRow.check_in_accuracy_m
                            )} m`
                          : '—'}
                      </p>

                    </div>


                    <div>

                      <p className="text-xs text-muted-foreground">
                        Méthode
                      </p>

                      <p className="font-medium">
                        {selectedRow.validation_method ||
                          '—'}
                      </p>

                    </div>

                  </div>

                </div>


                {/* STATUS */}

                <div className="flex items-center justify-between rounded-lg border p-4">

                  <div>

                    <p className="text-sm text-muted-foreground">
                      Statut du pointage
                    </p>

                    <div className="mt-1">

                      <Badge
                        variant="outline"
                        className={
                          getStatus(
                            selectedRow
                          ).className
                        }
                      >
                        {
                          getStatus(
                            selectedRow
                          ).label
                        }
                      </Badge>

                    </div>

                  </div>

                  <div className="text-right">

                    <p className="text-sm text-muted-foreground">
                      Durée travaillée
                    </p>

                    <p className="mt-1 font-semibold">
                      {formatDuration(
                        calculateWorkedMinutes(
                          selectedRow.check_in,
                          selectedRow.check_out
                        )
                      )}
                    </p>

                  </div>

                </div>


                {/* SYNCHRONISATION */}

                {(selectedRow.client_timestamp ||
                  selectedRow.synced_at) && (

                  <div className="rounded-lg bg-muted/40 p-4 text-sm">

                    <p className="font-medium">
                      Synchronisation
                    </p>

                    {selectedRow.client_timestamp && (
                      <p className="mt-1 text-muted-foreground">
                        Horodatage appareil :{' '}
                        {format(
                          new Date(
                            selectedRow.client_timestamp
                          ),
                          'dd/MM/yyyy HH:mm'
                        )}
                      </p>
                    )}

                    {selectedRow.synced_at && (
                      <p className="text-muted-foreground">
                        Synchronisé :{' '}
                        {format(
                          new Date(
                            selectedRow.synced_at
                          ),
                          'dd/MM/yyyy HH:mm'
                        )}
                      </p>
                    )}

                  </div>

                )}

              </div>

            )}

            <DialogFooter>

              {selectedRow &&
                PENDING_STATUSES.includes(
                  selectedRow.validation_status || ''
                ) && (
                  <>

                    <Button
                      variant="outline"
                      onClick={() => {
                        setDetailsOpen(false);
                        openRejectDialog(
                          selectedRow
                        );
                      }}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Rejeter
                    </Button>

                    <Button
                      onClick={async () => {
                        await handleApprove(
                          selectedRow
                        );
                        setDetailsOpen(false);
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Valider
                    </Button>

                  </>
                )}

            </DialogFooter>

          </DialogContent>

        </Dialog>


        {/* ==================================================
            REJECT DIALOG
        ================================================== */}

        <Dialog
          open={rejectDialogOpen}
          onOpenChange={
            setRejectDialogOpen
          }
        >

          <DialogContent>

            <DialogHeader>

              <DialogTitle>
                Rejeter ce pointage ?
              </DialogTitle>

              <DialogDescription>

                {rejectRow && (
                  <>
                    Le pointage de{' '}
                    <strong>
                      {getEmployeeName(
                        rejectRow.employee
                      )}
                    </strong>{' '}
                    sera marqué comme rejeté.
                  </>
                )}

              </DialogDescription>

            </DialogHeader>


            <div className="space-y-2">

              <label className="text-sm font-medium">
                Motif du rejet
              </label>

              <Textarea
                placeholder="Expliquez pourquoi ce pointage est rejeté..."
                value={rejectReason}
                onChange={(event) =>
                  setRejectReason(
                    event.target.value
                  )
                }
              />

              <p className="text-xs text-muted-foreground">
                Le motif sera conservé dans l'historique
                des actions administratives.
              </p>

            </div>


            <DialogFooter>

              <Button
                variant="outline"
                onClick={() =>
                  setRejectDialogOpen(
                    false
                  )
                }
                disabled={
                  processingId !== null
                }
              >
                Annuler
              </Button>

              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={
                  processingId !== null
                }
              >

                {processingId !== null ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}

                Confirmer le rejet

              </Button>

            </DialogFooter>

          </DialogContent>

        </Dialog>

      </div>
    </DashboardLayout>
  );
}
