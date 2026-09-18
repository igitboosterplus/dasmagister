import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Wifi,
  WifiOff,
  LogIn,
  LogOut,
  AlertTriangle,
  Building2,
} from 'lucide-react';

import {
  format,
  formatDistanceToNow,
  isToday,
  parseISO,
} from 'date-fns';

import { fr } from 'date-fns/locale';

/* ============================================================
 * TYPES
 * ========================================================== */

type AttendanceEventType = 'check_in' | 'check_out';

type AttendanceSource = 'online' | 'offline' | 'manual';

type AttendanceValidationStatus =
  | 'valid'
  | 'late'
  | 'out_of_zone'
  | 'low_accuracy'
  | 'no_gps'
  | 'pending_review'
  | 'rejected';

type CheckMethod =
  | 'wifi'
  | 'gps'
  | 'manual'
  | 'manager'
  | 'system';

interface SiteContext {
  id: string;
  name: string;

  latitude: number | null;
  longitude: number | null;

  location_radius_m: number;
  max_gps_accuracy_m: number;

  gps_required: boolean;

  wifi_ssid: string | null;
  wifi_required: boolean;

  offline_attendance_enabled: boolean;

  timezone: string;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  site_id: string;

  attendance_date: string;

  check_in: string | null;
  check_out: string | null;

  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_in_accuracy_m: number | null;
  check_in_distance_m: number | null;

  check_out_latitude: number | null;
  check_out_longitude: number | null;
  check_out_accuracy_m: number | null;
  check_out_distance_m: number | null;

  validation_method: string | null;
  validation_status: string | null;

  attendance_source: AttendanceSource;
  is_offline: boolean;

  client_timestamp: string | null;
  synced_at: string | null;

  device_recorded_at: string | null;
  server_received_at: string | null;

  validated_at: string | null;
  validation_reason: string | null;

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

  event_type: AttendanceEventType;
  event_method: string;

  occurred_at: string;

  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;

  is_confirmed: boolean;
  confirmed_at: string | null;

  client_event_id: string | null;
  device_recorded_at: string | null;
  server_received_at: string;

  synced_at: string | null;
}

interface PendingEvent {
  id: string;

  type: AttendanceEventType;

  siteId: string;

  occurredAt: string;

  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;

  clientEventId: string;

  deviceRecordedAt: string;

  attempts: number;

  createdAt: string;
}

/* ============================================================
 * CONSTANTS
 * ========================================================== */

const QUEUE_KEY = 'attendance_event_queue_v4';

const GPS_DEFAULT_ACCURACY = 100;

const GPS_TIMEOUT = 20_000;

/* ============================================================
 * HELPERS
 * ========================================================== */

