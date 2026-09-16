import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useToast } from '@/hooks/use-toast';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/* ============================================================
 * TYPES
 * ========================================================== */

type EventType =
  | 'CLOCK_IN'
  | 'SITE_EXIT'
  | 'SITE_ENTER'
  | 'CLOCK_OUT';

type EventMethod =
  | 'manual'
  | 'gps_auto'
  | 'system'
  | 'manager';

type ZoneState =
  | 'inside'
  | 'outside'
  | null;

interface SiteContext {
  site_id: string;
  site_name: string;
  latitude: number | null;
  longitude: number | null;
  location_radius_m: number;
  max_gps_accuracy_m: number;
  gps_required: boolean;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  site_id: string;
  attendance_date: string;

  check_in: string | null;
  check_out: string | null;

  scheduled_start: string | null;
  scheduled_end: string | null;

  late_minutes: number | null;
  attendance_status: string | null;

  check_in_method: string | null;
  check_out_method: string | null;

  monitoring_started_at: string | null;
  monitoring_last_seen_at: string | null;

  monitoring_last_latitude: number | null;
  monitoring_last_longitude: number | null;
  monitoring_last_accuracy_m: number | null;
}

interface AttendanceEvent {
  id: string;
  attendance_id: string;
  employee_id: string;
  site_id: string;

  event_type: EventType;
  event_method: EventMethod;

  occurred_at: string;

  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;

  is_confirmed: boolean;
  confirmed_at: string | null;

  client_event_id: string | null;

  server_received_at: string;
  synced_at: string | null;
}

interface PendingEvent {
  id: string;

  type: EventType;

  siteId: string;

  occurredAt: string;

  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;

  clientEventId: string;

  attempts: number;
}

/* ============================================================
 * CONSTANTES
 * ========================================================== */

const OFFLINE_QUEUE_KEY = 'attendance_event_queue_v3';

const SELECTED_SITE_KEY = 'attendance_selected_site_v3';

const EXIT_CONFIRMATION_MS = 6 * 60 * 1000;

const HISTORY_LIMIT = 30;

/* ============================================================
 * HELPERS
 * ========================================================== */

function createClientEventId(): string {
  return crypto.randomUUID();
}

function loadQueue(): PendingEvent[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is PendingEvent =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        'type' in item &&
        'siteId' in item &&
        'occurredAt' in item &&
        'clientEventId' in item
    );
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingEvent[]): void {
  localStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify(queue)
  );
}

function loadSelectedSiteId(): string | null {
  try {
    return localStorage.getItem(SELECTED_SITE_KEY);
  } catch {
    return null;
  }
}

function saveSelectedSiteId(siteId: string): void {
  try {
    localStorage.setItem(
      SELECTED_SITE_KEY,
      siteId
    );
  } catch {
    // localStorage peut être indisponible.
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return 'Une erreur inattendue est survenue.';
}

function isNetworkError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null
  ) {
    if (
      'status' in error &&
      typeof error.status === 'number' &&
      error.status >= 500
    ) {
      return true;
    }

    if (
      'message' in error &&
      typeof error.message === 'string'
    ) {
      const message = error.message.toLowerCase();

      return (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection')
      );
    }
  }

  return false;
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(
        new Error(
          'La géolocalisation n’est pas disponible sur cet appareil.'
        )
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new Error(
                'L’autorisation GPS a été refusée.'
              )
            );
            break;

          case error.POSITION_UNAVAILABLE:
            reject(
              new Error(
                'Position GPS indisponible.'
              )
            );
            break;

          case error.TIMEOUT:
            reject(
              new Error(
                'Le GPS met trop de temps à répondre.'
              )
            );
            break;

          default:
            reject(
              new Error(
                'Impossible de récupérer la position GPS.'
              )
            );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}

