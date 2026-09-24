import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  UserCheck,
  UserX,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import DashboardLayout from '@/components/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Site {
  id: string;
  name: string;
  type: string;
  address: string | null;
  work_start: string | null;
  work_end: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  position_id: string | null;
  site_id: string | null;
  is_active: boolean;
}

interface Attendance {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  late_minutes: number | null;
  attendance_status: string | null;
  validation_status: string | null;
}

interface Absence {
  id: string;
  employee_id: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
}

interface EmployeeRow extends Employee {
  attendance?: Attendance;
  absence?: Absence;
}

interface EmployeeSiteAssignment {
  employee_id: string;
  is_responsible: boolean;
  is_active: boolean;
}

type EmployeeStatus = {
  label: string;
  className: string;
};

function getLocalDate(): string {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export default function ResponsableSite() {
  const { profile, role } = useAuth();

  const [site, setSite] = useState<Site | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);

  const [selectedDate, setSelectedDate] = useState(getLocalDate());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * ============================================================
   * CHARGEMENT DU DASHBOARD
   * ============================================================
   *
   * Architecture :
   *
   * responsable
   *      ↓
   * employee_sites
   *      ↓
   * site_id
   *      ↓
   * employee_sites du site
   *      ↓
   * employee_id[]
   *      ↓
   * employees
   *      ↓
   * attendances / employee_absences
   *
   * IMPORTANT :
   * employee_sites est la source de vérité pour déterminer
   * les employés affectés au site.
   *
   * employees.site_id n'est PAS utilisé pour déterminer
   * l'appartenance au site.
   */
  const loadDashboard = useCallback(async () => {
    if (!profile?.id) {
      return;
    }

    try {
      setError(null);

      /*
       * ========================================================
       * 1. TROUVER LE SITE DONT L'UTILISATEUR EST RESPONSABLE
       * ========================================================
       */

      const {
        data: responsibleAssignment,
        error: responsibleError,
      } = await supabase
        .from('employee_sites')
        .select('site_id')
        .eq('employee_id', profile.id)
        .eq('is_responsible', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (responsibleError) {
        throw new Error(
          `Impossible de récupérer votre affectation : ${responsibleError.message}`
        );
      }

      /*
       * Aucun site responsable.
       */
      if (!responsibleAssignment?.site_id) {
        setSite(null);
        setEmployees([]);
        setAttendances([]);
        setAbsences([]);
        return;
      }

      const siteId = responsibleAssignment.site_id;

      /*
       * ========================================================
       * 2. RÉCUPÉRER LES INFORMATIONS DU SITE
       * ========================================================
       */

      const { data: siteData, error: siteError } = await supabase
        .from('sites')
        .select(`
          id,
          name,
          type,
          address,
          work_start,
          work_end,
          timezone,
          latitude,
          longitude
        `)
        .eq('id', siteId)
        .maybeSingle();

      if (siteError) {
        throw new Error(
          `Impossible de récupérer le site : ${siteError.message}`
        );
      }

      if (!siteData) {
        throw new Error(
          'Le site auquel vous êtes affecté est introuvable.'
        );
      }

      setSite(siteData);

      /*
       * ========================================================
       * 3. RÉCUPÉRER LES AFFECTATIONS DU SITE
       * ========================================================
       *
       * IMPORTANT :
       *
       * On utilise employee_sites et non employees.site_id.
       *
       * Exemple :
       *
       * employee_sites
       * ------------------------------------
       * employé A → site X → active
       * employé B → site X → active
       * employé C → site X → inactive
       *
       * Résultat :
       * A et B seulement.
       */

      const {
        data: assignments,
        error: assignmentsError,
      } = await supabase
        .from('employee_sites')
        .select(`
          employee_id,
          is_responsible,
          is_active
        `)
        .eq('site_id', siteId)
        .eq('is_active', true);

      if (assignmentsError) {
        throw new Error(
          `Impossible de récupérer les affectations du site : ${assignmentsError.message}`
        );
      }

      const siteAssignments: EmployeeSiteAssignment[] =
        (assignments ?? []) as EmployeeSiteAssignment[];

      /*
       * ========================================================
       * 4. EXTRAIRE LES IDS DES EMPLOYÉS
       * ========================================================
       */

      const employeeIds = Array.from(
        new Set(
          siteAssignments
            .map((assignment) => assignment.employee_id)
            .filter(
              (employeeId): employeeId is string =>
                typeof employeeId === 'string' &&
                employeeId.length > 0
            )
        )
      );

      /*
       * ========================================================
       * 5. RETIRER LE RESPONSABLE LUI-MÊME
       * ========================================================
       *
       * Le responsable supervise les autres employés du site.
       *
       * Si tu souhaites afficher également le responsable,
       * supprime simplement cette ligne.
       */

      const supervisedEmployeeIds = employeeIds.filter(
        (employeeId) => employeeId !== profile.id
      );

      /*
       * ========================================================
       * 6. AUCUN AUTRE EMPLOYÉ
       * ========================================================
       */

      if (supervisedEmployeeIds.length === 0) {
        setEmployees([]);
        setAttendances([]);
        setAbsences([]);

        console.log('[RESPONSABLE SITE] Aucun autre employé', {
          responsableId: profile.id,
          siteId,
          siteName: siteData.name,
          assignmentsCount: siteAssignments.length,
        });

        return;
      }

      /*
       * ========================================================
       * 7. RÉCUPÉRER LES EMPLOYÉS
       * ========================================================
       *
       * La requête utilise uniquement les IDs provenant
       * de employee_sites.
       *
       * On ne fait PAS :
       *
       * .eq('site_id', siteId)
       *
       * car employee_sites est notre source de vérité.
       */

      const {
        data: employeeData,
        error: employeesError,
      } = await supabase
        .from('employees')
        .select(`
          id,
          first_name,
          last_name,
          phone,
          position_id,
          site_id,
          is_active
        `)
        .in('id', supervisedEmployeeIds)
        .eq('is_active', true)
        .order('last_name', {
          ascending: true,
        });

      if (employeesError) {
        throw new Error(
          `Impossible de récupérer les employés : ${employeesError.message}`
        );
      }

      /*
       * On force le typage.
       */
      const activeEmployees = (employeeData ?? []) as Employee[];

      /*
       * Protection supplémentaire contre les doublons.
       */
      const uniqueEmployees = Array.from(
        new Map(
          activeEmployees.map((employee) => [
            employee.id,
            employee,
          ])
        ).values()
      );

      setEmployees(uniqueEmployees);

      /*
       * ========================================================
       * DEBUG
       * ========================================================
       */

      console.log('[RESPONSABLE SITE] Chargement', {
        responsableId: profile.id,

        siteId,

        siteName: siteData.name,

        assignmentsCount: siteAssignments.length,

        assignedEmployeeIds: employeeIds,

        supervisedEmployeeIds,

        employeesCount: uniqueEmployees.length,

        employees: uniqueEmployees.map((employee) => ({
          id: employee.id,
          name: `${employee.first_name} ${employee.last_name}`,
          site_id: employee.site_id,
          is_active: employee.is_active,
        })),
      });

      /*
       * ========================================================
       * 8. PRÉSENCES
       * ========================================================
       *
       * On récupère les présences du site pour la date.
       *
       * Puis on filtre avec les IDs des employés réellement
       * supervisés.
       */

      const {
        data: attendanceData,
        error: attendanceError,
      } = await supabase
        .from('attendances')
        .select(`
          id,
          employee_id,
          attendance_date,
          check_in,
          check_out,
          late_minutes,
          attendance_status,
          validation_status
        `)
        .eq('site_id', siteId)
        .eq('attendance_date', selectedDate);

      if (attendanceError) {
        throw new Error(
          `Impossible de récupérer les présences : ${attendanceError.message}`
        );
      }

      const employeeIdSet = new Set(
        supervisedEmployeeIds
      );

      const siteAttendances = (
        attendanceData ?? []
      ).filter((attendance) =>
        employeeIdSet.has(attendance.employee_id)
      );

      setAttendances(siteAttendances);

      /*
       * ========================================================
       * 9. ABSENCES
       * ========================================================
       *
       * Une absence concerne la journée si :
       *
       * start_date <= selectedDate
       * ET
       * end_date >= selectedDate
       *
       * On ne récupère que les absences approuvées.
       */

      const {
        data: absenceData,
        error: absenceError,
      } = await supabase
        .from('employee_absences')
        .select(`
          id,
          employee_id,
          type,
          start_date,
          end_date,
          reason,
          status
        `)
        .in('employee_id', supervisedEmployeeIds)
        .lte('start_date', selectedDate)
        .gte('end_date', selectedDate)
        .eq('status', 'approved');

      if (absenceError) {
        throw new Error(
          `Impossible de récupérer les absences : ${absenceError.message}`
        );
      }

      const siteAbsences = (
        absenceData ?? []
      ).filter((absence) =>
        employeeIdSet.has(absence.employee_id)
      );

      setAbsences(siteAbsences);

      /*
       * ========================================================
       * DEBUG FINAL
       * ========================================================
       */

      console.log('[RESPONSABLE SITE] Données finales', {
        siteId,
        siteName: siteData.name,
        employees: uniqueEmployees.length,
        attendances: siteAttendances.length,
        absences: siteAbsences.length,
        selectedDate,
      });
    } catch (err) {
      console.error(
        'Erreur ResponsableSite:',
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : 'Une erreur est survenue lors du chargement des données.'
      );

      /*
       * On évite d'afficher d'anciennes données si le
       * chargement courant échoue.
       */
      setEmployees([]);
      setAttendances([]);
      setAbsences([]);
    }
  }, [profile?.id, selectedDate]);

  /*
   * ============================================================
   * CHARGEMENT INITIAL + CHANGEMENT DE DATE
   * ============================================================
   */

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!profile?.id) {
        if (mounted) {
          setLoading(false);
        }

        return;
      }

      if (mounted) {
        setLoading(true);
      }

      await loadDashboard();

      if (mounted) {
        setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [profile?.id, loadDashboard]);

  /*
   * ============================================================
   * RAFRAÎCHISSEMENT
   * ============================================================
   */

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await loadDashboard();
    } finally {
      setRefreshing(false);
    }
  };

  /*
   * ============================================================
   * ASSOCIATION EMPLOYÉ / PRÉSENCE / ABSENCE
   * ============================================================
   */

  const employeeRows = useMemo<EmployeeRow[]>(() => {
    const attendanceMap =
      new Map<string, Attendance>();

    for (const attendance of attendances) {
      attendanceMap.set(
        attendance.employee_id,
        attendance
      );
    }

    const absenceMap =
      new Map<string, Absence>();

    for (const absence of absences) {
      absenceMap.set(
        absence.employee_id,
        absence
      );
    }

    return employees.map((employee) => ({
      ...employee,
      attendance: attendanceMap.get(
        employee.id
      ),
      absence: absenceMap.get(
        employee.id
      ),
    }));
  }, [
    employees,
    attendances,
    absences,
  ]);

  /*
   * ============================================================
   * STATISTIQUES
   * ============================================================
   */

  const statistics = useMemo(() => {
    const present =
      employeeRows.filter(
        (employee) =>
          !!employee.attendance?.check_in &&
          !employee.absence
      ).length;

    const late =
      employeeRows.filter(
        (employee) =>
          !!employee.attendance?.check_in &&
          !employee.absence &&
          (employee.attendance
            ?.late_minutes ?? 0) > 0
      ).length;

    const authorizedAbsence =
      employeeRows.filter(
        (employee) =>
          !!employee.absence
      ).length;

    const absent =
      employeeRows.filter(
        (employee) =>
          !employee.attendance?.check_in &&
          !employee.absence
      ).length;

    return {
      total: employeeRows.length,
      present,
      late,
      absent,
      authorizedAbsence,
    };
  }, [employeeRows]);

  /*
   * ============================================================
   * FORMATAGE HEURE
   * ============================================================
   */

  const formatTime = (
    value?: string | null
  ) => {
    if (!value) {
      return '—';
    }

    try {
      return new Date(
        value
      ).toLocaleTimeString(
        'fr-FR',
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    } catch {
      return '—';
    }
  };

  /*
   * ============================================================
   * FORMATAGE DATE
   * ============================================================
   */

  const formatDate = (
    value: string
  ) => {
    return new Date(
      `${value}T00:00:00`
    ).toLocaleDateString(
      'fr-FR',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }
    );
  };

  /*
   * ============================================================
   * STATUT EMPLOYÉ
   * ============================================================
   */

  const getEmployeeStatus = (
    employee: EmployeeRow
  ): EmployeeStatus => {
    /*
     * Priorité :
     * 1. Absence autorisée
     * 2. Absent
     * 3. En retard
     * 4. Présent
     */

    if (employee.absence) {
      return {
        label: 'Absence autorisée',
        className:
          'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
      };
    }

    if (!employee.attendance?.check_in) {
      return {
        label: 'Absent',
        className:
          'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
      };
    }

    if (
      (employee.attendance
        .late_minutes ?? 0) > 0
    ) {
      return {
        label: 'En retard',
        className:
          'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
      };
    }

    return {
      label: 'Présent',
      className:
        'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    };
  };

  /*
   * ============================================================
   * PROTECTION INTERFACE
   * ============================================================
   */

  if (role !== 'employee') {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="rounded-xl border bg-card p-6">
            Cette interface est réservée
            aux responsables de site.
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /*
   * ============================================================
   * CHARGEMENT INITIAL
   * ============================================================
   */

  if (loading && !site) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  /*
   * ============================================================
   * ERREUR
   * ============================================================
   */

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">

            <div className="font-semibold">
              Impossible de charger la gestion du site
            </div>

            <p className="mt-2 text-sm">
              {error}
            </p>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/50"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing
                    ? 'animate-spin'
                    : ''
                }`}
              />

              Réessayer
            </button>

          </div>
        </div>
      </DashboardLayout>
    );
  }

  /*
   * ============================================================
   * AUCUN SITE
   * ============================================================
   */

  if (!site) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="rounded-xl border bg-card p-8 text-center">

            <MapPin className="mx-auto mb-4 h-10 w-10 opacity-50" />

            <h2 className="text-lg font-semibold">
              Aucun site responsable
            </h2>

            <p className="mt-2 text-sm text-muted-foreground">
              Vous n'êtes actuellement responsable
              d'aucun site.
            </p>

          </div>
        </div>
      </DashboardLayout>
    );
  }

  /*
   * ============================================================
   * INTERFACE PRINCIPALE
   * ============================================================
   */

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">

        {/* =====================================================
            EN-TÊTE
        ====================================================== */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

          <div>
            <div className="flex items-center gap-2">

              <Building2 className="h-6 w-6" />

              <h1 className="text-2xl font-bold">
                Gestion du site
              </h1>

            </div>

            <p className="mt-1 text-muted-foreground">
              Suivi quotidien des employés
              et des présences.
            </p>
          </div>

          <div className="flex items-center gap-2">

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing
                    ? 'animate-spin'
                    : ''
                }`}
              />

              Actualiser
            </button>

            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">

              <CalendarDays className="h-4 w-4" />

              <input
                type="date"
                value={selectedDate}
                onChange={(event) =>
                  setSelectedDate(
                    event.target.value
                  )
                }
                className="bg-transparent text-sm outline-none"
              />

            </div>

          </div>
        </div>

        {/* =====================================================
            INFORMATIONS DU SITE
        ====================================================== */}

        <div className="rounded-xl border bg-card p-6">

          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">

            <div>

              <div className="flex items-center gap-2">

                <Building2 className="h-5 w-5 text-primary" />

                <h2 className="text-xl font-semibold">
                  {site.name}
                </h2>

              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                {site.type || 'Site'}
              </p>

              {site.address && (
                <div className="mt-3 flex items-center gap-2 text-sm">

                  <MapPin className="h-4 w-4" />

                  {site.address}

                </div>
              )}

            </div>

            <div className="rounded-lg bg-muted px-4 py-3 text-sm">

              <div className="flex items-center gap-2 font-medium">

                <Clock className="h-4 w-4" />

                Horaires

              </div>

              <div className="mt-1 text-muted-foreground">

                {site.work_start ?? '—'}

                {' → '}

                {site.work_end ?? '—'}

              </div>

            </div>

          </div>

        </div>

        {/* =====================================================
            STATISTIQUES
        ====================================================== */}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

          <StatCard
            title="Employés"
            value={statistics.total}
            icon={
              <Users className="h-5 w-5" />
            }
          />

          <StatCard
            title="Présents"
            value={statistics.present}
            icon={
              <UserCheck className="h-5 w-5" />
            }
          />

          <StatCard
            title="En retard"
            value={statistics.late}
            icon={
              <AlertTriangle className="h-5 w-5" />
            }
          />

          <StatCard
            title="Absents"
            value={statistics.absent}
            icon={
              <UserX className="h-5 w-5" />
            }
          />

          <StatCard
            title="Absences autorisées"
            value={statistics.authorizedAbsence}
            icon={
              <CalendarDays className="h-5 w-5" />
            }
          />

        </div>

        {/* =====================================================
            TABLEAU DES EMPLOYÉS
        ====================================================== */}

        <div className="rounded-xl border bg-card">

          <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">

            <div>

              <h2 className="font-semibold">
                Présence des employés
              </h2>

              <p className="text-sm text-muted-foreground">
                {formatDate(selectedDate)}
              </p>

            </div>

            <Clock className="h-5 w-5 text-muted-foreground" />

          </div>

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead>

                <tr className="border-b bg-muted/40 text-left text-sm">

                  <th className="px-5 py-3 font-medium">
                    Employé
                  </th>

                  <th className="px-5 py-3 font-medium">
                    Arrivée
                  </th>

                  <th className="px-5 py-3 font-medium">
                    Départ
                  </th>

                  <th className="px-5 py-3 font-medium">
                    Retard
                  </th>

                  <th className="px-5 py-3 font-medium">
                    Statut
                  </th>

                </tr>

              </thead>

              <tbody>

                {employeeRows.length === 0 ? (

                  <tr>

                    <td
                      colSpan={5}
                      className="px-5 py-12 text-center"
                    >

                      <Users className="mx-auto mb-3 h-8 w-8 opacity-40" />

                      <p className="font-medium">
                        Aucun employé affecté à ce site
                      </p>

                      <p className="mt-1 text-sm text-muted-foreground">
                        Aucun autre employé actif
                        n'est actuellement rattaché
                        à ce site.
                      </p>

                    </td>

                  </tr>

                ) : (

                  employeeRows.map(
                    (employee) => {

                      const status =
                        getEmployeeStatus(
                          employee
                        );

                      return (
                        <tr
                          key={employee.id}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >

                          <td className="px-5 py-4">

                            <div className="flex items-center gap-3">

                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">

                                {employee.first_name
                                  ?.charAt(0)
                                  ?.toUpperCase()}

                                {employee.last_name
                                  ?.charAt(0)
                                  ?.toUpperCase()}

                              </div>

                              <div>

                                <div className="font-medium">

                                  {employee.first_name}{' '}

                                  {employee.last_name}

                                </div>

                                {employee.phone && (
                                  <div className="text-xs text-muted-foreground">
                                    {employee.phone}
                                  </div>
                                )}

                              </div>

                            </div>

                          </td>

                          <td className="px-5 py-4 text-sm">

                            {formatTime(
                              employee.attendance
                                ?.check_in
                            )}

                          </td>

                          <td className="px-5 py-4 text-sm">

                            {formatTime(
                              employee.attendance
                                ?.check_out
                            )}

                          </td>

                          <td className="px-5 py-4 text-sm">

                            {(employee.attendance
                              ?.late_minutes ??
                              0) > 0 ? (

                              <span className="font-medium text-orange-600">

                                {
                                  employee
                                    .attendance
                                    ?.late_minutes
                                }{' '}

                                min

                              </span>

                            ) : (
                              '—'
                            )}

                          </td>

                          <td className="px-5 py-4">

                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>

                          </td>

                        </tr>
                      );
                    }
                  )

                )}

              </tbody>

            </table>

          </div>

        </div>

        {/* =====================================================
            LÉGENDE
        ====================================================== */}

        <div className="flex flex-wrap gap-5 text-xs text-muted-foreground">

          <Legend
            color="bg-green-500"
            label="Présent"
          />

          <Legend
            color="bg-orange-500"
            label="En retard"
          />

          <Legend
            color="bg-red-500"
            label="Absent"
          />

          <Legend
            color="bg-blue-500"
            label="Absence autorisée"
          />

        </div>

      </div>
    </DashboardLayout>
  );
}

/*
 * ============================================================
 * CARTE STATISTIQUE
 * ============================================================
 */

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">

      <div className="flex items-center justify-between">

        <div>

          <p className="text-sm text-muted-foreground">
            {title}
          </p>

          <p className="mt-2 text-2xl font-bold">
            {value}
          </p>

        </div>

        <div className="rounded-lg bg-muted p-3">
          {icon}
        </div>

      </div>

    </div>
  );
}

/*
 * ============================================================
 * LÉGENDE
 * ============================================================
 */

function Legend({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">

      <span
        className={`h-2.5 w-2.5 rounded-full ${color}`}
      />

      {label}

    </div>
  );
}