const generateClientEventId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 15)}`;
};

const getToday = (): string => {
  return format(new Date(), 'yyyy-MM-dd');
};

const formatDateTime = (
  value: string | null | undefined,
): string => {
  if (!value) return '—';

  try {
    return format(parseISO(value), 'dd/MM/yyyy HH:mm', {
      locale: fr,
    });
  } catch {
    return value;
  }
};

const formatTime = (
  value: string | null | undefined,
): string => {
  if (!value) return '—';

  return value.substring(0, 5);
};

const getErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const value = error as {
    code?: string;
  };

  return value.code ?? null;
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const value = error as {
    message?: string;
  };

  return value.message ?? '';
};

const calculateDistance = (
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number => {
  const earthRadius = 6_371_000;

  const lat1 = (latitude1 * Math.PI) / 180;
  const lat2 = (latitude2 * Math.PI) / 180;

  const deltaLat =
    ((latitude2 - latitude1) * Math.PI) / 180;

  const deltaLongitude =
    ((longitude2 - longitude1) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLongitude / 2) ** 2;

  const c =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
};

/* ============================================================
 * GPS
 * ========================================================== */

interface PositionResult {
  latitude: number;
  longitude: number;
  accuracy: number;
}

const getPosition = (
  maxAccuracyM = GPS_DEFAULT_ACCURACY,
  timeoutMs = GPS_TIMEOUT,
): Promise<PositionResult> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          'La géolocalisation n’est pas disponible sur cet appareil.',
        ),
      );

      return;
    }

    let settled = false;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const result: PositionResult = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };

        if (result.accuracy > maxAccuracyM) {
          return;
        }

        if (settled) return;

        settled = true;

        navigator.geolocation.clearWatch(watchId);

        resolve(result);
      },
      (error) => {
        if (settled) return;

        settled = true;

        navigator.geolocation.clearWatch(watchId);

        reject(error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: timeoutMs,
      },
    );

    window.setTimeout(() => {
      if (settled) return;

      settled = true;

      navigator.geolocation.clearWatch(watchId);

      reject(
        new Error(
          'Impossible d’obtenir une position GPS suffisamment précise.',
        ),
      );
    }, timeoutMs + 1_000);
  });
};

/* ============================================================
 * COMPONENT
 * ========================================================== */

export default function Attendance() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [sites, setSites] = useState<SiteContext[]>([]);

  const [selectedSiteId, setSelectedSiteId] =
    useState<string | null>(null);

  const [todayRecord, setTodayRecord] =
    useState<AttendanceRecord | null>(null);

  const [events, setEvents] = useState<AttendanceEvent[]>(
    [],
  );

  const [history, setHistory] = useState<
    AttendanceRecord[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const [isOnline, setIsOnline] =
    useState(navigator.onLine);

  const [pendingEvents, setPendingEvents] = useState<
    PendingEvent[]
  >([]);

  const mountedRef = useRef(true);

  /* ==========================================================
   * SELECTED SITE
   * ======================================================== */

  const selectedSite = useMemo(() => {
    if (!selectedSiteId) return null;

    return (
      sites.find(
        (site) => site.id === selectedSiteId,
      ) ?? null
    );
  }, [sites, selectedSiteId]);

  /* ==========================================================
   * LOAD ASSIGNED SITES
   * ======================================================== */

  const loadSites = useCallback(async () => {
    if (!profile?.id) return;

    const { data, error } = await supabase
      .from('employee_sites')
      .select(
        `
        site_id,
        sites (
          id,
          name,
          latitude,
          longitude,
          location_radius_m,
          max_gps_accuracy_m,
          gps_required,
          wifi_ssid,
          wifi_required,
          offline_attendance_enabled,
          timezone
        )
      `,
      )
      .eq('employee_id', profile.id)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    const mappedSites: SiteContext[] = [];

    for (const assignment of data ?? []) {
      const site = Array.isArray(assignment.sites)
        ? assignment.sites[0]
        : assignment.sites;

      if (!site) continue;

      mappedSites.push({
        id: site.id,
        name: site.name,

        latitude: site.latitude ?? null,
        longitude: site.longitude ?? null,

        location_radius_m:
          site.location_radius_m ?? 100,

        max_gps_accuracy_m:
          site.max_gps_accuracy_m ?? 100,

        gps_required:
          site.gps_required ?? false,

        wifi_ssid:
          site.wifi_ssid ?? null,

        wifi_required:
          site.wifi_required ?? false,

        offline_attendance_enabled:
          site.offline_attendance_enabled ?? false,

        timezone:
          site.timezone || 'Africa/Douala',
      });
    }

    if (!mountedRef.current) return;

    setSites(mappedSites);

    if (
      mappedSites.length > 0 &&
      !selectedSiteId
    ) {
      setSelectedSiteId(mappedSites[0].id);
    }
  }, [profile?.id, selectedSiteId]);

  /* ==========================================================
   * LOAD TODAY
   * ======================================================== */

  const loadTodayRecord = useCallback(async () => {
    if (!profile?.id) return;

    const today = getToday();

    const { data, error } = await supabase
      .from('attendances')
      .select(
        `
        id,
        employee_id,
        site_id,
        attendance_date,
        check_in,
        check_out,

        check_in_latitude,
        check_in_longitude,
        check_in_accuracy_m,
        check_in_distance_m,

        check_out_latitude,
        check_out_longitude,
        check_out_accuracy_m,
        check_out_distance_m,

        validation_method,
        validation_status,

        attendance_source,
        is_offline,

        client_timestamp,
        synced_at,

        device_recorded_at,
        server_received_at,

        validated_at,
        validation_reason,

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
      `,
      )
      .eq('employee_id', profile.id)
      .eq('attendance_date', today)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!mountedRef.current) return;

    setTodayRecord(
      (data as AttendanceRecord | null) ?? null,
    );
  }, [profile?.id]);

  /* ==========================================================
   * LOAD EVENTS
   * ======================================================== */

  const loadEvents = useCallback(async () => {
    if (!todayRecord?.id) {
      setEvents([]);
      return;
    }

    const { data, error } = await supabase
      .from('attendance_events')
      .select(
        `
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
        device_recorded_at,
        server_received_at,
        synced_at
      `,
      )
      .eq('attendance_id', todayRecord.id)
      .order('occurred_at', {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    if (!mountedRef.current) return;

    setEvents(
      (data ?? []) as AttendanceEvent[],
    );
  }, [todayRecord?.id]);

  /* ==========================================================
   * LOAD HISTORY
   * ======================================================== */

  const loadHistory = useCallback(async () => {
    if (!profile?.id) return;

    const { data, error } = await supabase
      .from('attendances')
      .select(
        `
        id,
        employee_id,
        site_id,
        attendance_date,
        check_in,
        check_out,

        check_in_latitude,
        check_in_longitude,
        check_in_accuracy_m,
        check_in_distance_m,

        check_out_latitude,
        check_out_longitude,
        check_out_accuracy_m,
        check_out_distance_m,

        validation_method,
        validation_status,

        attendance_source,
        is_offline,

        client_timestamp,
        synced_at,

        device_recorded_at,
        server_received_at,

        validated_at,
        validation_reason,

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
      `,
      )
      .eq('employee_id', profile.id)
      .order('attendance_date', {
        ascending: false,
      })
      .limit(30);

    if (error) {
      throw error;
    }

    if (!mountedRef.current) return;

    setHistory(
      (data ?? []) as AttendanceRecord[],
    );
  }, [profile?.id]);

  /* ==========================================================
   * QUEUE
   * ======================================================== */

  const readQueue = useCallback((): PendingEvent[] => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);

      if (!raw) return [];

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed;
    } catch (error) {
      console.error(
        'Erreur lecture file attendance:',
        error,
      );

      return [];
    }
  }, []);

  const writeQueue = useCallback(
    (queue: PendingEvent[]) => {
      localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify(queue),
      );

      setPendingEvents(queue);
    },
    [],
  );

  const addToQueue = useCallback(
    (event: PendingEvent) => {
      const queue = readQueue();

      queue.push(event);

      writeQueue(queue);
    },
    [readQueue, writeQueue],
  );

  const removeFromQueue = useCallback(
    (clientEventId: string) => {
      const queue = readQueue().filter(
        (event) =>
          event.clientEventId !== clientEventId,
      );

      writeQueue(queue);
    },
    [readQueue, writeQueue],
  );

  /* ==========================================================
   * RPC
   * ======================================================== */

  const executeAttendanceRpc = useCallback(
    async (
      event: PendingEvent,
    ) => {
      const rpcName =
        event.type === 'check_in'
          ? 'clock_in'
          : 'clock_out';

      const { data, error } =
        await supabase.rpc(rpcName, {
          p_site_id: event.siteId,

          p_latitude: event.latitude,

          p_longitude: event.longitude,

          p_accuracy_m: event.accuracyM,

          p_occurred_at: event.occurredAt,

          p_client_event_id:
            event.clientEventId,

          p_device_recorded_at:
            event.deviceRecordedAt,
        });

      if (error) {
        throw error;
      }

      return data;
    },
    [],
  );

  /* ==========================================================
   * SYNC OFFLINE QUEUE
   * ======================================================== */

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;

    const queue = readQueue();

    if (queue.length === 0) return;

    for (const event of queue) {
      try {
        await executeAttendanceRpc(event);

        removeFromQueue(
          event.clientEventId,
        );
      } catch (error) {
        const code = getErrorCode(error);

        const message =
          getErrorMessage(error);

        console.error(
          'Erreur synchronisation attendance:',
          {
            code,
            message,
            event,
          },
        );

        /*
         * Les erreurs métier ne sont pas supprimées.
         * Elles restent visibles dans la file pour éviter
         * de perdre le pointage offline.
         */
        break;
      }
    }

    await loadTodayRecord();
    await loadHistory();
  }, [
    executeAttendanceRpc,
    loadHistory,
    loadTodayRecord,
    readQueue,
    removeFromQueue,
  ]);

  /* ==========================================================
   * REFRESH
   * ======================================================== */

  const refreshAll = useCallback(async () => {
    if (!profile?.id) return;

    try {
      setRefreshing(true);

      await loadSites();
      await loadTodayRecord();
      await loadHistory();
    } catch (error) {
      console.error(
        'Erreur actualisation attendance:',
        error,
      );

      toast({
        title: 'Erreur',
        description:
          'Impossible d’actualiser les données de présence.',
        variant: 'destructive',
      });
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [
    profile?.id,
    loadHistory,
    loadSites,
    loadTodayRecord,
    toast,
  ]);

  /* ==========================================================
   * NETWORK
   * ======================================================== */

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);

      void syncQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener(
      'online',
      handleOnline,
    );

    window.addEventListener(
      'offline',
      handleOffline,
    );

    return () => {
      window.removeEventListener(
        'online',
        handleOnline,
      );

      window.removeEventListener(
        'offline',
        handleOffline,
      );
    };
  }, [syncQueue]);

  /* ==========================================================
   * INITIALIZATION
   * ======================================================== */

  useEffect(() => {
    mountedRef.current = true;

    const initialize = async () => {
      if (!profile?.id) return;

      try {
        setLoading(true);

        setPendingEvents(readQueue());

        await loadSites();
        await loadTodayRecord();
        await loadHistory();

        if (navigator.onLine) {
          await syncQueue();
        }
      } catch (error) {
        console.error(
          'Erreur initialisation attendance:',
          error,
        );

        toast({
          title: 'Erreur',
          description:
            'Impossible de charger votre espace de pointage.',
          variant: 'destructive',
        });
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      mountedRef.current = false;
    };
  }, [
    profile?.id,
    loadHistory,
    loadSites,
    loadTodayRecord,
    readQueue,
    syncQueue,
    toast,
  ]);

  /* ==========================================================
   * LOAD EVENTS WHEN TODAY RECORD CHANGES
   * ======================================================== */

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  /* ==========================================================
   * FRIENDLY ERRORS
   * ======================================================== */

  const getFriendlyError = (
    error: unknown,
  ): string => {
    const code = getErrorCode(error);

    switch (code) {
      case 'EMPLOYEE_NOT_ASSIGNED_TO_SITE':
        return 'Vous n’êtes pas affecté à ce site.';

      case 'SITE_NOT_FOUND':
        return 'Le site sélectionné est introuvable.';

      case 'SITE_INACTIVE':
        return 'Ce site est actuellement désactivé.';

      case 'NO_ACTIVE_SITE_ASSIGNMENT':
        return 'Vous n’avez aucune affectation active sur ce site.';

      case 'ATTENDANCE_ALREADY_EXISTS':
        return 'Un pointage existe déjà pour aujourd’hui.';

      case 'ALREADY_CLOCKED_IN':
        return 'Vous avez déjà enregistré votre arrivée.';

      case 'ALREADY_CLOCKED_OUT':
        return 'Vous avez déjà enregistré votre départ.';

      case 'ATTENDANCE_NOT_FOUND':
        return 'Aucun pointage actif n’a été trouvé.';

      case 'GPS_OUTSIDE_SITE':
        return 'Vous êtes en dehors de la zone autorisée du site.';

      case 'GPS_ACCURACY_INSUFFICIENT':
        return 'La précision GPS est insuffisante.';

      case 'GEOLOCATION_NOT_CONFIGURED':
        return 'La géolocalisation n’est pas configurée pour ce site.';

      case 'OFFLINE_ATTENDANCE_DISABLED':
        return 'Le pointage hors connexion est désactivé pour ce site.';

      case 'WIFI_REQUIRED':
        return 'Ce site nécessite une connexion au réseau Wi-Fi autorisé.';

      case 'WIFI_VALIDATION_FAILED':
        return 'Le réseau Wi-Fi n’a pas pu être validé.';

      case 'SCHEDULE_NOT_AVAILABLE':
        return 'Aucun horaire de travail n’est configuré pour ce jour.';

      case 'NOT_WORKING_DAY':
        return 'Ce jour n’est pas prévu comme jour travaillé.';

      case 'PGRST116':
        return 'Les données demandées sont introuvables.';

      case '42501':
        return 'Vous n’êtes pas autorisé à effectuer cette opération.';

      default:
        return (
          getErrorMessage(error) ||
          'Une erreur est survenue pendant le pointage.'
        );
    }
  };

  /* ==========================================================
   * CREATE PENDING EVENT
   * ======================================================== */

  const createPendingEvent = (
    type: AttendanceEventType,
    siteId: string,
    position: PositionResult | null,
  ): PendingEvent => {
    const now = new Date();

    return {
      id: generateClientEventId(),

      type,

      siteId,

      occurredAt: now.toISOString(),

      latitude:
        position?.latitude ?? null,

      longitude:
        position?.longitude ?? null,

      accuracyM:
        position?.accuracy ?? null,

      clientEventId:
        generateClientEventId(),

      deviceRecordedAt:
        now.toISOString(),

      attempts: 0,

      createdAt:
        now.toISOString(),
    };
  };

  /* ==========================================================
   * GET GPS IF REQUIRED
   * ======================================================== */

  const getPositionForSite = async (
    site: SiteContext,
  ): Promise<PositionResult | null> => {
    /*
     * Pour le moment :
     *
     * - si GPS requis → GPS obligatoire
     * - sinon → on tente le GPS mais on continue
     *   si celui-ci n'est pas disponible.
     *
     * La validation Wi-Fi sera ajoutée ultérieurement.
     */

    if (
      !site.gps_required &&
      !site.latitude &&
      !site.longitude
    ) {
      return null;
    }

    try {
      return await getPosition(
        site.max_gps_accuracy_m ||
          GPS_DEFAULT_ACCURACY,
      );
    } catch (error) {
      if (site.gps_required) {
        throw error;
      }

      console.warn(
        'GPS non disponible, poursuite sans GPS.',
        error,
      );

      return null;
    }
  };

  /* ==========================================================
   * CLOCK IN
   * ======================================================== */

  const handleClockIn = async () => {
    if (!profile?.id) return;

    if (actionLoading) return;

    if (todayRecord?.check_in) {
      toast({
        title: 'Arrivée déjà enregistrée',
        description:
          'Votre arrivée a déjà été enregistrée pour aujourd’hui.',
      });

      return;
    }

    if (!selectedSite) {
      toast({
        title: 'Site requis',
        description:
          'Sélectionnez le site sur lequel vous travaillez.',
        variant: 'destructive',
      });

      return;
    }

    try {
      setActionLoading(true);

      /*
       * Wi-Fi :
       *
       * Pour l'instant on ne vérifie PAS le SSID.
       * Le mécanisme de validation réseau sera ajouté
       * dans une prochaine étape.
       */
      if (
        selectedSite.wifi_required
      ) {
        console.info(
          'Site avec Wi-Fi requis : validation Wi-Fi temporairement désactivée.',
        );
      }

      const position =
        await getPositionForSite(
          selectedSite,
        );

      /*
       * Vérification GPS locale lorsqu'une
       * configuration de site est disponible.
       */
      if (
        position &&
        selectedSite.latitude !== null &&
        selectedSite.longitude !== null
      ) {
        const distance =
          calculateDistance(
            position.latitude,
            position.longitude,
            selectedSite.latitude,
            selectedSite.longitude,
          );

        if (
          distance >
          selectedSite.location_radius_m
        ) {
          throw new Error(
            'GPS_OUTSIDE_SITE',
          );
        }

        if (
          position.accuracy >
          selectedSite.max_gps_accuracy_m
        ) {
          throw new Error(
            'GPS_ACCURACY_INSUFFICIENT',
          );
        }
      }

      const pendingEvent =
        createPendingEvent(
          'check_in',
          selectedSite.id,
          position,
        );

      /*
       * Hors connexion.
       */
      if (!navigator.onLine) {
        if (
          !selectedSite.offline_attendance_enabled
        ) {
          throw new Error(
            'OFFLINE_ATTENDANCE_DISABLED',
          );
        }

        addToQueue(pendingEvent);

        toast({
          title: 'Pointage enregistré localement',
          description:
            'Votre arrivée sera synchronisée dès que la connexion sera rétablie.',
        });

        await loadTodayRecord();

        return;
      }

      /*
       * En ligne.
       */
      await executeAttendanceRpc(
        pendingEvent,
      );

      toast({
        title: 'Arrivée enregistrée',
        description:
          'Votre pointage d’arrivée a été enregistré avec succès.',
      });

      await loadTodayRecord();
      await loadHistory();
    } catch (error) {
      console.error(
        'Erreur pointage arrivée:',
        error,
      );

      /*
       * Si la connexion vient de tomber
       * pendant la requête, on peut basculer
       * vers le mode offline.
       */
      if (
        !navigator.onLine &&
        selectedSite.offline_attendance_enabled
      ) {
        try {
          const fallbackEvent =
            createPendingEvent(
              'check_in',
              selectedSite.id,
              null,
            );

          addToQueue(fallbackEvent);

          toast({
            title:
              'Pointage placé en attente',
            description:
              'La connexion a été interrompue. Le pointage sera synchronisé ultérieurement.',
          });

          return;
        } catch {
          // Continuer vers l'erreur standard.
        }
      }

      const message =
        getErrorMessage(error);

      const code =
        getErrorCode(error);

      /*
       * Les erreurs générées localement
       * peuvent ne pas avoir de code Supabase.
       */
      const friendly =
        code ||
        message === 'GPS_OUTSIDE_SITE' ||
        message === 'GPS_ACCURACY_INSUFFICIENT' ||
        message ===
          'OFFLINE_ATTENDANCE_DISABLED'
          ? getFriendlyError({
              code:
                code ?? message,
              message,
            })
          : getFriendlyError(error);

      toast({
        title: 'Pointage impossible',
        description: friendly,
        variant: 'destructive',
      });
    } finally {
      if (mountedRef.current) {
        setActionLoading(false);
      }
    }
  };

  /* ==========================================================
   * CLOCK OUT
   * ======================================================== */

  const handleClockOut = async () => {
    if (!profile?.id) return;

    if (actionLoading) return;

    if (!todayRecord?.check_in) {
      toast({
        title: 'Arrivée manquante',
        description:
          'Vous devez d’abord enregistrer votre arrivée.',
        variant: 'destructive',
      });

      return;
    }

    if (todayRecord.check_out) {
      toast({
        title: 'Départ déjà enregistré',
        description:
          'Votre départ a déjà été enregistré.',
      });

      return;
    }

    const site =
      sites.find(
        (item) =>
          item.id === todayRecord.site_id,
      ) ?? selectedSite;

    if (!site) {
      toast({
        title: 'Site introuvable',
        description:
          'Le site associé à votre pointage est introuvable.',
        variant: 'destructive',
      });

      return;
    }

    try {
      setActionLoading(true);

      const position =
        await getPositionForSite(site);

      if (
        position &&
        site.latitude !== null &&
        site.longitude !== null
      ) {
        const distance =
          calculateDistance(
            position.latitude,
            position.longitude,
            site.latitude,
            site.longitude,
          );

        if (
          distance >
          site.location_radius_m
        ) {
          throw new Error(
            'GPS_OUTSIDE_SITE',
          );
        }

        if (
          position.accuracy >
          site.max_gps_accuracy_m
        ) {
          throw new Error(
            'GPS_ACCURACY_INSUFFICIENT',
          );
        }
      }

      const pendingEvent =
        createPendingEvent(
          'check_out',
          site.id,
          position,
        );

      /*
       * Offline.
       */
      if (!navigator.onLine) {
        if (
          !site.offline_attendance_enabled
        ) {
          throw new Error(
            'OFFLINE_ATTENDANCE_DISABLED',
          );
        }

        addToQueue(pendingEvent);

        toast({
          title:
            'Départ enregistré localement',
          description:
            'Le départ sera synchronisé dès que la connexion sera rétablie.',
        });

        return;
      }

      /*
       * Online.
       */
      await executeAttendanceRpc(
        pendingEvent,
      );

      toast({
        title: 'Départ enregistré',
        description:
          'Votre pointage de départ a été enregistré.',
      });

      await loadTodayRecord();
      await loadHistory();
    } catch (error) {
      console.error(
        'Erreur pointage départ:',
        error,
      );

      toast({
        title: 'Pointage impossible',
        description:
          getFriendlyError(error),
        variant: 'destructive',
      });
    } finally {
      if (mountedRef.current) {
        setActionLoading(false);
      }
    }
  };

  /* ==========================================================
   * SITE LABEL
   * ======================================================== */

  const getSiteName = (
    siteId: string,
  ): string => {
    return (
      sites.find(
        (site) => site.id === siteId,
      )?.name ?? 'Site inconnu'
    );
  };

  /* ==========================================================
   * RENDER — LOADING
   * ======================================================== */

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />

            <span>
              Chargement du pointage...
            </span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /* ==========================================================
   * RENDER
   * ======================================================== */

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">

        {/* ======================================================
         * HEADER
         * ==================================================== */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Mon pointage
            </h1>

            <p className="text-sm text-muted-foreground">
              Enregistrez votre arrivée et votre départ.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                refreshing
                  ? 'animate-spin'
                  : ''
              }`}
            />

            Actualiser
          </Button>
        </div>

        {/* ======================================================
         * NETWORK STATUS
         * ==================================================== */}

        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              {isOnline ? (
                <div className="rounded-full bg-green-100 p-2 text-green-700">
                  <Wifi className="h-5 w-5" />
                </div>
              ) : (
                <div className="rounded-full bg-orange-100 p-2 text-orange-700">
                  <WifiOff className="h-5 w-5" />
                </div>
              )}

              <div>
                <p className="font-medium">
                  {isOnline
                    ? 'Connexion disponible'
                    : 'Hors connexion'}
                </p>

                <p className="text-sm text-muted-foreground">
                  {isOnline
                    ? 'Les pointages peuvent être synchronisés.'
                    : 'Les pointages seront enregistrés localement si le site autorise le mode hors connexion.'}
                </p>
              </div>
            </div>

            {pendingEvents.length > 0 && (
              <div className="rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
                {pendingEvents.length}{' '}
                en attente
              </div>
            )}
          </CardContent>
        </Card>

        {/* ======================================================
         * SITE
         * ==================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />

              Site de travail
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {sites.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />

                <p className="font-medium">
                  Aucun site affecté
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Vous devez être affecté à un site
                  avant de pouvoir pointer.
                </p>
              </div>
            ) : (
              <>
                <select
                  value={
                    selectedSiteId ?? ''
                  }
                  onChange={(event) =>
                    setSelectedSiteId(
                      event.target.value ||
                        null,
                    )
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  disabled={
                    !!todayRecord?.check_in
                  }
                >
                  <option value="">
                    Sélectionner un site
                  </option>

                  {sites.map((site) => (
                    <option
                      key={site.id}
                      value={site.id}
                    >
                      {site.name}
                    </option>
                  ))}
                </select>

                {selectedSite && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />

                        <span className="text-sm font-medium">
                          GPS
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedSite.gps_required
                          ? 'Obligatoire'
                          : 'Optionnel'}
                      </p>
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-muted-foreground" />

                        <span className="text-sm font-medium">
                          Wi-Fi
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedSite.wifi_required
                          ? 'Requis'
                          : 'Non requis'}
                      </p>

                      {selectedSite.wifi_ssid && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Réseau configuré :{' '}
                          {selectedSite.wifi_ssid}
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />

                        <span className="text-sm font-medium">
                          Mode hors connexion
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedSite.offline_attendance_enabled
                          ? 'Autorisé'
                          : 'Désactivé'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ======================================================
         * TODAY ATTENDANCE
         * ==================================================== */}

        <Card>
          <CardHeader>
            <CardTitle>
              Pointage du jour
            </CardTitle>
          </CardHeader>

          <CardContent>
            {todayRecord ? (
              <div className="grid gap-4 md:grid-cols-3">

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Site
                  </p>

                  <p className="mt-1 font-semibold">
                    {getSiteName(
                      todayRecord.site_id,
                    )}
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Arrivée
                  </p>

                  <p className="mt-1 text-xl font-semibold">
                    {todayRecord.check_in
                      ? formatDateTime(
                          todayRecord.check_in,
                        )
                      : '—'}
                  </p>

                  {todayRecord.check_in_method && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Méthode :{' '}
                      {todayRecord.check_in_method}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Départ
                  </p>

                  <p className="mt-1 text-xl font-semibold">
                    {todayRecord.check_out
                      ? formatDateTime(
                          todayRecord.check_out,
                        )
                      : '—'}
                  </p>

                  {todayRecord.check_out_method && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Méthode :{' '}
                      {todayRecord.check_out_method}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-6 text-center">
                <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />

                <p className="font-medium">
                  Aucun pointage aujourd’hui
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Enregistrez votre arrivée pour commencer votre journée.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">

              <Button
                className="flex-1"
                size="lg"
                onClick={() =>
                  void handleClockIn()
                }
                disabled={
                  actionLoading ||
                  !selectedSite ||
                  !!todayRecord?.check_in
                }
              >
                {actionLoading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-5 w-5" />
                )}

                Pointer l’arrivée
              </Button>

              <Button
                className="flex-1"
                size="lg"
                variant="outline"
                onClick={() =>
                  void handleClockOut()
                }
                disabled={
                  actionLoading ||
                  !todayRecord?.check_in ||
                  !!todayRecord?.check_out
                }
              >
                {actionLoading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-5 w-5" />
                )}

                Pointer le départ
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ======================================================
         * EVENTS
         * ==================================================== */}

        {todayRecord && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />

                Événements du jour
              </CardTitle>
            </CardHeader>

            <CardContent>
              {events.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun événement enregistré.
                </p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        {event.event_type ===
                        'check_in' ? (
                          <div className="rounded-full bg-green-100 p-2 text-green-700">
                            <LogIn className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="rounded-full bg-blue-100 p-2 text-blue-700">
                            <LogOut className="h-4 w-4" />
                          </div>
                        )}

                        <div>
                          <p className="font-medium">
                            {event.event_type ===
                            'check_in'
                              ? 'Arrivée'
                              : 'Départ'}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(
                              event.occurred_at,
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {event.event_method}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {event.is_confirmed
                            ? 'Confirmé'
                            : 'En attente'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ======================================================
         * HISTORY
         * ==================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />

              Historique
            </CardTitle>
          </CardHeader>

          <CardContent>
            {history.length === 0 ? (
              <div className="py-8 text-center">
                <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />

                <p className="font-medium">
                  Aucun historique
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Vos pointages apparaîtront ici.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-3">
                        Date
                      </th>

                      <th className="px-3 py-3">
                        Site
                      </th>

                      <th className="px-3 py-3">
                        Arrivée
                      </th>

                      <th className="px-3 py-3">
                        Départ
                      </th>

                      <th className="px-3 py-3">
                        Statut
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map(
                      (record) => (
                        <tr
                          key={record.id}
                          className="border-b last:border-0"
                        >
                          <td className="px-3 py-3">
                            {format(
                              parseISO(
                                `${record.attendance_date}T00:00:00`,
                              ),
                              'dd/MM/yyyy',
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {getSiteName(
                              record.site_id,
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {record.check_in
                              ? format(
                                  parseISO(
                                    record.check_in,
                                  ),
                                  'HH:mm',
                                )
                              : '—'}
                          </td>

                          <td className="px-3 py-3">
                            {record.check_out
                              ? format(
                                  parseISO(
                                    record.check_out,
                                  ),
                                  'HH:mm',
                                )
                              : '—'}
                          </td>

                          <td className="px-3 py-3">
                            <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs">
                              {record.attendance_status ||
                                record.validation_status ||
                                '—'}
                            </span>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ======================================================
         * OFFLINE QUEUE
         * ==================================================== */}

        {pendingEvents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WifiOff className="h-5 w-5" />

                Pointages en attente
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="space-y-3">
                {pendingEvents.map(
                  (event) => (
                    <div
                      key={event.clientEventId}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">
                          {event.type ===
                          'check_in'
                            ? 'Arrivée'
                            : 'Départ'}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {getSiteName(
                            event.siteId,
                          )}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm">
                          {formatDateTime(
                            event.occurredAt,
                          )}
                        </p>

                        <p className="text-xs text-orange-600">
                          En attente de synchronisation
                        </p>
                      </div>
                    </div>
                  ),
                )}

                {isOnline && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      void syncQueue()
                    }
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />

                    Synchroniser maintenant
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </DashboardLayout>
  );
}