function calculateDistance(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const earthRadius = 6371000;

  const toRadians = (value: number) =>
    (value * Math.PI) / 180;

  const dLatitude = toRadians(
    latitude2 - latitude1
  );

  const dLongitude = toRadians(
    longitude2 - longitude1
  );

  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(toRadians(latitude1)) *
      Math.cos(toRadians(latitude2)) *
      Math.sin(dLongitude / 2) ** 2;

  return (
    earthRadius *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

/* ============================================================
 * COMPONENT
 * ========================================================== */

export default function Attendance() {
  const { profile } = useAuth();
  const { toast } = useToast();

  /* ----------------------------------------------------------
   * DATA
   * -------------------------------------------------------- */

  const [sites, setSites] =
    useState<SiteContext[]>([]);

  const [selectedSiteId, setSelectedSiteId] =
    useState<string | null>(null);

  const [todayRecord, setTodayRecord] =
    useState<AttendanceRecord | null>(null);

  const [events, setEvents] =
    useState<AttendanceEvent[]>([]);

  const [history, setHistory] =
    useState<AttendanceRecord[]>([]);

  /* ----------------------------------------------------------
   * UI
   * -------------------------------------------------------- */

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [isOnline, setIsOnline] =
    useState(
      typeof navigator !== 'undefined'
        ? navigator.onLine
        : true
    );

  const [pendingCount, setPendingCount] =
    useState(0);

  const [monitoring, setMonitoring] =
    useState(false);

  const [outsideSince, setOutsideSince] =
    useState<string | null>(null);

  /* ----------------------------------------------------------
   * REFS
   * -------------------------------------------------------- */

  const watchIdRef =
    useRef<number | null>(null);

  const exitEventRef =
    useRef<AttendanceEvent | null>(null);

  const exitTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const lastZoneStateRef =
    useRef<ZoneState>(null);

  const processingLocationRef =
    useRef(false);

  /* ----------------------------------------------------------
   * SELECTED SITE
   * -------------------------------------------------------- */

  const selectedSite = useMemo(
    () =>
      sites.find(
        (site) =>
          site.site_id === selectedSiteId
      ) ?? null,
    [sites, selectedSiteId]
  );

  /* ==========================================================
   * LOAD SITES
   * ======================================================== */

  const loadSites = useCallback(
    async (): Promise<SiteContext[]> => {
      if (!profile) {
        return [];
      }

      /*
       * Le modèle V3 utilise employee_sites.
       *
       * On ne lit volontairement PAS employees.site_id.
       */

      const {
        data,
        error,
      } = await supabase
        .from('employee_sites')
        .select(`
          site_id,
          sites (
            id,
            name,
            latitude,
            longitude,
            location_radius_m,
            max_gps_accuracy_m,
            gps_required
          )
        `)
        .eq(
          'employee_id',
          profile.id
        )
        .eq(
          'is_active',
          true
        );

      if (error) {
        throw error;
      }

      const result: SiteContext[] = [];

      for (const row of data ?? []) {
        const site = row.sites;

        if (!site) {
          continue;
        }

        result.push({
          site_id: site.id,
          site_name: site.name,
          latitude: site.latitude,
          longitude: site.longitude,
          location_radius_m:
            site.location_radius_m,
          max_gps_accuracy_m:
            site.max_gps_accuracy_m,
          gps_required:
            site.gps_required,
        });
      }

      setSites(result);

      /*
       * Restaurer le dernier site choisi.
       */
      const savedSiteId =
        loadSelectedSiteId();

      const savedSiteExists =
        savedSiteId &&
        result.some(
          (site) =>
            site.site_id === savedSiteId
        );

      if (savedSiteExists) {
        setSelectedSiteId(
          savedSiteId
        );
      } else if (result.length === 1) {
        setSelectedSiteId(
          result[0].site_id
        );

        saveSelectedSiteId(
          result[0].site_id
        );
      } else {
        setSelectedSiteId(null);
      }

      return result;
    },
    [profile]
  );

  /* ==========================================================
   * LOAD TODAY
   * ======================================================== */

  const loadTodayRecord =
    useCallback(async () => {
      if (!profile) {
        return;
      }

      const today =
        format(
          new Date(),
          'yyyy-MM-dd'
        );

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
          scheduled_start,
          scheduled_end,
          late_minutes,
          attendance_status,
          check_in_method,
          check_out_method,
          monitoring_started_at,
          monitoring_last_seen_at,
          monitoring_last_latitude,
          monitoring_last_longitude,
          monitoring_last_accuracy_m
        `)
        .eq(
          'employee_id',
          profile.id
        )
        .eq(
          'attendance_date',
          today
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      setTodayRecord(
        data as AttendanceRecord | null
      );
    }, [profile]);

  /* ==========================================================
   * LOAD EVENTS
   * ======================================================== */

  const loadEvents =
    useCallback(async () => {
      if (!todayRecord) {
        setEvents([]);
        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from('attendance_events')
        .select(`
          id,
          attendance_id,
          employee_id,
          site_id,
          event_type,
          event_method,
          occurred_at,
          latitude,
          longitude,
          accuracy_m,
          distance_m,
          is_confirmed,
          confirmed_at,
          client_event_id,
          server_received_at,
          synced_at
        `)
        .eq(
          'attendance_id',
          todayRecord.id
        )
        .order(
          'occurred_at',
          {
            ascending: true,
          }
        );

      if (error) {
        throw error;
      }

      setEvents(
        (data ?? []) as AttendanceEvent[]
      );
    }, [todayRecord]);

  /* ==========================================================
   * LOAD HISTORY
   * ======================================================== */

  const loadHistory =
    useCallback(async () => {
      if (!profile) {
        return;
      }

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
          scheduled_start,
          scheduled_end,
          late_minutes,
          attendance_status,
          check_in_method,
          check_out_method,
          monitoring_started_at,
          monitoring_last_seen_at,
          monitoring_last_latitude,
          monitoring_last_longitude,
          monitoring_last_accuracy_m
        `)
        .eq(
          'employee_id',
          profile.id
        )
        .order(
          'attendance_date',
          {
            ascending: false,
          }
        )
        .limit(HISTORY_LIMIT);

      if (error) {
        throw error;
      }

      setHistory(
        (data ?? []) as AttendanceRecord[]
      );
    }, [profile]);

  /* ==========================================================
   * REFRESH
   * ======================================================== */

  const refreshAll =
    useCallback(async () => {
      await loadSites();
      await loadTodayRecord();
      await loadHistory();
    }, [
      loadSites,
      loadTodayRecord,
      loadHistory,
    ]);

  /* ==========================================================
   * QUEUE
   * ======================================================== */

  const refreshPendingCount =
    useCallback(() => {
      setPendingCount(
        loadQueue().length
      );
    }, []);

  const queueEvent =
    useCallback(
      (
        event: PendingEvent
      ) => {
        const queue =
          loadQueue();

        queue.push(event);

        saveQueue(queue);

        setPendingCount(
          queue.length
        );
      },
      []
    );

  /* ==========================================================
   * RPC HELPER
   * ======================================================== */

  const executeAttendanceRpc =
    useCallback(
      async (
        event: PendingEvent
      ): Promise<void> => {
        const args = {
          p_site_id:
            event.siteId,

          p_latitude:
            event.latitude,

          p_longitude:
            event.longitude,

          p_accuracy_m:
            event.accuracyM,

          p_occurred_at:
            event.occurredAt,

          p_client_event_id:
            event.clientEventId,

          p_device_recorded_at:
            event.occurredAt,
        };

        switch (event.type) {
          case 'CLOCK_IN': {
            const { error } =
              await supabase.rpc(
                'clock_in',
                args
              );

            if (error) {
              throw error;
            }

            break;
          }

          case 'CLOCK_OUT': {
            const { error } =
              await supabase.rpc(
                'clock_out',
                args
              );

            if (error) {
              throw error;
            }

            break;
          }

          case 'SITE_EXIT': {
            const { error } =
              await supabase.rpc(
                'record_site_exit',
                args
              );

            if (error) {
              throw error;
            }

            break;
          }

          case 'SITE_ENTER': {
            const { error } =
              await supabase.rpc(
                'record_site_enter',
                args
              );

            if (error) {
              throw error;
            }

            break;
          }
        }
      },
      []
    );

  /* ==========================================================
   * SYNC QUEUE
   * ======================================================== */

  const syncQueue =
    useCallback(async () => {
      if (!navigator.onLine) {
        return;
      }

      const queue =
        loadQueue();

      if (queue.length === 0) {
        setPendingCount(0);
        return;
      }

      const remaining: PendingEvent[] = [];

      let synchronized = 0;

      for (const event of queue) {
        try {
          await executeAttendanceRpc(
            event
          );

          synchronized++;
        } catch (error: unknown) {
          console.error(
            'Erreur synchronisation:',
            event,
            error
          );

          /*
           * Erreur réseau :
           * on conserve l'événement.
           */
          if (
            isNetworkError(error)
          ) {
            remaining.push({
              ...event,
              attempts:
                event.attempts + 1,
            });

            continue;
          }

          /*
           * Erreur métier :
           *
           * On ne renvoie PAS indéfiniment
           * le même événement.
           */
          console.warn(
            'Événement rejeté définitivement:',
            event,
            getErrorMessage(error)
          );
        }
      }

      saveQueue(
        remaining
      );

      setPendingCount(
        remaining.length
      );

      if (synchronized > 0) {
        await loadTodayRecord();
        await loadHistory();

        toast({
          title:
            'Synchronisation effectuée',
          description:
            `${synchronized} événement(s) synchronisé(s).`,
        });
      }
    }, [
      executeAttendanceRpc,
      loadHistory,
      loadTodayRecord,
      toast,
    ]);

  /* ==========================================================
   * ONLINE / OFFLINE
   * ======================================================== */

  useEffect(() => {
    const handleOnline =
      () => {
        setIsOnline(true);

        void syncQueue();
      };

    const handleOffline =
      () => {
        setIsOnline(false);
      };

    window.addEventListener(
      'online',
      handleOnline
    );

    window.addEventListener(
      'offline',
      handleOffline
    );

    refreshPendingCount();

    return () => {
      window.removeEventListener(
        'online',
        handleOnline
      );

      window.removeEventListener(
        'offline',
        handleOffline
      );
    };
  }, [
    refreshPendingCount,
    syncQueue,
  ]);

  /* ==========================================================
   * INITIALISATION
   * ======================================================== */

  useEffect(() => {
    if (!profile) {
      return;
    }

    const initialize =
      async () => {
        try {
          setLoading(true);

          await refreshAll();

          if (navigator.onLine) {
            await syncQueue();
          }
        } catch (error: unknown) {
          console.error(
            'Erreur initialisation Attendance:',
            error
          );

          toast({
            title:
              'Erreur de chargement',
            description:
              getErrorMessage(error),
            variant:
              'destructive',
          });
        } finally {
          setLoading(false);
        }
      };

    void initialize();
  }, [
    profile,
    refreshAll,
    syncQueue,
    toast,
  ]);

  /* ==========================================================
   * SITE SELECTION
   * ======================================================== */

  const handleSiteChange =
    useCallback(
      (siteId: string) => {
        setSelectedSiteId(
          siteId
        );

        saveSelectedSiteId(
          siteId
        );
      },
      []
    );

  /* ==========================================================
   * CLOCK IN
   * ======================================================== */

  const handleClockIn =
    async () => {
      if (!profile) {
        return;
      }

      if (!selectedSite) {
        toast({
          title:
            'Site requis',
          description:
            'Sélectionnez le site sur lequel vous travaillez.',
          variant:
            'destructive',
        });

        return;
      }

      if (todayRecord) {
        toast({
          title:
            'Pointage déjà existant',
          description:
            'Une présence existe déjà pour aujourd’hui.',
          variant:
            'destructive',
        });

        return;
      }

      setSubmitting(true);

      try {
        const position =
          await getPosition();

        const now =
          new Date();

        const event: PendingEvent = {
          id:
            crypto.randomUUID(),

          type:
            'CLOCK_IN',

          siteId:
            selectedSite.site_id,

          occurredAt:
            now.toISOString(),

          latitude:
            position.coords.latitude,

          longitude:
            position.coords.longitude,

          accuracyM:
            position.coords.accuracy,

          clientEventId:
            createClientEventId(),

          attempts: 0,
        };

        /*
         * OFFLINE
         */
        if (!navigator.onLine) {
          queueEvent(event);

          toast({
            title:
              'Arrivée enregistrée localement',
            description:
              'Elle sera synchronisée dès que la connexion reviendra.',
          });

          return;
        }

        /*
         * ONLINE
         */
        await executeAttendanceRpc(
          event
        );

        await loadTodayRecord();
        await loadHistory();

        toast({
          title:
            'Arrivée enregistrée',
          description:
            `Pointage effectué sur ${selectedSite.site_name}.`,
        });
      } catch (error: unknown) {
        /*
         * Si la connexion vient de tomber
         * pendant la requête, on met l'événement
         * en queue plutôt que de perdre le pointage.
         */
        if (
          !navigator.onLine ||
          isNetworkError(error)
        ) {
          try {
            const position =
              await getPosition();

            const now =
              new Date();

            queueEvent({
              id:
                crypto.randomUUID(),

              type:
                'CLOCK_IN',

              siteId:
                selectedSite.site_id,

              occurredAt:
                now.toISOString(),

              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracyM:
                position.coords.accuracy,

              clientEventId:
                createClientEventId(),

              attempts: 0,
            });

            toast({
              title:
                'Connexion interrompue',
              description:
                'Le pointage a été placé dans la file de synchronisation.',
            });

            return;
          } catch {
            // On affiche l'erreur originale.
          }
        }

        toast({
          title:
            'Impossible de pointer',
          description:
            getErrorMessage(error),
          variant:
            'destructive',
        });
      } finally {
        setSubmitting(false);
      }
    };

  /* ==========================================================
   * CLOCK OUT
   * ======================================================== */

  const handleClockOut =
    async () => {
      if (
        !todayRecord ||
        todayRecord.check_out
      ) {
        return;
      }

      const attendanceSite =
        sites.find(
          (site) =>
            site.site_id ===
            todayRecord.site_id
        ) ??
        selectedSite;

      if (!attendanceSite) {
        toast({
          title:
            'Site introuvable',
          description:
            'Impossible de déterminer le site de cette présence.',
          variant:
            'destructive',
        });

        return;
      }

      setSubmitting(true);

      try {
        const position =
          await getPosition();

        const now =
          new Date();

        const event: PendingEvent = {
          id:
            crypto.randomUUID(),

          type:
            'CLOCK_OUT',

          siteId:
            attendanceSite.site_id,

          occurredAt:
            now.toISOString(),

          latitude:
            position.coords.latitude,

          longitude:
            position.coords.longitude,

          accuracyM:
            position.coords.accuracy,

          clientEventId:
            createClientEventId(),

          attempts: 0,
        };

        /*
         * OFFLINE
         */
        if (!navigator.onLine) {
          queueEvent(event);

          setTodayRecord({
            ...todayRecord,

            check_out:
              now.toISOString(),

            check_out_method:
              'manual',

            attendance_status:
              'completed',
          });

          stopMonitoring();

          toast({
            title:
              'Départ enregistré localement',
            description:
              'Il sera synchronisé dès que la connexion reviendra.',
          });

          return;
        }

        /*
         * ONLINE
         */
        await executeAttendanceRpc(
          event
        );

        await loadTodayRecord();
        await loadEvents();
        await loadHistory();

        stopMonitoring();

        toast({
          title:
            'Départ enregistré',
          description:
            'Votre départ a bien été enregistré.',
        });
      } catch (error: unknown) {
        if (
          !navigator.onLine ||
          isNetworkError(error)
        ) {
          try {
            const position =
              await getPosition();

            const now =
              new Date();

            queueEvent({
              id:
                crypto.randomUUID(),

              type:
                'CLOCK_OUT',

              siteId:
                todayRecord.site_id,

              occurredAt:
                now.toISOString(),

              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracyM:
                position.coords.accuracy,

              clientEventId:
                createClientEventId(),

              attempts: 0,
            });

            setTodayRecord({
              ...todayRecord,

              check_out:
                now.toISOString(),

              check_out_method:
                'manual',

              attendance_status:
                'completed',
            });

            stopMonitoring();

            toast({
              title:
                'Départ enregistré localement',
              description:
                'Il sera synchronisé dès que la connexion reviendra.',
            });

            return;
          } catch {
            // Afficher l'erreur originale.
          }
        }

        toast({
          title:
            'Impossible d’enregistrer le départ',
          description:
            getErrorMessage(error),
          variant:
            'destructive',
        });
      } finally {
        setSubmitting(false);
      }
    };

  /* ==========================================================
   * HANDLE OUTSIDE
   * ======================================================== */

  const handleOutside =
    useCallback(
      async (
        position: GeolocationPosition
      ) => {
        if (
          processingLocationRef.current
        ) {
          return;
        }

        if (
          !todayRecord ||
          todayRecord.check_out
        ) {
          return;
        }

        processingLocationRef.current =
          true;

        try {
          const now =
            new Date();

          const event: PendingEvent = {
            id:
              crypto.randomUUID(),

            type:
              'SITE_EXIT',

            siteId:
              todayRecord.site_id,

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracyM:
              position.coords.accuracy,

            clientEventId:
              createClientEventId(),

            attempts: 0,
          };

          /*
           * OFFLINE
           */
          if (!navigator.onLine) {
            queueEvent(event);

            setOutsideSince(
              now.toISOString()
            );

            return;
          }

          /*
           * ONLINE
           */
          const {
            data,
            error,
          } = await supabase.rpc(
            'record_site_exit',
            {
              p_site_id:
                event.siteId,

              p_latitude:
                event.latitude,

              p_longitude:
                event.longitude,

              p_accuracy_m:
                event.accuracyM,

              p_occurred_at:
                event.occurredAt,

              p_client_event_id:
                event.clientEventId,

              p_device_recorded_at:
                event.occurredAt,
            }
          );

          if (error) {
            throw error;
          }

          const exitEvent =
            data as AttendanceEvent;

          exitEventRef.current =
            exitEvent;

          setOutsideSince(
            exitEvent.occurred_at
          );

          if (
            exitTimerRef.current
          ) {
            clearTimeout(
              exitTimerRef.current
            );
          }

          exitTimerRef.current =
            setTimeout(
              () => {
                void confirmExit(
                  exitEvent
                );
              },
              EXIT_CONFIRMATION_MS
            );
        } catch (error: unknown) {
          /*
           * Une sortie GPS ne doit pas
           * disparaître si la connexion tombe.
           */
          if (
            !navigator.onLine ||
            isNetworkError(error)
          ) {
            queueEvent({
              id:
                crypto.randomUUID(),

              type:
                'SITE_EXIT',

              siteId:
                todayRecord.site_id,

              occurredAt:
                new Date().toISOString(),

              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracyM:
                position.coords.accuracy,

              clientEventId:
                createClientEventId(),

              attempts: 0,
            });

            setOutsideSince(
              new Date().toISOString()
            );
          } else {
            console.error(
              'Erreur sortie site:',
              error
            );
          }
        } finally {
          processingLocationRef.current =
            false;
        }
      },
      [todayRecord]
    );

  /* ==========================================================
   * CONFIRM EXIT
   * ======================================================== */

  const confirmExit =
    useCallback(
      async (
        exitEvent: AttendanceEvent
      ) => {
        if (!exitEvent.id) {
          return;
        }

        if (!navigator.onLine) {
          return;
        }

        try {
          const {
            data,
            error,
          } = await supabase.rpc(
            'confirm_site_exit',
            {
              p_event_id:
                exitEvent.id,

              p_confirmed_at:
                new Date().toISOString(),
            }
          );

          if (error) {
            throw error;
          }

          exitEventRef.current =
            data as AttendanceEvent;

          await loadTodayRecord();
          await loadEvents();

          setOutsideSince(null);
        } catch (error: unknown) {
          console.error(
            'Erreur confirmation sortie:',
            error
          );
        }
      },
      [
        loadEvents,
        loadTodayRecord,
      ]
    );

  /* ==========================================================
   * HANDLE INSIDE
   * ======================================================== */

  const handleInside =
    useCallback(
      async (
        position: GeolocationPosition
      ) => {
        if (
          !todayRecord ||
          todayRecord.check_out
        ) {
          return;
        }

        /*
         * Aucun événement si on était déjà
         * à l'intérieur.
         */
        if (
          lastZoneStateRef.current ===
          'inside'
        ) {
          return;
        }

        lastZoneStateRef.current =
          'inside';

        /*
         * Retour avant les 6 minutes :
         * annuler la confirmation de sortie.
         */
        if (
          exitTimerRef.current
        ) {
          clearTimeout(
            exitTimerRef.current
          );

          exitTimerRef.current =
            null;
        }

        setOutsideSince(null);

        const now =
          new Date();

        const event: PendingEvent = {
          id:
            crypto.randomUUID(),

          type:
            'SITE_ENTER',

          siteId:
            todayRecord.site_id,

          occurredAt:
            now.toISOString(),

          latitude:
            position.coords.latitude,

          longitude:
            position.coords.longitude,

          accuracyM:
            position.coords.accuracy,

          clientEventId:
            createClientEventId(),

          attempts: 0,
        };

        try {
          if (!navigator.onLine) {
            queueEvent(event);
            return;
          }

          await executeAttendanceRpc(
            event
          );

          await loadEvents();
        } catch (error: unknown) {
          if (
            !navigator.onLine ||
            isNetworkError(error)
          ) {
            queueEvent(event);
          } else {
            console.error(
              'Erreur retour sur site:',
              error
            );
          }
        }
      },
      [
        executeAttendanceRpc,
        loadEvents,
        todayRecord,
      ]
    );

  /* ==========================================================
   * GPS MONITORING
   * ======================================================== */

  const startMonitoring =
    useCallback(() => {
      if (
        watchIdRef.current !== null
      ) {
        return;
      }

      if (
        !navigator.geolocation
      ) {
        toast({
          title:
            'GPS indisponible',
          description:
            'Votre appareil ne permet pas la surveillance GPS.',
          variant:
            'destructive',
        });

        return;
      }

      if (
        !todayRecord ||
        todayRecord.check_out
      ) {
        return;
      }

      const site =
        sites.find(
          (item) =>
            item.site_id ===
            todayRecord.site_id
        );

      if (!site) {
        return;
      }

      /*
       * Si le site n'a pas de coordonnées,
       * aucune surveillance de périmètre
       * ne peut être effectuée.
       */
      if (
        site.latitude === null ||
        site.longitude === null
      ) {
        setMonitoring(false);
        return;
      }

      const watchId =
        navigator.geolocation.watchPosition(
          async (
            position
          ) => {
            if (
              processingLocationRef.current
            ) {
              return;
            }

            const currentSite =
              sites.find(
                (item) =>
                  item.site_id ===
                  todayRecord.site_id
              );

            if (
              !currentSite ||
              currentSite.latitude === null ||
              currentSite.longitude === null
            ) {
              return;
            }

            /*
             * Contrôle de précision GPS.
             */
            if (
              currentSite.max_gps_accuracy_m > 0 &&
              position.coords.accuracy >
                currentSite.max_gps_accuracy_m
            ) {
              return;
            }

            const distance =
              calculateDistance(
                position.coords.latitude,
                position.coords.longitude,
                currentSite.latitude,
                currentSite.longitude
              );

            const isInside =
              distance <=
              currentSite.location_radius_m;

            /*
             * Première position :
             * on initialise simplement l'état.
             */
            if (
              lastZoneStateRef.current ===
              null
            ) {
              lastZoneStateRef.current =
                isInside
                  ? 'inside'
                  : 'outside';

              return;
            }

            /*
             * Retour dans la zone.
             */
            if (isInside) {
              await handleInside(
                position
              );

              return;
            }

            /*
             * Sortie de la zone.
             */
            if (
              lastZoneStateRef.current ===
              'inside'
            ) {
              lastZoneStateRef.current =
                'outside';

              await handleOutside(
                position
              );
            }
          },
          (error) => {
            console.warn(
              'GPS monitoring:',
              error
            );
          },
          {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 20000,
          }
        );

      watchIdRef.current =
        watchId;

      setMonitoring(true);
    }, [
      handleInside,
      handleOutside,
      sites,
      todayRecord,
      toast,
    ]);

  /* ==========================================================
   * STOP GPS
   * ======================================================== */

  const stopMonitoring =
    useCallback(() => {
      if (
        watchIdRef.current !== null
      ) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        );

        watchIdRef.current =
          null;
      }

      if (
        exitTimerRef.current
      ) {
        clearTimeout(
          exitTimerRef.current
        );

        exitTimerRef.current =
          null;
      }

      setMonitoring(false);

      lastZoneStateRef.current =
        null;
    }, []);

  /* ==========================================================
   * START / STOP MONITORING
   * ======================================================== */

  useEffect(() => {
    if (
      todayRecord?.check_in &&
      !todayRecord.check_out
    ) {
      startMonitoring();

      return () => {
        stopMonitoring();
      };
    }

    stopMonitoring();

    return undefined;
  }, [
    todayRecord?.check_in,
    todayRecord?.check_out,
    todayRecord?.site_id,
    startMonitoring,
    stopMonitoring,
  ]);

  /* ==========================================================
   * LOAD EVENTS WHEN TODAY CHANGES
   * ======================================================== */

  useEffect(() => {
    if (todayRecord) {
      void loadEvents();
    } else {
      setEvents([]);
    }
  }, [
    todayRecord,
    loadEvents,
  ]);

  /* ==========================================================
   * CLEANUP
   * ======================================================== */

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [
    stopMonitoring,
  ]);

  /* ==========================================================
   * DISPLAY HELPERS
   * ======================================================== */

  const getStatusLabel =
    (
      record: AttendanceRecord
    ): string => {
      if (record.check_out) {
        return 'Terminée';
      }

      if (
        record.attendance_status ===
        'missing_departure'
      ) {
        return 'Départ manquant';
      }

      if (
        record.late_minutes &&
        record.late_minutes > 0
      ) {
        return `Présent — retard ${record.late_minutes} min`;
      }

      return 'Présent';
    };

  const getEventLabel =
    (
      eventType: EventType
    ): string => {
      switch (eventType) {
        case 'CLOCK_IN':
          return 'Arrivée';

        case 'SITE_EXIT':
          return 'Sortie du site';

        case 'SITE_ENTER':
          return 'Retour sur site';

        case 'CLOCK_OUT':
          return 'Départ';
      }
    };

  /* ==========================================================
   * LOADING
   * ======================================================== */

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  /* ==========================================================
   * RENDER
   * ======================================================== */

  return (
    <DashboardLayout>
      <div className="animate-fade-in">
        {/* ====================================================
         * HEADER
         * ================================================== */}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="page-title">
              Pointage
            </h1>

            <div className="flex flex-wrap items-center gap-3 mt-2">
              {isOnline ? (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <Wifi className="h-4 w-4" />
                  En ligne
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-amber-600">
                  <WifiOff className="h-4 w-4" />
                  Hors-ligne
                </span>
              )}

              {monitoring && (
                <span className="flex items-center gap-1 text-sm text-primary">
                  <Radio className="h-4 w-4" />
                  GPS actif
                </span>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refreshAll();
            }}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
        </div>

        {/* ====================================================
         * SITE SELECTOR
         * ================================================== */}

        {!todayRecord && (
          <Card className="max-w-2xl mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Site de travail
              </CardTitle>
            </CardHeader>

            <CardContent>
              {sites.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />

                    <div>
                      <p className="font-medium text-amber-900">
                        Aucun site attribué
                      </p>

                      <p className="text-sm text-amber-800 mt-1">
                        Aucun site actif ne vous est actuellement attribué.
                        Contactez votre responsable.
                      </p>
                    </div>
                  </div>
                </div>
              ) : sites.length === 1 ? (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-primary" />

                    <div>
                      <p className="font-medium">
                        {sites[0].site_name}
                      </p>

                      <p className="text-xs text-muted-foreground mt-1">
                        Site automatiquement sélectionné.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Vous êtes affecté à plusieurs sites.
                    Sélectionnez le site sur lequel vous allez
                    effectuer votre pointage.
                  </p>

                  <Select
                    value={
                      selectedSiteId ?? undefined
                    }
                    onValueChange={
                      handleSiteChange
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un site" />
                    </SelectTrigger>

                    <SelectContent>
                      {sites.map(
                        (site) => (
                          <SelectItem
                            key={
                              site.site_id
                            }
                            value={
                              site.site_id
                            }
                          >
                            {site.site_name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ====================================================
         * TODAY
         * ================================================== */}

        <Card className="max-w-2xl mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />

              Aujourd'hui —{' '}
              {format(
                new Date(),
                'EEEE d MMMM yyyy',
                {
                  locale: fr,
                }
              )}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* ------------------------------------------------
             * NO ATTENDANCE
             * ---------------------------------------------- */}

            {!todayRecord && (
              <div className="space-y-4">
                {selectedSite && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-primary mt-0.5" />

                      <div>
                        <p className="font-medium">
                          Site sélectionné
                        </p>

                        <p className="text-sm text-muted-foreground">
                          {selectedSite.site_name}
                        </p>

                        <p className="text-xs text-muted-foreground mt-1">
                          Rayon autorisé :{' '}
                          {selectedSite.location_radius_m} m
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  onClick={
                    handleClockIn
                  }
                  disabled={
                    submitting ||
                    !selectedSite ||
                    sites.length === 0
                  }
                  className="w-full"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}

                  Marquer mon arrivée
                </Button>
              </div>
            )}

            {/* ------------------------------------------------
             * ACTIVE ATTENDANCE
             * ---------------------------------------------- */}

            {todayRecord && (
              <div className="space-y-4">
                {/* SITE */}

                <div className="rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-primary mt-0.5" />

                    <div>
                      <p className="font-medium">
                        Site de présence
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {sites.find(
                          (site) =>
                            site.site_id ===
                            todayRecord.site_id
                        )?.site_name ??
                          todayRecord.site_id}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ARRIVAL */}

                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Arrivée
                  </span>

                  <span className="font-semibold">
                    {todayRecord.check_in
                      ? format(
                          new Date(
                            todayRecord.check_in
                          ),
                          'HH:mm'
                        )
                      : '—'}
                  </span>
                </div>

                {/* RETARD */}

                {Boolean(
                  todayRecord.late_minutes &&
                    todayRecord.late_minutes >
                      0
                ) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />

                      Retard de{' '}
                      {
                        todayRecord.late_minutes
                      }{' '}
                      minute(s)
                    </p>
                  </div>
                )}

                {/* GPS MONITORING */}

                {!todayRecord.check_out &&
                  monitoring && (
                    <div className="rounded-md border bg-muted/40 p-3">
                      <div className="flex items-center gap-2">
                        <Radio className="h-4 w-4 text-primary" />

                        <span className="text-sm font-medium">
                          Présence surveillée
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground mt-1">
                        Votre position est utilisée pour
                        détecter les sorties et retours
                        du périmètre autorisé.
                      </p>
                    </div>
                  )}

                {/* OUTSIDE */}

                {outsideSince && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">
                      Sortie du site détectée à{' '}
                      <strong>
                        {format(
                          new Date(
                            outsideSince
                          ),
                          'HH:mm'
                        )}
                      </strong>
                    </p>

                    <p className="text-xs text-amber-700 mt-1">
                      La sortie sera confirmée si vous
                      restez hors périmètre pendant
                      6 minutes.
                    </p>
                  </div>
                )}

                {/* COMPLETED */}

                {todayRecord.check_out && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-4">
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="h-5 w-5" />

                      <span className="font-medium">
                        Journée terminée
                      </span>
                    </div>

                    <p className="text-sm text-green-700 mt-2">
                      Départ :{' '}
                      <strong>
                        {format(
                          new Date(
                            todayRecord.check_out
                          ),
                          'HH:mm'
                        )}
                      </strong>
                    </p>

                    {todayRecord.check_out_method ===
                      'gps_auto' && (
                      <p className="text-xs text-green-600 mt-1">
                        Départ détecté automatiquement
                        par GPS.
                      </p>
                    )}
                  </div>
                )}

                {/* CLOCK OUT */}

                {!todayRecord.check_out && (
                  <Button
                    onClick={
                      handleClockOut
                    }
                    variant="outline"
                    disabled={
                      submitting
                    }
                    className="w-full"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <LogOut className="h-4 w-4 mr-2" />
                    )}

                    Marquer mon départ
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ====================================================
         * EVENTS
         * ================================================== */}

        {events.length > 0 && (
          <div className="max-w-2xl mb-8">
            <h2 className="font-display text-lg font-semibold mb-4">
              Activité de la journée
            </h2>

            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {events.map(
                    (event) => (
                      <div
                        key={
                          event.id
                        }
                        className="flex items-start gap-3"
                      >
                        <div className="mt-1">
                          {event.event_type ===
                            'CLOCK_IN' && (
                            <LogIn className="h-4 w-4 text-primary" />
                          )}

                          {event.event_type ===
                            'SITE_EXIT' && (
                            <LogOut className="h-4 w-4 text-amber-600" />
                          )}

                          {event.event_type ===
                            'SITE_ENTER' && (
                            <MapPin className="h-4 w-4 text-green-600" />
                          )}

                          {event.event_type ===
                            'CLOCK_OUT' && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                        </div>

                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {getEventLabel(
                              event.event_type
                            )}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            {format(
                              new Date(
                                event.occurred_at
                              ),
                              'HH:mm:ss'
                            )}

                            {' · '}

                            {event.event_method ===
                            'gps_auto'
                              ? 'GPS'
                              : 'Manuel'}
                          </p>

                          {event.event_type ===
                            'SITE_EXIT' &&
                            event.is_confirmed && (
                              <p className="text-xs text-amber-700 mt-1">
                                Sortie confirmée.
                              </p>
                            )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ====================================================
         * HISTORY
         * ================================================== */}

        <h2 className="font-display text-lg font-semibold mb-4">
          Historique récent
        </h2>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left">
                    Date
                  </th>

                  <th className="px-4 py-3 text-left">
                    Site
                  </th>

                  <th className="px-4 py-3 text-left">
                    Arrivée
                  </th>

                  <th className="px-4 py-3 text-left">
                    Départ
                  </th>

                  <th className="px-4 py-3 text-left">
                    Statut
                  </th>
                </tr>
              </thead>

              <tbody>
                {history.map(
                  (record) => (
                    <tr
                      key={
                        record.id
                      }
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-3 text-sm">
                        {format(
                          new Date(
                            record.attendance_date
                          ),
                          'dd/MM/yyyy'
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {sites.find(
                          (site) =>
                            site.site_id ===
                            record.site_id
                        )?.site_name ??
                          record.site_id}
                      </td>

                      <td className="px-4 py-3 text-sm font-medium">
                        {record.check_in
                          ? format(
                              new Date(
                                record.check_in
                              ),
                              'HH:mm'
                            )
                          : '—'}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {record.check_out
                          ? format(
                              new Date(
                                record.check_out
                              ),
                              'HH:mm'
                            )
                          : '—'}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {getStatusLabel(
                          record
                        )}
                      </td>
                    </tr>
                  )
                )}

                {history.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Aucun historique de
                      pointage.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ====================================================
         * OFFLINE QUEUE
         * ================================================== */}

        {pendingCount > 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4" />

            <span>
              {pendingCount} événement
              {pendingCount > 1
                ? 's'
                : ''}{' '}
              en attente de synchronisation.
            </span>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}