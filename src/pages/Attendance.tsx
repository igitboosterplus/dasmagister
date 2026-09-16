import { useCallback, useEffect, useRef, useState } from 'react';
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
  WifiOff,
} from 'lucide-react';

import { format } from 'date-fns';
import { fr } from 'date-fns/locale';


// ============================================================
// TYPES
// ============================================================

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

  event_type:
  | 'CLOCK_IN'
  | 'SITE_EXIT'
  | 'SITE_ENTER'
  | 'CLOCK_OUT';

  event_method:
  | 'manual'
  | 'gps_auto'
  | 'system'
  | 'manager';

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

  type:
  | 'CLOCK_IN'
  | 'SITE_EXIT'
  | 'SITE_ENTER'
  | 'CLOCK_OUT';

  occurredAt: string;

  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;

  clientEventId: string;
}


// ============================================================
// CONSTANTES
// ============================================================

const OFFLINE_QUEUE_KEY =
  'attendance_event_queue_v2';

const EXIT_CONFIRMATION_MS =
  6 * 60 * 1000;

const END_OF_DAY_WINDOW_MINUTES = 30;


// ============================================================
// HELPERS
// ============================================================

function loadQueue(): PendingEvent[] {
  try {
    const raw =
      localStorage.getItem(
        OFFLINE_QUEUE_KEY
      );

    if (!raw) {
      return [];
    }

    return JSON.parse(raw);
  } catch {
    return [];
  }
}


function saveQueue(
  queue: PendingEvent[]
) {
  localStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify(queue)
  );
}


function createClientEventId() {
  return crypto.randomUUID();
}


function getPosition(): Promise<GeolocationPosition> {
  return new Promise(
    (resolve, reject) => {
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
    }
  );
}


// ============================================================
// COMPONENT
// ============================================================

