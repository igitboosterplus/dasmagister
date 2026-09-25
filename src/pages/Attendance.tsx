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
  | 'network_ip'
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
  wifi_required: boolean;
  allowed_ip: string | null;
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

interface DetectedSite {
  site: SiteContext;
  distanceM: number;
}

/* ============================================================
 * CONSTANTES
 * ========================================================== */

const OFFLINE_QUEUE_KEY =
  'attendance_event_queue_v3';

const EXIT_CONFIRMATION_MS =
  6 * 60 * 1000;

const HISTORY_LIMIT = 30;

/* ============================================================
 * HELPERS
 * ========================================================== */

function createClientEventId(): string {
  return crypto.randomUUID();
}

function loadQueue(): PendingEvent[] {
  try {
    const raw =
      localStorage.getItem(
        OFFLINE_QUEUE_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed: unknown =
      JSON.parse(raw);

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

function saveQueue(
  queue: PendingEvent[]
): void {
  localStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify(queue)
  );
}

function getErrorMessage(
  error: unknown
): string {
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

function isNetworkError(
  error: unknown
): boolean {
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
      const message =
        error.message.toLowerCase();

      return (
        message.includes(
          'failed to fetch'
        ) ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection')
      );
    }
  }

  return false;
}

/* ============================================================
 * GPS
 * ========================================================== */

function getPosition(
  maxAccuracyM = 100,
  timeoutMs = 20000
): Promise<GeolocationPosition> {
  return new Promise(
    (resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            'GEOLOCATION_NOT_AVAILABLE'
          )
        );

        return;
      }

      let watchId:
        | number
        | null = null;

      let timeoutId:
        | ReturnType<typeof setTimeout>
        | null = null;

      let bestPosition:
        | GeolocationPosition
        | null = null;

      const cleanup = () => {
        if (watchId !== null) {
          navigator.geolocation.clearWatch(
            watchId
          );

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
        const {
          latitude,
          longitude,
          accuracy,
        } = position.coords;

        console.log(
          'GPS position reçue:',
          {
            latitude,
            longitude,
            accuracy,
          }
        );

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(accuracy) ||
          accuracy <= 0
        ) {
          return;
        }

        if (
          !bestPosition ||
          accuracy <
          bestPosition.coords.accuracy
        ) {
          bestPosition = position;
        }

        if (
          accuracy <=
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
              )} m.`
            )
          );

          return;
        }

        resolve(bestPosition);
      }, timeoutMs);
    }
  );
}

/* ============================================================
 * DISTANCE
 * ========================================================== */

function calculateDistance(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const earthRadius = 6371000;

  const toRadians = (
    value: number
  ) =>
    (value * Math.PI) / 180;

  const dLatitude =
    toRadians(
      latitude2 - latitude1
    );

  const dLongitude =
    toRadians(
      longitude2 - longitude1
    );

  const a =
    Math.sin(dLatitude / 2) **
    2 +
    Math.cos(
      toRadians(latitude1)
    ) *
    Math.cos(
      toRadians(latitude2)
    ) *
    Math.sin(
      dLongitude / 2
    ) **
    2;

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
 * SITE DETECTION
 * ========================================================== */

/**
 * Recherche le site attribué le plus proche,
 * sans tenir compte du rayon.
 *
 * Cette fonction sert uniquement à informer
 * l'utilisateur de sa distance.
 */
function findNearestAssignedSite(
  position: GeolocationPosition,
  assignedSites: SiteContext[]
): DetectedSite | null {
  const latitude =
    position.coords.latitude;

  const longitude =
    position.coords.longitude;

  const accuracy =
    position.coords.accuracy;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return null;
  }

  const candidates =
    assignedSites
      .filter(
        (site) =>
          site.latitude !== null &&
          site.longitude !== null
      )
      .map((site) => ({
        site,
        distanceM:
          calculateDistance(
            latitude,
            longitude,
            site.latitude as number,
            site.longitude as number
          ),
      }))
      .sort(
        (a, b) =>
          a.distanceM - b.distanceM
      );

  return candidates[0] ?? null;
}

/**
 * Détermine le site attribué et situé
 * dans son périmètre GPS.
 */
function detectAssignedSiteFromPosition(
  position: GeolocationPosition,
  assignedSites: SiteContext[]
): DetectedSite | null {
  const latitude =
    position.coords.latitude;

  const longitude =
    position.coords.longitude;

  const accuracy =
    position.coords.accuracy;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return null;
  }

  const candidates =
    assignedSites
      .filter(
        (site) =>
          site.latitude !== null &&
          site.longitude !== null &&
          accuracy <=
          site.max_gps_accuracy_m
      )
      .map((site) => ({
        site,
        distanceM:
          calculateDistance(
            latitude,
            longitude,
            site.latitude as number,
            site.longitude as number
          ),
      }))
      .filter(
        ({ site, distanceM }) =>
          distanceM <=
          site.location_radius_m
      )
      .sort(
        (a, b) =>
          a.distanceM - b.distanceM
      );

  return candidates[0] ?? null;
}


function formatLateMinutes(
  minutes: number | null | undefined
): string {
  if (
    minutes === null ||
    minutes === undefined ||
    !Number.isFinite(minutes) ||
    minutes <= 0
  ) {
    return '0 min';
  }

  const totalMinutes = Math.floor(minutes);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(
    totalMinutes / 60
  );

  const remainingMinutes =
    totalMinutes % 60;

  return `${hours}h${String(
    remainingMinutes
  ).padStart(2, '0')}`;
}

/* ============================================================
 * FORMAT DISTANCE
 * ========================================================== */

function formatDistance(
  distanceM: number
): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM)} m`;
  }

  return `${(
    distanceM / 1000
  ).toFixed(2)} km`;
}

