import {
  useCallback,
  useEffect,
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

function getPosition(
  maxAccuracyM = 100,
  timeoutMs = 20000
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          'La géolocalisation n’est pas disponible sur cet appareil.'
        )
      );

      return;
    }

    let watchId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    let bestPosition: GeolocationPosition | null = null;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = (
      position: GeolocationPosition
    ) => {
      cleanup();
      resolve(position);
    };

    const handlePosition = (
      position: GeolocationPosition
    ) => {
      console.log(
        'GPS position reçue:',
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
      );

      /*
       * On conserve toujours la meilleure position reçue.
       */
      if (
        !bestPosition ||
        position.coords.accuracy <
        bestPosition.coords.accuracy
      ) {
        bestPosition = position;
      }

      /*
       * On accepte immédiatement si la précision
       * est suffisamment bonne.
       */
      if (
        position.coords.accuracy <=
        maxAccuracyM
      ) {
        finish(position);
      }
    };

    const handleError = (
      error: GeolocationPositionError
    ) => {
      console.warn(
        'Erreur GPS:',
        error
      );
    };

    watchId =
      navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 0,
        }
      );

    timeoutId = setTimeout(() => {
      cleanup();

      /*
       * On refuse une position catastrophique.
       */
      if (!bestPosition) {
        reject(
          new Error(
            'Impossible d’obtenir votre position GPS.'
          )
        );

        return;
      }

      if (
        bestPosition.coords.accuracy >
        maxAccuracyM
      ) {
        reject(
          new Error(
            `Précision GPS insuffisante : ${Math.round(
              bestPosition.coords.accuracy
            )} m. Veuillez activer la localisation précise et réessayer.`
          )
        );

        return;
      }

      resolve(bestPosition);
    }, timeoutMs);
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

interface DetectedSite {
  site: SiteContext;
  distanceM: number;
}

/**
 * Détermine automatiquement le site auquel le salarié est autorisé
 * à pointer à partir de sa position GPS.
 *
 * Important : on ne cherche QUE dans les sites affectés au salarié.
 * Le RPC côté Supabase doit continuer à faire la même vérification
 * côté serveur : le contrôle client n'est pas une barrière de sécurité.
 */