export default function Attendance() {
  const { profile } = useAuth();
  const { toast } = useToast();


  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [site, setSite] =
    useState<SiteContext | null>(null);

  const [todayRecord, setTodayRecord] =
    useState<AttendanceRecord | null>(null);

  const [events, setEvents] =
    useState<AttendanceEvent[]>([]);

  const [history, setHistory] =
    useState<AttendanceRecord[]>([]);


  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const watchIdRef =
    useRef<number | null>(null);

  const exitEventRef =
    useRef<AttendanceEvent | null>(null);

  const exitTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const lastZoneStateRef =
    useRef<
      'inside' | 'outside' | null
    >(null);

  const processingLocationRef =
    useRef(false);


  // ==========================================================
  // LOAD SITE
  // ==========================================================

  const loadSite = useCallback(
    async () => {
      if (!profile) {
        return;
      }

      const {
        data,
        error,
      } = await supabase.rpc(
        'get_my_attendance_site'
      );

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error(
          'Aucun site de travail n’est actuellement attribué.'
        );
      }

      setSite(data[0] as SiteContext);
    },
    [profile]
  );


  // ==========================================================
  // LOAD TODAY
  // ==========================================================

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


  // ==========================================================
  // LOAD EVENTS
  // ==========================================================

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


  // ==========================================================
  // LOAD HISTORY
  // ==========================================================

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
        .limit(30);

      if (error) {
        throw error;
      }

      setHistory(
        (data ?? []) as AttendanceRecord[]
      );
    }, [profile]);


  // ==========================================================
  // REFRESH
  // ==========================================================

  const refreshAll =
    useCallback(async () => {
      await loadSite();
      await loadTodayRecord();
      await loadHistory();
    }, [
      loadSite,
      loadTodayRecord,
      loadHistory,
    ]);


  // ==========================================================
  // OFFLINE QUEUE
  // ==========================================================

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


  // ==========================================================
  // SYNC OFFLINE EVENTS
  // ==========================================================

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

      for (const event of queue) {
        try {
          const positionArgs = {
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


          if (
            event.type ===
            'CLOCK_IN'
          ) {
            await supabase.rpc(
              'clock_in',
              positionArgs
            );
          }


          if (
            event.type ===
            'SITE_EXIT'
          ) {
            await supabase.rpc(
              'record_site_exit',
              positionArgs
            );
          }


          if (
            event.type ===
            'SITE_ENTER'
          ) {
            await supabase.rpc(
              'record_site_enter',
              positionArgs
            );
          }


          if (
            event.type ===
            'CLOCK_OUT'
          ) {
            await supabase.rpc(
              'clock_out',
              positionArgs
            );
          }

        } catch (error: any) {
          console.error(
            'Erreur synchronisation événement:',
            event,
            error
          );

          // Conserver l'événement uniquement s'il s'agit d'une erreur réseau ou d'un timeout.
          const isNetworkError =
            error?.message === 'Failed to fetch' ||
            error?.message?.includes('Network') ||
            error?.message?.includes('network') ||
            (error?.status && error.status >= 500);

          if (isNetworkError) {
            remaining.push(event);
          } else {
            console.warn(
              'Evénement écarté suite à une erreur définitive (ex: règle métier, déjà pointé):',
              error
            );
          }
        }
      }

      saveQueue(remaining);

      setPendingCount(
        remaining.length
      );

      if (
        remaining.length <
        queue.length
      ) {
        await refreshAll();

        toast({
          title:
            'Synchronisation effectuée',
          description:
            'Les événements de présence ont été synchronisés.',
        });
      }
    }, [
      refreshAll,
      toast,
    ]);


  // ==========================================================
  // ONLINE / OFFLINE
  // ==========================================================

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


  // ==========================================================
  // INITIALISATION
  // ==========================================================

  useEffect(() => {
    if (!profile) {
      return;
    }

    const init =
      async () => {
        try {
          setLoading(true);

          await refreshAll();
          await syncQueue();

        } catch (error) {
          console.error(
            'Erreur initialisation attendance:',
            error
          );

          toast({
            title:
              'Erreur',
            description:
              error instanceof Error
                ? error.message
                : 'Impossible de charger le pointage.',
            variant:
              'destructive',
          });

        } finally {
          setLoading(false);
        }
      };

    void init();
  }, [
    profile,
    refreshAll,
    syncQueue,
    toast,
  ]);


  // ==========================================================
  // CLOCK IN
  // ==========================================================

  const handleClockIn =
    async () => {
      if (!profile) {
        return;
      }

      setSubmitting(true);

      try {
        const position =
          await getPosition();

        const now =
          new Date();

        const clientEventId =
          createClientEventId();

        const args = {
          p_latitude:
            position.coords.latitude,

          p_longitude:
            position.coords.longitude,

          p_accuracy_m:
            position.coords.accuracy,

          p_occurred_at:
            now.toISOString(),

          p_client_event_id:
            clientEventId,

          p_device_recorded_at:
            now.toISOString(),
        };


        // ----------------------------------------------------
        // OFFLINE
        // ----------------------------------------------------

        if (!navigator.onLine) {
          queueEvent({
            id:
              crypto.randomUUID(),

            type:
              'CLOCK_IN',

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracyM:
              position.coords.accuracy,

            clientEventId,
          });

          toast({
            title:
              'Pointage enregistré',
            description:
              'Votre arrivée sera synchronisée dès que la connexion reviendra.',
          });

          await loadTodayRecord();

          return;
        }


        // ----------------------------------------------------
        // ONLINE
        // ----------------------------------------------------

        const {
          data,
          error,
        } = await supabase.rpc(
          'clock_in',
          args
        );

        if (error) {
          throw error;
        }


        setTodayRecord(
          data as AttendanceRecord
        );


        toast({
          title:
            'Arrivée enregistrée',
          description:
            'Votre présence a bien été enregistrée.',
        });


        await loadHistory();

      } catch (error) {
        toast({
          title:
            'Impossible de pointer',

          description:
            error instanceof Error
              ? error.message
              : 'Une erreur est survenue.',

          variant:
            'destructive',
        });

      } finally {
        setSubmitting(false);
      }
    };


  // ==========================================================
  // DISTANCE SITE
  // ==========================================================

  const calculateDistance =
    (
      latitude: number,
      longitude: number
    ) => {
      if (
        !site ||
        site.latitude === null ||
        site.longitude === null
      ) {
        return null;
      }

      const R = 6371000;

      const toRad =
        (value: number) =>
          (value * Math.PI) / 180;

      const dLat =
        toRad(
          latitude -
          site.latitude
        );

      const dLon =
        toRad(
          longitude -
          site.longitude
        );

      const a =
        Math.sin(dLat / 2) **
        2 +
        Math.cos(
          toRad(latitude)
        ) *
        Math.cos(
          toRad(site.latitude)
        ) *
        Math.sin(dLon / 2) **
        2;

      return (
        R *
        2 *
        Math.atan2(
          Math.sqrt(a),
          Math.sqrt(1 - a)
        )
      );
    };


  // ==========================================================
  // GPS : SORTIE DU SITE
  // ==========================================================

  const handleOutside =
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

        const clientEventId =
          createClientEventId();


        // ----------------------------------------------------
        // Événement SITE_EXIT
        // ----------------------------------------------------

        if (!navigator.onLine) {
          queueEvent({
            id:
              crypto.randomUUID(),

            type:
              'SITE_EXIT',

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracyM:
              position.coords.accuracy,

            clientEventId,
          });

          setOutsideSince(
            now.toISOString()
          );

          return;
        }


        const {
          data,
          error,
        } = await supabase.rpc(
          'record_site_exit',
          {
            p_latitude:
              position.coords.latitude,

            p_longitude:
              position.coords.longitude,

            p_accuracy_m:
              position.coords.accuracy,

            p_occurred_at:
              now.toISOString(),

            p_client_event_id:
              clientEventId,

            p_device_recorded_at:
              now.toISOString(),
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


        // ----------------------------------------------------
        // Timer 6 minutes
        // ----------------------------------------------------

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
        console.error(
          'Erreur sortie site:',
          error
        );
      } finally {
        processingLocationRef.current =
          false;
      }
    };


  // ==========================================================
  // CONFIRMATION SORTIE
  // ==========================================================

  const confirmExit =
    async (
      exitEvent: AttendanceEvent
    ) => {
      if (
        !exitEvent.id
      ) {
        return;
      }

      try {
        if (!navigator.onLine) {
          return;
        }


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


        const confirmed =
          data as AttendanceEvent;


        exitEventRef.current =
          confirmed;


        await loadTodayRecord();
        await loadEvents();


        if (
          todayRecord?.scheduled_end &&
          exitEvent.occurred_at
        ) {
          const exitTime =
            new Date(
              exitEvent.occurred_at
            );

          const scheduledEnd =
            todayRecord
              .scheduled_end;

          const [
            hours,
            minutes,
          ] =
            scheduledEnd
              .split(':')
              .map(Number);

          const end =
            new Date(
              exitTime
            );

          end.setHours(
            hours,
            minutes,
            0,
            0
          );

          const difference =
            (
              end.getTime() -
              exitTime.getTime()
            ) /
            60000;

          if (
            difference >= 0 &&
            difference <=
            END_OF_DAY_WINDOW_MINUTES
          ) {
            toast({
              title:
                'Départ automatique',
              description:
                `Votre sortie de ${format(
                  exitTime,
                  'HH:mm'
                )} a été considérée comme votre départ.`,
            });
          }
        }

      } catch (error) {
        console.error(
          'Erreur confirmation sortie:',
          error
        );
      }
    };


  // ==========================================================
  // GPS : RETOUR SUR SITE
  // ==========================================================

  const handleInside =
    async (
      position: GeolocationPosition
    ) => {
      if (
        !todayRecord ||
        todayRecord.check_out
      ) {
        return;
      }

      // ------------------------------------------------------
      // Si on était déjà dedans :
      // rien à faire.
      // ------------------------------------------------------

      if (
        lastZoneStateRef.current ===
        'inside'
      ) {
        return;
      }


      lastZoneStateRef.current =
        'inside';


      // ------------------------------------------------------
      // Annuler le timer sortie
      // ------------------------------------------------------

      if (
        exitTimerRef.current
      ) {
        clearTimeout(
          exitTimerRef.current
        );

        exitTimerRef.current =
          null;
      }


      const now =
        new Date();

      const clientEventId =
        createClientEventId();


      try {
        if (!navigator.onLine) {
          queueEvent({
            id:
              crypto.randomUUID(),

            type:
              'SITE_ENTER',

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracyM:
              position.coords.accuracy,

            clientEventId,
          });

          setOutsideSince(null);

          return;
        }


        await supabase.rpc(
          'record_site_enter',
          {
            p_latitude:
              position.coords.latitude,

            p_longitude:
              position.coords.longitude,

            p_accuracy_m:
              position.coords.accuracy,

            p_occurred_at:
              now.toISOString(),

            p_client_event_id:
              clientEventId,

            p_device_recorded_at:
              now.toISOString(),
          }
        );


        setOutsideSince(null);

        exitEventRef.current =
          null;


        await loadEvents();

      } catch (error) {
        console.error(
          'Erreur retour site:',
          error
        );
      }
    };


  // ==========================================================
  // SURVEILLANCE GPS
  // ==========================================================

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


      const watchId =
        navigator.geolocation.watchPosition(
          async (position) => {
            if (
              !site ||
              !todayRecord ||
              todayRecord.check_out
            ) {
              return;
            }


            const distance =
              calculateDistance(
                position.coords.latitude,
                position.coords.longitude
              );


            if (
              distance === null
            ) {
              return;
            }


            const isInside =
              distance <=
              site.location_radius_m;


            // ------------------------------------------------
            // Première position
            // ------------------------------------------------

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


            // ------------------------------------------------
            // INSIDE
            // ------------------------------------------------

            if (isInside) {
              await handleInside(
                position
              );

              return;
            }


            // ------------------------------------------------
            // OUTSIDE
            // ------------------------------------------------

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
      site,
      todayRecord,
      toast,
    ]);


  // ==========================================================
  // STOP GPS
  // ==========================================================

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

    }, []);


  // ==========================================================
  // ACTIVATION SURVEILLANCE APRÈS CLOCK-IN
  // ==========================================================

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
    startMonitoring,
    stopMonitoring,
  ]);


  // ==========================================================
  // CLOCK OUT MANUEL
  // ==========================================================

  const handleClockOut =
    async () => {
      if (
        !todayRecord ||
        todayRecord.check_out
      ) {
        return;
      }

      setSubmitting(true);

      try {
        const position =
          await getPosition();

        const now =
          new Date();

        const clientEventId =
          createClientEventId();


        if (!navigator.onLine) {
          queueEvent({
            id:
              crypto.randomUUID(),

            type:
              'CLOCK_OUT',

            occurredAt:
              now.toISOString(),

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracyM:
              position.coords.accuracy,

            clientEventId,
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
              'Départ enregistré',
            description:
              'Le départ sera synchronisé dès que la connexion reviendra.',
          });

          return;
        }


        const {
          data,
          error,
        } = await supabase.rpc(
          'clock_out',
          {
            p_latitude:
              position.coords.latitude,

            p_longitude:
              position.coords.longitude,

            p_accuracy_m:
              position.coords.accuracy,

            p_occurred_at:
              now.toISOString(),

            p_client_event_id:
              clientEventId,

            p_device_recorded_at:
              now.toISOString(),
          }
        );


        if (error) {
          throw error;
        }


        setTodayRecord(
          data as AttendanceRecord
        );


        stopMonitoring();


        await loadEvents();
        await loadHistory();


        toast({
          title:
            'Départ enregistré',
          description:
            'Votre départ a bien été enregistré.',
        });

      } catch (error) {
        toast({
          title:
            'Impossible d’enregistrer le départ',

          description:
            error instanceof Error
              ? error.message
              : 'Une erreur est survenue.',

          variant:
            'destructive',
        });

      } finally {
        setSubmitting(false);
      }
    };


  // ==========================================================
  // EVENTS
  // ==========================================================

  useEffect(() => {
    if (todayRecord) {
      void loadEvents();
    }
  }, [
    todayRecord,
    loadEvents,
  ]);


  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [
    stopMonitoring,
  ]);


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
  // RENDER
  // ==========================================================

  return (
    <DashboardLayout>

      <div className="animate-fade-in">

        {/* -------------------------------------------------- */}
        {/* HEADER */}
        {/* -------------------------------------------------- */}

        <div className="flex items-center justify-between mb-6">

          <div>
            <h1 className="page-title">
              Pointage
            </h1>

            {site && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-4 w-4" />

                {site.site_name}
              </p>
            )}
          </div>


          <div className="flex items-center gap-3">

            {!isOnline && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <WifiOff className="h-4 w-4" />

                Hors-ligne
              </span>
            )}


            {monitoring && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Radio className="h-4 w-4" />

                Surveillance GPS active
              </span>
            )}

          </div>

        </div>


        {/* -------------------------------------------------- */}
        {/* TODAY */}
        {/* -------------------------------------------------- */}

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

            {/* ---------------------------------------------- */}
            {/* NO ATTENDANCE */}
            {/* ---------------------------------------------- */}

            {!todayRecord && (

              <div className="space-y-4">

                <div className="rounded-lg border p-4">

                  <div className="flex items-start gap-3">

                    <MapPin className="h-5 w-5 text-primary mt-0.5" />

                    <div>

                      <p className="font-medium">
                        Site de travail
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {site?.site_name ??
                          'Chargement…'}
                      </p>

                      <p className="text-xs text-muted-foreground mt-1">
                        Votre site est déterminé
                        automatiquement.
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
                    !site
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


            {/* ---------------------------------------------- */}
            {/* ACTIVE ATTENDANCE */}
            {/* ---------------------------------------------- */}

            {todayRecord && (

              <div className="space-y-4">

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
                  todayRecord.late_minutes > 0
                ) && (

                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">

                      <p className="text-sm text-amber-800 flex items-center gap-2">

                        <AlertTriangle className="h-4 w-4" />

                        Retard de{' '}
                        {todayRecord.late_minutes}{' '}
                        minute(s)

                      </p>

                    </div>

                  )}


                {/* MONITORING */}

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

                        Votre position est utilisée
                        pour détecter les sorties
                        et retours sur le site.

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

                      La sortie sera confirmée
                      après 6 minutes si vous
                      restez hors périmètre.

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

                          Départ détecté
                          automatiquement par GPS.

                        </p>

                      )}

                  </div>

                )}


                {/* MANUAL CLOCK OUT */}

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


        {/* -------------------------------------------------- */}
        {/* EVENTS */}
        {/* -------------------------------------------------- */}

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
                        key={event.id}
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

                            {event.event_type ===
                              'CLOCK_IN' &&
                              'Arrivée'}

                            {event.event_type ===
                              'SITE_EXIT' &&
                              'Sortie du site'}

                            {event.event_type ===
                              'SITE_ENTER' &&
                              'Retour sur site'}

                            {event.event_type ===
                              'CLOCK_OUT' &&
                              'Départ'}

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

                                Sortie confirmée
                                après 6 minutes.

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


        {/* -------------------------------------------------- */}
        {/* HISTORY */}
        {/* -------------------------------------------------- */}

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
                      key={record.id}
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

                        {record.attendance_status ===
                          'completed'
                          ? 'Terminée'
                          : record.attendance_status ===
                            'missing_departure'
                            ? 'Départ manquant'
                            : record.late_minutes &&
                              record.late_minutes >
                              0
                              ? `Présent — retard ${record.late_minutes} min`
                              : 'Présent'}

                      </td>

                    </tr>

                  )
                )}


                {history.length ===
                  0 && (

                    <tr>

                      <td
                        colSpan={4}
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


        {/* -------------------------------------------------- */}
        {/* OFFLINE */}
        {/* -------------------------------------------------- */}

        {pendingCount > 0 && (

          <div className="mt-4 text-sm text-muted-foreground flex items-center gap-2">

            <WifiOff className="h-4 w-4" />

            {pendingCount}{' '}
            événement(s) en attente de
            synchronisation.

          </div>

        )}

      </div>

    </DashboardLayout>
  );
}