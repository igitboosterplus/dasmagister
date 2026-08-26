import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
} from 'lucide-react';

interface Attendance {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  sites?: {
    name?: string;
    work_start?: string | null;
    work_end?: string | null;
  } | null;
}

interface Site {
  id: string;
  name: string;
  work_start: string | null;
  work_end: string | null;
}

export default function Dashboardemployee() {
  const { profile, role } = useAuth();

  const [todayAttendance, setTodayAttendance] =
    useState<Attendance | null>(null);

  const [site, setSite] = useState<Site | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());

  /**
   * ============================================================
   * HORLOGE
   * ============================================================
   */
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  /**
   * ============================================================
   * RÉCUPÉRATION DES DONNÉES DU JOUR
   * ============================================================
   */
  useEffect(() => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    fetchTodayData();
  }, [profile?.id]);

  /**
   * ============================================================
   * FETCH
   * ============================================================
   */
  const fetchTodayData = async () => {
    if (!profile?.id) return;

    try {
      setLoading(true);

      const today = new Date()
        .toISOString()
        .split('T')[0];

      /**
       * Récupération du pointage du jour
       */
      const { data: attendance, error: attendanceError } =
        await supabase
          .from('attendances')
          .select(
            `
              id,
              employee_id,
              attendance_date,
              check_in,
              check_out,
              sites (
                name,
                work_start,
                work_end
              )
            `
          )
          .eq('employee_id', profile.id)
          .eq('attendance_date', today)
          .maybeSingle();

      if (attendanceError) {
        console.error(
          'Erreur récupération pointage:',
          attendanceError
        );
      }

      setTodayAttendance(
        attendance as Attendance | null
      );

      /**
       * Récupération du site de l'employé
       */
      if (profile.site_id) {
        const { data: employeeSite, error: siteError } =
          await supabase
            .from('sites')
            .select(
              'id, name, work_start, work_end'
            )
            .eq('id', profile.site_id)
            .maybeSingle();

        if (siteError) {
          console.error(
            'Erreur récupération site:',
            siteError
          );
        }

        setSite(employeeSite as Site | null);
      } else {
        setSite(null);
      }
    } catch (error) {
      console.error(
        'Erreur récupération dashboard:',
        error
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * ============================================================
   * FORMATAGE DE L'HEURE
   * ============================================================
   */
  const formatTime = (
    value: string | null | undefined
  ) => {
    if (!value) return '--:--';

    return new Date(value).toLocaleTimeString(
      'fr-FR',
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
  };

  /**
   * ============================================================
   * FORMATAGE DE LA DATE
   * ============================================================
   */
  const formattedDate =
    currentTime.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const formattedTime =
    currentTime.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  /**
   * ============================================================
   * CALCUL DU RETARD
   * ============================================================
   */
  const calculateLateMinutes = () => {
    if (
      !todayAttendance?.check_in ||
      !site?.work_start
    ) {
      return 0;
    }

    const checkIn = new Date(
      todayAttendance.check_in
    );

    const [hours, minutes] = site.work_start
      .split(':')
      .map(Number);

    const expectedStart = new Date(checkIn);

    expectedStart.setHours(
      hours,
      minutes,
      0,
      0
    );

    const difference =
      checkIn.getTime() -
      expectedStart.getTime();

    const lateMinutes = Math.floor(
      difference / 60000
    );

    return lateMinutes > 0 ? lateMinutes : 0;
  };

  /**
   * ============================================================
   * CALCUL DU TEMPS DE TRAVAIL
   * ============================================================
   */
  const calculateWorkDuration = () => {
    if (!todayAttendance?.check_in) {
      return '--';
    }

    const start = new Date(
      todayAttendance.check_in
    );

    const end = todayAttendance.check_out
      ? new Date(todayAttendance.check_out)
      : currentTime;

    const difference =
      end.getTime() - start.getTime();

    if (difference <= 0) {
      return '0h 00min';
    }

    const totalMinutes = Math.floor(
      difference / 60000
    );

    const hours = Math.floor(
      totalMinutes / 60
    );

    const minutes = totalMinutes % 60;

    return `${hours}h ${minutes
      .toString()
      .padStart(2, '0')}min`;
  };

  /**
   * ============================================================
   * STATUT DU JOUR
   * ============================================================
   */
  const getStatus = () => {
    if (!todayAttendance?.check_in) {
      return {
        label: 'Non pointé',
        description:
          'Vous n’avez pas encore enregistré votre arrivée.',
        className:
          'bg-muted text-muted-foreground',
        icon: Clock,
      };
    }

    if (
      todayAttendance.check_in &&
      !todayAttendance.check_out
    ) {
      return {
        label: 'Présent',
        description:
          'Votre journée de travail est en cours.',
        className:
          'bg-success/10 text-success',
        icon: CheckCircle,
      };
    }

    return {
      label: 'Journée terminée',
      description:
        'Votre pointage de sortie a été enregistré.',
      className:
        'bg-primary/10 text-primary',
      icon: CheckCircle,
    };
  };

  const status = getStatus();
  const StatusIcon = status.icon;

  /**
   * ============================================================
   * POINTAGE
   * ============================================================
   *
   * Cette fonction suppose que les tables disposent
   * des opérations INSERT / UPDATE nécessaires.
   */
  const handleAttendance = async () => {
    if (!profile?.id) return;

    try {
      setActionLoading(true);

      const today = new Date()
        .toISOString()
        .split('T')[0];

      /**
       * ARRIVÉE
       */
      if (!todayAttendance?.check_in) {
        const { data, error } =
          await supabase
            .from('attendances')
            .insert({
              employee_id: profile.id,
              attendance_date: today,
              check_in: new Date().toISOString(),
              site_id: profile.site_id,
            })
            .select(
              `
                id,
                employee_id,
                attendance_date,
                check_in,
                check_out,
                sites (
                  name,
                  work_start,
                  work_end
                )
              `
            )
            .single();

        if (error) {
          console.error(
            'Erreur pointage arrivée:',
            error
          );

          return;
        }

        setTodayAttendance(
          data as Attendance
        );

        return;
      }

      /**
       * SORTIE
       */
      if (
        todayAttendance.check_in &&
        !todayAttendance.check_out
      ) {
        const { data, error } =
          await supabase
            .from('attendances')
            .update({
              check_out:
                new Date().toISOString(),
            })
            .eq(
              'id',
              todayAttendance.id
            )
            .select(
              `
                id,
                employee_id,
                attendance_date,
                check_in,
                check_out,
                sites (
                  name,
                  work_start,
                  work_end
                )
              `
            )
            .single();

        if (error) {
          console.error(
            'Erreur pointage sortie:',
            error
          );

          return;
        }

        setTodayAttendance(
          data as Attendance
        );
      }
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * ============================================================
   * LABEL DU BOUTON
   * ============================================================
   */
  const getAttendanceButtonLabel = () => {
    if (!todayAttendance?.check_in) {
      return 'Pointer mon arrivée';
    }

    if (
      todayAttendance.check_in &&
      !todayAttendance.check_out
    ) {
      return 'Pointer mon départ';
    }

    return 'Journée terminée';
  };

  /**
   * ============================================================
   * CHARGEMENT
   * ============================================================
   */
  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  /**
   * ============================================================
   * DASHBOARD
   * ============================================================
   */
  return (
    <DashboardLayout>
      <div className="animate-fade-in space-y-6">

        {/* ======================================================
            HEADER
        ====================================================== */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground capitalize">
              {formattedDate}
            </p>

            <h1 className="page-title mt-1">
              Bonjour, {profile?.first_name}{' '}
              {profile?.last_name}
            </h1>

            <p className="mt-1 text-muted-foreground">
              Voici votre espace personnel.
            </p>
          </div>

          <Card className="w-fit">
            <CardContent className="flex items-center gap-3 p-4">
              <Clock className="h-5 w-5 text-primary" />

              <div>
                <p className="text-xs text-muted-foreground">
                  Heure actuelle
                </p>

                <p className="font-display text-xl font-bold">
                  {formattedTime}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ======================================================
            STATUT PRINCIPAL
        ====================================================== */}
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">

              <div className="flex items-center gap-4">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-full ${status.className}`}
                >
                  <StatusIcon className="h-7 w-7" />
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    Statut aujourd'hui
                  </p>

                  <h2 className="text-2xl font-bold">
                    {status.label}
                  </h2>

                  <p className="text-sm text-muted-foreground">
                    {status.description}
                  </p>
                </div>
              </div>

              <Button
                size="lg"
                onClick={handleAttendance}
                disabled={
                  actionLoading ||
                  Boolean(
                    todayAttendance?.check_out
                  )
                }
                className="min-w-[220px]"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Enregistrement...
                  </>
                ) : todayAttendance?.check_in &&
                  !todayAttendance?.check_out ? (
                  <>
                    <LogOut className="mr-2 h-5 w-5" />
                    Pointer mon départ
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
          </CardContent>
        </Card>

        {/* ======================================================
            INFORMATIONS DU JOUR
        ====================================================== */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {/* ARRIVÉE */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Arrivée
              </CardTitle>

              <LogIn className="h-5 w-5 text-success" />
            </CardHeader>

            <CardContent>
              <p className="font-display text-3xl font-bold">
                {formatTime(
                  todayAttendance?.check_in
                )}
              </p>

              {site?.work_start && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Horaire prévu : {site.work_start}
                </p>
              )}
            </CardContent>
          </Card>

          {/* DÉPART */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Départ
              </CardTitle>

              <LogOut className="h-5 w-5 text-primary" />
            </CardHeader>

            <CardContent>
              <p className="font-display text-3xl font-bold">
                {formatTime(
                  todayAttendance?.check_out
                )}
              </p>

              {site?.work_end && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Horaire prévu : {site.work_end}
                </p>
              )}
            </CardContent>
          </Card>

          {/* TEMPS DE TRAVAIL */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Temps de travail
              </CardTitle>

              <Timer className="h-5 w-5 text-primary" />
            </CardHeader>

            <CardContent>
              <p className="font-display text-3xl font-bold">
                {calculateWorkDuration()}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Temps travaillé aujourd'hui
              </p>
            </CardContent>
          </Card>

          {/* RETARD */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Retard
              </CardTitle>

              {calculateLateMinutes() > 0 ? (
                <AlertTriangle className="h-5 w-5 text-warning" />
              ) : (
                <CheckCircle className="h-5 w-5 text-success" />
              )}
            </CardHeader>

            <CardContent>
              <p className="font-display text-3xl font-bold">
                {calculateLateMinutes()} min
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {calculateLateMinutes() > 0
                  ? 'Retard enregistré'
                  : 'Aucun retard'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ======================================================
            INFORMATIONS EMPLOYÉ
        ====================================================== */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* PROFIL PROFESSIONNEL */}
          <Card>
            <CardHeader>
              <CardTitle>
                Mes informations professionnelles
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <BriefcaseBusiness className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    Fonction
                  </p>

                  <p className="font-medium">
                    {role ?? 'Employé'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    Site de travail
                  </p>

                  <p className="font-medium">
                    {site?.name ??
                      'Site non renseigné'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    Statut du compte
                  </p>

                  <p className="font-medium">
                    {profile?.is_active
                      ? 'Actif'
                      : 'Inactif'}
                  </p>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* HORAIRES */}
          <Card>
            <CardHeader>
              <CardTitle>
                Mes horaires
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-2 gap-4">

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Début de journée
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {site?.work_start ??
                      '--:--'}
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Fin de journée
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {site?.work_end ??
                      '--:--'}
                  </p>
                </div>

              </div>

              {calculateLateMinutes() > 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-lg bg-warning/10 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />

                  <div>
                    <p className="font-medium">
                      Retard enregistré
                    </p>

                    <p className="text-sm text-muted-foreground">
                      Vous avez actuellement{' '}
                      {calculateLateMinutes()}{' '}
                      minute
                      {calculateLateMinutes() > 1
                        ? 's'
                        : ''}{' '}
                      de retard.
                    </p>
                  </div>
                </div>
              )}

              {!todayAttendance?.check_in && (
                <div className="mt-4 flex items-start gap-3 rounded-lg bg-primary/10 p-4">
                  <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />

                  <div>
                    <p className="font-medium">
                      N'oubliez pas votre pointage
                    </p>

                    <p className="text-sm text-muted-foreground">
                      Enregistrez votre arrivée dès
                      votre prise de service.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </DashboardLayout>
  );
}