function getDistanceFromAssignedSite(
  position: GeolocationPosition,
  assignedSites: SiteContext[]
): DetectedSite | null {
  if (assignedSites.length === 0) {
    return null;
  }

  return findNearestAssignedSite(
    position,
    assignedSites
  );
}

/* ============================================================
 * COMPONENT
 * ========================================================== */

export default function Attendance() {
  const { profile } =
    useAuth();

  const { toast } =
    useToast();

  /* ==========================================================
   * DATA
   * ======================================================== */

  const [sites, setSites] =
    useState<SiteContext[]>([]);

  const [
    todayRecord,
    setTodayRecord,
  ] =
    useState<AttendanceRecord | null>(
      null
    );

  const [events, setEvents] =
    useState<AttendanceEvent[]>(
      []
    );

  const [history, setHistory] =
    useState<AttendanceRecord[]>(
      []
    );

  /* ==========================================================
   * DISTANCE / LOCATION UI
   * ======================================================== */

  const [
    nearestSite,
    setNearestSite,
  ] =
    useState<DetectedSite | null>(
      null
    );

  const [
    locationStatus,
    setLocationStatus,
  ] =
    useState<
      | 'idle'
      | 'gps'
      | 'outside'
      | 'network'
      | 'validated'
      | 'error'
    >('idle');

  /* ==========================================================
   * UI
   * ======================================================== */

  const [loading, setLoading] =
    useState(true);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [isOnline, setIsOnline] =
    useState(
      typeof navigator !==
        'undefined'
        ? navigator.onLine
        : true
    );

  const [
    pendingCount,
    setPendingCount,
  ] =
    useState(0);

  const [monitoring, setMonitoring] =
    useState(false);

  const [
    outsideSince,
    setOutsideSince,
  ] =
    useState<string | null>(null);

  /* ==========================================================
   * REFS
   * ======================================================== */

  const watchIdRef =
    useRef<number | null>(null);

  const distanceWatchIdRef =
    useRef<number | null>(null);

  const exitEventRef =
    useRef<AttendanceEvent | null>(
      null
    );

  const exitTimerRef =
    useRef<
      ReturnType<typeof setTimeout> | null
    >(null);

  const lastZoneStateRef =
    useRef<ZoneState>(null);

  const processingLocationRef =
    useRef(false);

  /* ==========================================================
   * LOAD SITES
   * ======================================================== */

  const loadSites =
    useCallback(async (): Promise<
      SiteContext[]
    > => {
      if (!profile) {
        return [];
      }

      const {
        data,
        error,
      } =
        await supabase
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
              gps_required,
              wifi_required,
              allowed_ip
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

      const result: SiteContext[] =
        [];

      for (const row of data ??
        []) {
        const site =
          row.sites;

        if (!site) {
          continue;
        }

        result.push({
          site_id: site.id,
          site_name: site.name,
          latitude:
            site.latitude,
          longitude:
            site.longitude,
          location_radius_m:
            site.location_radius_m,
          max_gps_accuracy_m:
            site.max_gps_accuracy_m,
          gps_required:
            site.gps_required,
          wifi_required:
            site.wifi_required ??
            false,
          allowed_ip:
            site.allowed_ip ??
            null,
        });
      }

      setSites(result);

      return result;
    }, [profile]);

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
      } =
        await supabase
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
      } =
        await supabase
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
        (data ??
          []) as AttendanceEvent[]
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
      } =
        await supabase
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
          .limit(
            HISTORY_LIMIT
          );

      if (error) {
        throw error;
      }

      setHistory(
        (data ??
          []) as AttendanceRecord[]
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
   * ATTENDANCE ERROR MESSAGES
   * ======================================================== */

  function getAttendanceErrorMessage(
    error: unknown
  ): string {
    const message =
      getErrorMessage(error);

    const normalized =
      message
        .replace(
          /^Error:\s*/i,
          ''
        )
        .trim();

    const knownMessages:
      Array<[string, string]> =
      [
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
          'GEOLOCATION_NOT_AVAILABLE',
          "La géolocalisation n'est pas disponible sur cet appareil.",
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
        [
          'NETWORK_IP_NOT_ALLOWED',
          "La position GPS n’a pas pu être validée et le réseau utilisé n’est pas celui d’un site autorisé. Connectez-vous à la box du site ou activez la localisation précise.",
        ],
        [
          'NETWORK_IP_AMBIGUOUS',
          "Plusieurs sites qui vous sont attribués utilisent ce même réseau. Le site de pointage ne peut pas être déterminé automatiquement. Contactez votre responsable.",
        ],
        [
          'INVALID_WIFI_IP',
          "L’adresse IP du réseau utilisé n’est pas autorisée pour ce site.",
        ],
        [
          'GPS_REQUIRED_OFFLINE',
          "Vous êtes hors connexion et le GPS n’est pas disponible. Un pointage hors connexion nécessite une position GPS enregistrée au moment du pointage.",
        ],
        [
          'GPS_OUTSIDE_ASSIGNED_SITES',
          "Vous êtes actuellement hors du périmètre GPS de vos sites attribués.",
        ],
        [
          'NO_OPEN_ATTENDANCE',
          "Aucune présence ouverte n’a été trouvée pour enregistrer votre départ.",
        ],
        [
          'SITE_NOT_IN_EMPLOYEE_STRUCTURE',
          "Ce site n’appartient pas à votre structure.",
        ],
        [
          'SITE_NOT_FOUND_OR_INACTIVE',
          "Ce site n’existe pas ou n’est plus actif.",
        ],
        [
          'EMPLOYEE_INACTIVE',
          "Votre compte employé est désactivé. Contactez votre responsable.",
        ],
        [
          'ACCOUNT_NOT_ACTIVE',
          "Votre compte n’est pas encore actif. Contactez votre responsable pour faire valider votre compte.",
        ],
        [
          'NON_WORKING_DAY',
          "Aucun pointage n’est autorisé aujourd’hui selon le planning du site.",
        ],
      ];

    for (const [
      code,
      friendlyMessage,
    ] of knownMessages) {
      if (
        normalized.includes(code)
      ) {
        return friendlyMessage;
      }
    }

    if (
      normalized.includes('42501')
    ) {
      return "Accès refusé : vous n'êtes pas autorisé à effectuer cette opération.";
    }

    if (
      normalized.includes('PGRST116')
    ) {
      return "Les données de pointage attendues sont introuvables. Actualisez la page et réessayez.";
    }

    if (
      typeof error === 'object' &&
      error !== null
    ) {
      const details =
        'details' in error &&
          typeof error.details ===
          'string'
          ? error.details.trim()
          : '';

      const hint =
        'hint' in error &&
          typeof error.hint ===
          'string'
          ? error.hint.trim()
          : '';

      if (details) {
        return details;
      }

      if (hint) {
        return hint;
      }
    }

    return (
      normalized ||
      'Le pointage n’a pas pu être enregistré. Vérifiez votre connexion, votre GPS et votre affectation au site, puis réessayez.'
    );
  }

  /* ==========================================================
   * RPC
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
            const {
              error,
            } =
              await supabase.rpc(
                'clock_in',
                args
              );

            if (error) {
              console.error(
                'CLOCK_IN RPC ERROR',
                {
                  code:
                    error.code,
                  message:
                    error.message,
                  details:
                    error.details,
                  hint:
                    error.hint,
                }
              );

              throw error;
            }

            break;
          }

          case 'CLOCK_OUT': {
            const {
              error,
            } =
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
            const {
              error,
            } =
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
            const {
              error,
            } =
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
   * RESOLUTION IP
   * ======================================================== */

  const resolveAssignedSiteByNetworkIp =
    useCallback(
      async (): Promise<SiteContext | null> => {
        if (
          !profile ||
          !navigator.onLine
        ) {
          return null;
        }

        const {
          data,
          error,
        } =
          await supabase.rpc(
            'resolve_assigned_sites_by_ip'
          );

        if (error) {
          throw error;
        }

        const matches =
          (data ?? []) as Array<{
            site_id: string;
            site_name: string;
          }>;

        console.log(
          'Résultat résolution IP:',
          matches
        );

        if (
          matches.length === 0
        ) {
          return null;
        }

        if (
          matches.length > 1
        ) {
          throw new Error(
            'NETWORK_IP_AMBIGUOUS'
          );
        }

        return (
          sites.find(
            (site) =>
              site.site_id ===
              matches[0].site_id
          ) ?? null
        );
      },
      [profile, sites]
    );

  /* ==========================================================
   * CLOCK IN
   * ======================================================== */

  const handleClockIn =
    async () => {
      if (!profile) {
        toast({
          title:
            'Utilisateur introuvable',
          description:
            'Votre session utilisateur n’est pas disponible. Reconnectez-vous.',
          variant:
            'destructive',
        });

        return;
      }

      if (sites.length === 0) {
        toast({
          title:
            'Aucun site autorisé',
          description:
            "Vous n’êtes affecté à aucun site actif. Vous ne pouvez pas effectuer de pointage.",
          variant:
            'destructive',
        });

        return;
      }

      if (todayRecord) {
        toast({
          title:
            'Pointage déjà effectué',
          description:
            'Une présence existe déjà pour aujourd’hui.',
          variant:
            'destructive',
        });

        return;
      }

      setSubmitting(true);

      // setNearestSite(null);
      setLocationStatus('gps');

      let gpsPosition:
        | GeolocationPosition
        | null = null;

      let gpsFailure:
        | unknown = null;

      let selectedSite:
        | SiteContext
        | null = null;

      try {
        /* ======================================================
         * 1. GPS PRIORITAIRE
         * ==================================================== */

        if (
          navigator.geolocation
        ) {
          toast({
            title:
              'Localisation en cours',
            description:
              'Nous vérifions d’abord votre position GPS.',
          });

          try {
            gpsPosition =
              await getPosition(
                Math.max(
                  ...sites.map(
                    (site) =>
                      site.max_gps_accuracy_m
                  ),
                  100
                ),
                20000
              );
          } catch (error) {
            gpsFailure = error;
          }
        } else {
          gpsFailure =
            new Error(
              'GEOLOCATION_NOT_AVAILABLE'
            );
        }

        /* ======================================================
         * DISTANCE VERS LE SITE LE PLUS PROCHE
         * ==================================================== */

        if (gpsPosition) {
          const nearest =
            findNearestAssignedSite(
              gpsPosition,
              sites
            );

          setNearestSite(
            nearest
          );

          /* ====================================================
           * SITE DANS LE RAYON
           * ================================================== */

          const detected =
            detectAssignedSiteFromPosition(
              gpsPosition,
              sites
            );

          if (detected) {
            selectedSite =
              detected.site;

            setLocationStatus(
              'validated'
            );

            const now =
              new Date();

            const event: PendingEvent =
            {
              id:
                crypto.randomUUID(),

              type:
                'CLOCK_IN',

              siteId:
                detected.site
                  .site_id,

              occurredAt:
                now.toISOString(),

              latitude:
                gpsPosition.coords
                  .latitude,

              longitude:
                gpsPosition.coords
                  .longitude,

              accuracyM:
                gpsPosition.coords
                  .accuracy,

              clientEventId:
                createClientEventId(),

              attempts: 0,
            };

            /* ================================================
             * HORS CONNEXION
             * ============================================== */

            if (
              !navigator.onLine
            ) {
              queueEvent(event);

              toast({
                title:
                  'Arrivée enregistrée hors connexion',

                description:
                  `Site détecté par GPS : ${detected.site.site_name}. Distance : ${formatDistance(
                    detected.distanceM
                  )}. Le pointage sera synchronisé dès que la connexion reviendra.`,
              });

              return;
            }

            /* ================================================
             * ONLINE
             * ============================================== */

            await executeAttendanceRpc(
              event
            );

            await loadTodayRecord();
            await loadHistory();

            toast({
              title:
                'Arrivée enregistrée',

              description:
                `Site : ${detected.site.site_name}. Distance : ${formatDistance(
                  detected.distanceM
                )}. Validation par GPS.`,
            });

            return;
          }

          /* ====================================================
           * GPS OBTENU MAIS HORS PÉRIMÈTRE
           * ================================================== */

          setLocationStatus(
            'outside'
          );

          gpsFailure =
            new Error(
              'GPS_OUTSIDE_ASSIGNED_SITES'
            );

          if (nearest) {
            toast({
              title:
                'Vous êtes hors du périmètre GPS',
              description:
                `${nearest.site.site_name} est à ${formatDistance(
                  nearest.distanceM
                )}. Rayon autorisé : ${nearest.site.location_radius_m} m. Vérification du réseau du site...`,
            });
          }
        }

        /* ======================================================
         * 2. FALLBACK IP
         * ==================================================== */

        if (
          navigator.onLine
        ) {
          setLocationStatus(
            'network'
          );

          toast({
            title:
              'Vérification du réseau',
            description:
              'Le GPS ne permet pas de valider le site. Nous vérifions maintenant l’IP publique du réseau utilisé.',
          });

          const networkSite =
            await resolveAssignedSiteByNetworkIp();

          if (networkSite) {
            selectedSite =
              networkSite;

            /*
             * IMPORTANT :
             *
             * Pour une validation réseau, on ne transmet pas
             * les coordonnées GPS hors périmètre comme preuve
             * GPS au RPC.
             *
             * Le RPC doit alors effectuer sa validation IP.
             */
            const now =
              new Date();

            const event: PendingEvent =
            {
              id:
                crypto.randomUUID(),

              type:
                'CLOCK_IN',

              siteId:
                networkSite.site_id,

              occurredAt:
                now.toISOString(),

              latitude:
                null,

              longitude:
                null,

              accuracyM:
                null,

              clientEventId:
                createClientEventId(),

              attempts: 0,
            };

            await executeAttendanceRpc(
              event
            );

            setLocationStatus(
              'validated'
            );

            await loadTodayRecord();
            await loadHistory();

            toast({
              title:
                'Arrivée enregistrée par le réseau',

              description:
                `Le réseau/IP autorisé du site « ${networkSite.site_name} » a été validé.`,
            });

            return;
          }
        }

        /* ======================================================
         * 3. FINAL ERROR
         * ==================================================== */

        if (
          !navigator.onLine
        ) {
          throw new Error(
            'GPS_REQUIRED_OFFLINE'
          );
        }

        /*
         * Si plusieurs sites utilisent la même IP.
         */
        if (
          gpsFailure instanceof
          Error &&
          gpsFailure.message ===
          'NETWORK_IP_AMBIGUOUS'
        ) {
          throw gpsFailure;
        }

        /*
         * Le GPS a échoué/hors zone ET
         * aucun réseau autorisé n'a été trouvé.
         *
         * On ne renvoie plus GPS_OUTSIDE_ASSIGNED_SITES
         * comme erreur finale.
         */
        throw new Error(
          'NETWORK_IP_NOT_ALLOWED'
        );
      } catch (error) {
        console.error(
          'Erreur CLOCK_IN:',
          {
            error,
            online:
              navigator.onLine,
            gpsPosition,
            selectedSite,
          }
        );

        setLocationStatus(
          'error'
        );

        toast({
          title:
            'Impossible d’enregistrer l’arrivée',
          description:
            getAttendanceErrorMessage(
              error
            ),
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
        let position:
          | GeolocationPosition
          | null = null;

        let gpsValidForSite =
          false;

        /* ======================================================
         * GPS
         * ==================================================== */

        if (
          navigator.geolocation
        ) {
          try {
            position =
              await getPosition(
                attendanceSite.max_gps_accuracy_m,
                20000
              );

            const detected =
              detectAssignedSiteFromPosition(
                position,
                [attendanceSite]
              );

            gpsValidForSite =
              Boolean(detected);

            if (
              !gpsValidForSite
            ) {
              console.warn(
                'GPS obtenu mais hors périmètre du site.'
              );
            }
          } catch (error) {
            console.warn(
              'GPS indisponible pour le départ.',
              error
            );
          }
        }

        const now =
          new Date();

        /* ======================================================
         * HORS CONNEXION
         * ==================================================== */

        if (
          !navigator.onLine
        ) {
          if (
            !position ||
            !gpsValidForSite
          ) {
            throw new Error(
              'GPS_REQUIRED_OFFLINE'
            );
          }

          const event:
            PendingEvent = {
            id:
              crypto.randomUUID(),

            type:
              'CLOCK_OUT',

            siteId:
              attendanceSite.site_id,

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords
                .latitude,

            longitude:
              position.coords
                .longitude,

            accuracyM:
              position.coords
                .accuracy,

            clientEventId:
              createClientEventId(),

            attempts: 0,
          };

          queueEvent(event);

          setTodayRecord({
            ...todayRecord,
            check_out:
              now.toISOString(),
            check_out_method:
              'gps_auto',
            attendance_status:
              'completed',
          });

          stopMonitoring();

          toast({
            title:
              'Départ enregistré hors connexion',

            description:
              'La position GPS a été conservée. Le départ sera synchronisé dès que la connexion reviendra.',
          });

          return;
        }

        /* ======================================================
         * ONLINE : GPS VALIDE
         * ==================================================== */

        if (
          position &&
          gpsValidForSite
        ) {
          const event:
            PendingEvent = {
            id:
              crypto.randomUUID(),

            type:
              'CLOCK_OUT',

            siteId:
              attendanceSite.site_id,

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords
                .latitude,

            longitude:
              position.coords
                .longitude,

            accuracyM:
              position.coords
                .accuracy,

            clientEventId:
              createClientEventId(),

            attempts: 0,
          };

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
              'Votre départ a été validé avec votre position GPS.',
          });

          return;
        }

        /* ======================================================
         * ONLINE : FALLBACK IP
         * ==================================================== */

        toast({
          title:
            'Vérification du réseau',
          description:
            'La position GPS ne permet pas de valider votre départ. Vérification de l’IP du réseau du site...',
        });

        const networkSite =
          await resolveAssignedSiteByNetworkIp();

        if (
          !networkSite ||
          networkSite.site_id !==
          attendanceSite.site_id
        ) {
          throw new Error(
            'NETWORK_IP_NOT_ALLOWED'
          );
        }

        /*
         * Important :
         * null GPS = validation réseau.
         */
        const event:
          PendingEvent = {
          id:
            crypto.randomUUID(),

          type:
            'CLOCK_OUT',

          siteId:
            attendanceSite.site_id,

          occurredAt:
            now.toISOString(),

          latitude:
            null,

          longitude:
            null,

          accuracyM:
            null,

          clientEventId:
            createClientEventId(),

          attempts: 0,
        };

        await executeAttendanceRpc(
          event
        );

        await loadTodayRecord();
        await loadEvents();
        await loadHistory();

        stopMonitoring();

        toast({
          title:
            'Départ enregistré par le réseau',

          description:
            `Le réseau/IP autorisé du site « ${attendanceSite.site_name} » a été validé.`,
        });
      } catch (error) {
        console.error(
          'Erreur CLOCK_OUT:',
          error
        );

        toast({
          title:
            'Impossible d’enregistrer le départ',
          description:
            getAttendanceErrorMessage(
              error
            ),
          variant:
            'destructive',
        });
      } finally {
        setSubmitting(false);
      }
    };

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
          } =
            await supabase.rpc(
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
        } catch (error) {
          console.error(
            'Erreur confirmation sortie:',
            error
          );

          toast({
            title:
              'Impossible de confirmer la sortie',

            description:
              getAttendanceErrorMessage(
                error
              ),

            variant:
              'destructive',
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

          const event:
            PendingEvent = {
            id:
              crypto.randomUUID(),

            type:
              'SITE_EXIT',

            siteId:
              todayRecord.site_id,

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords
                .latitude,

            longitude:
              position.coords
                .longitude,

            accuracyM:
              position.coords
                .accuracy,

            clientEventId:
              createClientEventId(),

            attempts: 0,
          };

          if (
            !navigator.onLine
          ) {
            queueEvent(event);

            setOutsideSince(
              now.toISOString()
            );

            return;
          }

          const {
            data,
            error,
          } =
            await supabase.rpc(
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
        } catch (error) {
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
                position.coords
                  .latitude,

              longitude:
                position.coords
                  .longitude,

              accuracyM:
                position.coords
                  .accuracy,

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
              title:
                'Surveillance GPS',
              description:
                getAttendanceErrorMessage(
                  error
                ),
              variant:
                'destructive',
            });
          }
        } finally {
          processingLocationRef.current =
            false;
        }
      },
      [
        confirmExit,
        todayRecord,
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

        if (
          lastZoneStateRef.current ===
          'inside'
        ) {
          return;
        }

        lastZoneStateRef.current =
          'inside';

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

        const event:
          PendingEvent = {
          id:
            crypto.randomUUID(),

          type:
            'SITE_ENTER',

          siteId:
            todayRecord.site_id,

          occurredAt:
            now.toISOString(),

          latitude:
            position.coords
              .latitude,

          longitude:
            position.coords
              .longitude,

          accuracyM:
            position.coords
              .accuracy,

          clientEventId:
            createClientEventId(),

          attempts: 0,
        };

        try {
          if (
            !navigator.onLine
          ) {
            queueEvent(event);
            return;
          }

          await executeAttendanceRpc(
            event
          );

          await loadEvents();
        } catch (error) {
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
        queueEvent,
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
              currentSite.latitude ===
              null ||
              currentSite.longitude ===
              null
            ) {
              return;
            }

            if (
              currentSite.max_gps_accuracy_m >
              0 &&
              position.coords
                .accuracy >
              currentSite.max_gps_accuracy_m
            ) {
              return;
            }

            if (
              !Number.isFinite(
                position.coords
                  .accuracy
              ) ||
              position.coords
                .accuracy <= 0 ||
              position.coords
                .accuracy > 10000
            ) {
              return;
            }

            const distance =
              calculateDistance(
                position.coords
                  .latitude,
                position.coords
                  .longitude,
                currentSite.latitude,
                currentSite.longitude
              );

            const isInside =
              distance <=
              currentSite.location_radius_m;

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

            if (isInside) {
              await handleInside(
                position
              );

              return;
            }

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

            if (
              error.code === 1
            ) {
              toast({
                title:
                  'Autorisation GPS requise',

                description:
                  'Autorisez la localisation dans votre navigateur pour continuer la surveillance du site.',

                variant:
                  'destructive',
              });
            } else if (
              error.code === 2
            ) {
              toast({
                title:
                  'Position GPS indisponible',

                description:
                  'La surveillance GPS ne parvient plus à obtenir votre position.',

                variant:
                  'destructive',
              });
            } else if (
              error.code === 3
            ) {
              toast({
                title:
                  'Délai GPS dépassé',

                description:
                  'La surveillance GPS n’a pas obtenu votre position à temps. Vérifiez votre localisation.',

                variant:
                  'destructive',
              });
            }
          },
          {
            enableHighAccuracy:
              true,

            maximumAge:
              30000,

            timeout:
              20000,
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
   * STOP MONITORING
   * ======================================================== */

  const stopMonitoring =
    useCallback(() => {
      if (
        watchIdRef.current !==
        null
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


  /* ============================================================
* GPS DISTANCE PREVIEW
* ========================================================== */

  useEffect(() => {
    /*
     * La distance est utile uniquement avant
     * l'enregistrement de l'arrivée.
     */
    if (
      todayRecord ||
      sites.length === 0 ||
      !navigator.geolocation
    ) {
      if (
        distanceWatchIdRef.current !== null
      ) {
        navigator.geolocation.clearWatch(
          distanceWatchIdRef.current
        );

        distanceWatchIdRef.current = null;
      }

      return;
    }

    const watchId =
      navigator.geolocation.watchPosition(
        (position) => {
          const accuracy =
            position.coords.accuracy;

          /*
           * On ignore les positions manifestement
           * invalides.
           */
          if (
            !Number.isFinite(
              position.coords.latitude
            ) ||
            !Number.isFinite(
              position.coords.longitude
            ) ||
            !Number.isFinite(accuracy) ||
            accuracy <= 0 ||
            accuracy > 10000
          ) {
            return;
          }

          const nearest =
            getDistanceFromAssignedSite(
              position,
              sites
            );

          if (nearest) {
            setNearestSite(nearest);
          }
        },
        (error) => {
          console.warn(
            'GPS distance preview:',
            error
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
        }
      );

    distanceWatchIdRef.current =
      watchId;

    return () => {
      navigator.geolocation.clearWatch(
        watchId
      );

      if (
        distanceWatchIdRef.current ===
        watchId
      ) {
        distanceWatchIdRef.current =
          null;
      }
    };
  }, [
    sites,
    todayRecord,
  ]);

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
   * ONLINE / OFFLINE
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

      const remaining:
        PendingEvent[] = [];

      let synchronized = 0;

      for (const event of queue) {
        try {
          await executeAttendanceRpc(
            event
          );

          synchronized++;
        } catch (error) {
          console.error(
            'Erreur synchronisation:',
            event,
            error
          );

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

          toast({
            title:
              'Pointage non synchronisé',

            description:
              getAttendanceErrorMessage(
                error
              ),

            variant:
              'destructive',
          });
        }
      }

      saveQueue(
        remaining
      );

      setPendingCount(
        remaining.length
      );

      if (
        synchronized > 0
      ) {
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

          if (
            navigator.onLine
          ) {
            await syncQueue();
          }
        } catch (error) {
          console.error(
            'Erreur initialisation Attendance:',
            error
          );

          toast({
            title:
              'Erreur de chargement',

            description:
              getErrorMessage(
                error
              ),

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
        return `Présent — retard ${formatLateMinutes(
          record.late_minutes
        )}`;
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
         * ASSIGNED SITES
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
                        Vous ne pouvez pas effectuer de pointage.
                        Contactez votre responsable.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">

                  <p className="text-sm text-muted-foreground">
                    Le GPS est utilisé en priorité pour
                    déterminer automatiquement votre site.
                    Si le GPS ne permet pas de confirmer le site,
                    le réseau autorisé du site peut être utilisé
                    comme solution de secours.
                  </p>

                  {/* ==================================================
                   * DISTANCE
                   * ================================================ */}

                  {nearestSite && (
                    <div
                      className={`rounded-lg border p-4 ${nearestSite.distanceM <=
                          nearestSite.site.location_radius_m
                          ? 'border-green-200 bg-green-50'
                          : 'border-amber-200 bg-amber-50'
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        {nearestSite.distanceM <=
                          nearestSite.site.location_radius_m ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                        )}

                        <div className="flex-1">
                          <p className="font-medium">
                            {nearestSite.distanceM <=
                              nearestSite.site.location_radius_m
                              ? 'Vous êtes dans le périmètre autorisé'
                              : 'Vous êtes hors du périmètre GPS'}
                          </p>

                          <p className="text-sm mt-1">
                            Votre distance par rapport au site :
                          </p>

                          <p className="font-semibold text-sm mt-1">
                            {nearestSite.site.site_name}
                          </p>

                          <div className="flex flex-wrap items-baseline gap-2 mt-2">
                            <span className="text-2xl font-bold">
                              {formatDistance(
                                nearestSite.distanceM
                              )}
                            </span>

                            <span className="text-sm text-muted-foreground">
                              / rayon autorisé{' '}
                              {nearestSite.site.location_radius_m} m
                            </span>
                          </div>

                          {nearestSite.distanceM >
                            nearestSite.site.location_radius_m && (
                              <p className="text-xs text-amber-700 mt-2">
                                Vous êtes à{' '}
                                <strong>
                                  {formatDistance(
                                    nearestSite.distanceM -
                                    nearestSite.site
                                      .location_radius_m
                                  )}
                                </strong>{' '}
                                au-delà du rayon autorisé.
                              </p>
                            )}

                          {nearestSite.distanceM <=
                            nearestSite.site.location_radius_m && (
                              <p className="text-xs text-green-700 mt-2">
                                Votre position est suffisamment proche
                                du site pour permettre une validation GPS.
                              </p>
                            )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ==================================================
                   * STATUS LOCATION
                   * ================================================ */}

                  {locationStatus ===
                    'network' && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-center gap-2">
                          <Wifi className="h-4 w-4 text-blue-600" />

                          <span className="text-sm font-medium text-blue-900">
                            Vérification du réseau du site...
                          </span>
                        </div>

                        <p className="text-xs text-blue-800 mt-1">
                          Nous vérifions l’adresse IP publique
                          du réseau auquel votre appareil est connecté.
                        </p>
                      </div>
                    )}

                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm font-medium">
                      Sites auxquels vous êtes affecté
                    </p>

                    <ul className="mt-2 space-y-2">
                      {sites.map(
                        (site) => (
                          <li
                            key={
                              site.site_id
                            }
                            className="flex items-center gap-2 text-sm"
                          >
                            <MapPin className="h-4 w-4 text-primary" />

                            <span>
                              {
                                site.site_name
                              }
                            </span>

                            <span className="text-xs text-muted-foreground">
                              · rayon{' '}
                              {
                                site.location_radius_m
                              }{' '}
                              m
                            </span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Si le GPS ne permet pas de valider votre
                    position, l’application peut vérifier le
                    réseau/IP autorisé du site lorsqu’il est
                    configuré.
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

            {/* ==================================================
             * NO ATTENDANCE
             * ================================================ */}

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
                        Votre GPS sera utilisé en premier.
                        Si votre position GPS ne permet pas
                        de valider le site, le réseau/IP autorisé
                        peut être utilisé comme solution de secours.
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

            {/* ==================================================
             * ACTIVE ATTENDANCE
             * ================================================ */}

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
                        <strong>
                          {formatLateMinutes(
                            todayRecord.late_minutes
                          )}
                        </strong>
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
                          Départ validé par GPS.
                        </p>
                      )}

                    {todayRecord.check_out_method ===
                      'network_ip' && (
                        <p className="text-xs text-green-600 mt-1">
                          Départ validé par le réseau / IP autorisé du site.
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
                              : event.event_method ===
                                'network_ip'
                                ? 'Réseau / IP'
                                : 'Manuel'}
                          </p>

                          {event.distance_m !==
                            null &&
                            event.distance_m !==
                            undefined && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Distance :{' '}
                                {formatDistance(
                                  event.distance_m
                                )}
                              </p>
                            )}

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