function detectAssignedSiteFromPosition(
  position: GeolocationPosition,
  assignedSites: SiteContext[]
): DetectedSite | null {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const accuracy = position.coords.accuracy;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return null;
  }

  const candidates = assignedSites
    .filter(
      (site) =>
        site.latitude !== null &&
        site.longitude !== null &&
        (!site.gps_required || site.latitude !== null) &&
        accuracy <= site.max_gps_accuracy_m
    )
    .map((site) => ({
      site,
      distanceM: calculateDistance(
        latitude,
        longitude,
        site.latitude as number,
        site.longitude as number
      ),
    }))
    .filter(
      ({ site, distanceM }) =>
        distanceM <= site.location_radius_m
    )
    .sort((a, b) => a.distanceM - b.distanceM);

  return candidates[0] ?? null;
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
  console.error('CLOCK_IN RPC ERROR', {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

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
            error
          );

          toast({
            title: 'Pointage non synchronisé',
            description: getAttendanceErrorMessage(error),
            variant: 'destructive',
          });
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
   * ATTENDANCE ERROR MESSAGES
   * ======================================================== */

  function getAttendanceErrorMessage(
    error: unknown
  ): string {
    const message = getErrorMessage(error);

    const normalized = message
      .replace(/^Error:\s*/i, '')
      .trim();

    const knownMessages: Array<[string, string]> = [
      [
        'EMPLOYEE_NOT_ASSIGNED_TO_SITE',
        "Vous n'êtes pas affecté à ce site. Vous ne pouvez pas y pointer.",
      ],
      [
        'GPS_OUTSIDE_SITE',
        "Votre position GPS ne se trouve pas dans le périmètre autorisé du site.",
      ],
      [
        'GPS_ACCURACY_INSUFFICIENT',
        "La précision GPS est insuffisante pour valider ce pointage. Activez la localisation précise et réessayez.",
      ],
      [
        'GEOLOCATION_NOT_CONFIGURED',
        "La géolocalisation de ce site n'est pas correctement configurée. Contactez votre responsable.",
      ],
      [
        'SITE_NOT_FOUND',
        "Le site demandé n'existe pas ou n'est plus actif.",
      ],
      [
        'NO_ACTIVE_SITE_ASSIGNMENT',
        "Vous n'avez aucun site actif auquel vous êtes affecté.",
      ],
      [
        'ATTENDANCE_ALREADY_EXISTS',
        "Une présence existe déjà pour aujourd'hui.",
      ],
      [
        'ALREADY_CLOCKED_IN',
        "Votre arrivée est déjà enregistrée pour aujourd'hui.",
      ],
      [
        'ALREADY_CLOCKED_OUT',
        "Votre départ est déjà enregistré pour aujourd'hui.",
      ],
      [
        'ATTENDANCE_NOT_FOUND',
        "Aucune présence active n'a été trouvée pour aujourd'hui.",
      ],
    ];

    for (const [code, friendlyMessage] of knownMessages) {
      if (normalized.includes(code)) {
        return friendlyMessage;
      }
    }

    if (normalized.includes('42501')) {
      return "Accès refusé : vous n'êtes pas autorisé à effectuer cette opération.";
    }

    if (normalized.includes('PGRST116')) {
      return "Les données de pointage attendues sont introuvables. Actualisez la page et réessayez.";
    }

    // Supabase place parfois le détail utile dans details/hint plutôt
    // que dans message. getErrorMessage ne les récupère pas, donc on
    // tente ici de les exposer proprement à l'utilisateur.
    if (
      typeof error === 'object' &&
      error !== null
    ) {
      const details =
        'details' in error &&
        typeof error.details === 'string'
          ? error.details.trim()
          : '';
      const hint =
        'hint' in error &&
        typeof error.hint === 'string'
          ? error.hint.trim()
          : '';

      if (details) {
        return details;
      }

      if (hint) {
        return hint;
      }
    }

    return normalized ||
      'Le pointage n’a pas pu être enregistré. Vérifiez votre connexion, votre GPS et votre affectation au site, puis réessayez.';
  }

  /* ==========================================================
   * CLOCK IN
   * ======================================================== */


  const handleClockIn = async () => {
    if (!profile) {
      toast({
        title: 'Utilisateur introuvable',
        description: 'Votre session utilisateur n’est pas disponible. Reconnectez-vous.',
        variant: 'destructive',
      });
      return;
    }

    if (sites.length === 0) {
      toast({
        title: 'Aucun site autorisé',
        description: "Vous n’êtes affecté à aucun site actif. Vous ne pouvez pas effectuer de pointage.",
        variant: 'destructive',
      });
      return;
    }

    if (todayRecord) {
      toast({
        title: 'Pointage déjà effectué',
        description: 'Une présence existe déjà pour aujourd’hui.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);

    let event: PendingEvent | null = null;

    try {
      if (!navigator.geolocation) {
        throw new Error(
          'La géolocalisation n’est pas disponible sur cet appareil. Elle est nécessaire pour déterminer le site de pointage.'
        );
      }

      toast({
        title: 'Localisation en cours',
        description: 'Nous déterminons automatiquement le site correspondant à votre position.',
      });

      const position = await getPosition(
        Math.max(
          ...sites.map((site) => site.max_gps_accuracy_m),
          100
        ),
        20000
      );

      const detected = detectAssignedSiteFromPosition(
        position,
        sites
      );

      if (!detected) {
        const nearestAssignedSite = sites
          .filter(
            (site) =>
              site.latitude !== null &&
              site.longitude !== null
          )
          .map((site) => ({
            site,
            distanceM: calculateDistance(
              position.coords.latitude,
              position.coords.longitude,
              site.latitude as number,
              site.longitude as number
            ),
          }))
          .sort((a, b) => a.distanceM - b.distanceM)[0];

        if (nearestAssignedSite) {
          throw new Error(
            `Vous êtes actuellement à environ ${Math.round(nearestAssignedSite.distanceM)} m de votre site attribué « ${nearestAssignedSite.site.site_name } ». Vous devez être dans son périmètre autorisé pour pointer.`
          );
        }

        throw new Error(
          "Votre position ne correspond à aucun site qui vous est attribué. Vous ne pouvez pas pointer sur un site auquel vous n’êtes pas affecté."
        );
      }

      const now = new Date();

      event = {
        id: crypto.randomUUID(),
        type: 'CLOCK_IN',
        siteId: detected.site.site_id,
        occurredAt: now.toISOString(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        clientEventId: createClientEventId(),
        attempts: 0,
      };

      console.log('CLOCK_IN EVENT ENVOYÉ', {
        siteId: event.siteId,
        siteName: detected.site.site_name,
        distanceM: Math.round(detected.distanceM),
        latitude: event.latitude,
        longitude: event.longitude,
        accuracyM: event.accuracyM,
        occurredAt: event.occurredAt,
        clientEventId: event.clientEventId,
        deviceRecordedAt: event.occurredAt,
      });

      if (!navigator.onLine) {
        queueEvent(event);

        toast({
          title: 'Arrivée enregistrée hors connexion',
          description:
            `Site détecté : ${detected.site.site_name}. Le pointage sera synchronisé dès que la connexion reviendra.`,
        });

        return;
      }

      await executeAttendanceRpc(event);

      await loadTodayRecord();
      await loadHistory();

      toast({
        title: 'Arrivée enregistrée',
        description:
          `Site détecté par GPS : ${detected.site.site_name} (${Math.round(detected.distanceM)} m du centre du site).`,
      });
    } catch (error: unknown) {
      console.error('Erreur CLOCK_IN:', {
        error,
        event,
        online: navigator.onLine,
      });

      if (
        event &&
        (!navigator.onLine || isNetworkError(error))
      ) {
        queueEvent(event);

        toast({
          title: 'Connexion interrompue',
          description:
            `Le pointage sur ${
              sites.find((site) => site.site_id === event?.siteId)?.site_name ?? 'le site détecté'
            } a été conservé localement et sera synchronisé dès que la connexion reviendra.`,
        });

        return;
      }

      toast({
        title: 'Impossible d’enregistrer l’arrivée',
        description: getAttendanceErrorMessage(error),
        variant: 'destructive',
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
        );

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
        const siteNeedsGps =
          attendanceSite.gps_required ||
          (
            attendanceSite.latitude !== null &&
            attendanceSite.longitude !== null
          );

        let latitude: number | null = null;
        let longitude: number | null = null;
        let accuracyM: number | null = null;

        if (siteNeedsGps) {
          const position = await getPosition(
            attendanceSite.max_gps_accuracy_m,
            20000
          );

          latitude =
            position.coords.latitude;

          longitude =
            position.coords.longitude;

          accuracyM =
            position.coords.accuracy;
        }

        const now = new Date();

        const event: PendingEvent = {
          id: crypto.randomUUID(),
          type: 'CLOCK_OUT',
          siteId: attendanceSite.site_id,
          occurredAt: now.toISOString(),
          latitude,
          longitude,
          accuracyM,
          clientEventId: createClientEventId(),
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
            getAttendanceErrorMessage(error),
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

            toast({
              title: 'Surveillance GPS',
              description: getAttendanceErrorMessage(error),
              variant: 'destructive',
            });
          }
        } finally {
          processingLocationRef.current =
            false;
        }
      },
      [todayRecord, toast]
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

          toast({
            title: 'Impossible de confirmer la sortie',
            description: getAttendanceErrorMessage(error),
            variant: 'destructive',
          });
        }
      },
      [
        loadEvents,
        loadTodayRecord,
        toast,
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

            if (
              !Number.isFinite(
                position.coords.accuracy
              ) ||
              position.coords.accuracy <= 0 ||
              position.coords.accuracy > 10000
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

            if (error.code === 1) {
              toast({
                title: 'Autorisation GPS requise',
                description: 'Autorisez la localisation dans votre navigateur pour continuer la surveillance du site.',
                variant: 'destructive',
              });
            } else if (error.code === 2) {
              toast({
                title: 'Position GPS indisponible',
                description: 'La surveillance GPS ne parvient plus à obtenir votre position.',
                variant: 'destructive',
              });
            } else if (error.code === 3) {
              toast({
                title: 'Délai GPS dépassé',
                description: 'La surveillance GPS n’a pas obtenu votre position à temps. Vérifiez votre localisation.',
                variant: 'destructive',
              });
            }
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
         * ASSIGNED SITES / GPS DETECTION
         * ================================================== */}

        {!todayRecord && (
          <Card className="max-w-2xl mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Site de pointage
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
                        Vous ne pouvez pas effectuer de pointage. Contactez votre responsable.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Le site n’est plus choisi manuellement. Au moment du pointage,
                    votre position GPS est comparée aux sites qui vous sont attribués.
                  </p>

                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm font-medium">Sites auxquels vous êtes affecté</p>
                    <ul className="mt-2 space-y-2">
                      {sites.map((site) => (
                        <li key={site.site_id} className="flex items-center gap-2 text-sm">
                          <MapPin className="h-4 w-4 text-primary" />
                          <span>{site.site_name}</span>
                          <span className="text-xs text-muted-foreground">
                            · rayon {site.location_radius_m} m
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Si vous êtes physiquement sur un autre site, le pointage sera refusé
                    même si ce site appartient à votre structure.
                  </p>
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
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">
                        Site déterminé automatiquement
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Votre GPS sera utilisé au moment du clic pour identifier
                        le site sur lequel vous vous trouvez. Vous ne pouvez pointer
                        que sur un site qui vous est attribué.
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={
                    handleClockIn
                  }
                  disabled={
                    submitting ||
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