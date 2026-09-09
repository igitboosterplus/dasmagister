import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Clock, LogIn, LogOut, Loader2, MapPin, WifiOff, AlertTriangle } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// --- Types -----------------------------------------------------------------

interface SiteOption {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  location_radius_m: number;
  max_gps_accuracy_m: number;
  gps_required: boolean;
}

interface AttendanceRecord {
  id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  site_id: string;
  validation_status: string | null;
  is_offline: boolean;
}

interface AttendanceAnomaly {
  id: string;
  type: string;
  severity: string;
  description: string | null;
}


type AttendanceInsert =
  Database['public']['Tables']['attendances']['Insert'];

type AttendanceUpdate =
  Database['public']['Tables']['attendances']['Update'];

// Une opération en attente de synchronisation (créée hors-ligne).
interface PendingCheckIn {
  clientEventId: string;
  type: 'check_in';
  createdAtLocal: string;
  payload: AttendanceInsert;
}

interface PendingCheckOut {
  clientEventId: string;
  type: 'check_out';
  createdAtLocal: string;
  payload: AttendanceUpdate;
  targetRowId: string;
}

type PendingOp = PendingCheckIn | PendingCheckOut;

const OFFLINE_QUEUE_KEY = 'pointage_offline_queue_v1';

// --- Helpers -----------------------------------------------------------------

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function loadQueue(): PendingOp[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingOp[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

const ANOMALY_LABELS: Record<string, string> = {
  late: 'Retard',
  out_of_zone: 'Hors zone',
  low_accuracy: 'Précision GPS faible',
  no_gps: 'GPS indisponible',
  offline: 'Pointage hors-ligne',
  duplicate: 'Doublon',
  missing_checkout: 'Départ non enregistré',
  suspicious_time: 'Horaire suspect',
};

// --- Component -----------------------------------------------------------------

export default function Attendance() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [anomalies, setAnomalies] = useState<AttendanceAnomaly[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  // --- Data loading ---------------------------------------------------------

  const loadSites = useCallback(async () => {
    if (!profile) return [] as SiteOption[];

    // Sites assignés activement via employee_sites (une personne peut avoir plusieurs sites).
    const { data: assigned } = await supabase
      .from('employee_sites')
      .select('site_id, sites(id, name, latitude, longitude, location_radius_m, max_gps_accuracy_m, gps_required)')
      .eq('employee_id', profile.id)
      .eq('is_active', true);

    let list: SiteOption[] =
      (assigned ?? [])
        .map((row: any) => row.sites)
        .filter(Boolean) as SiteOption[];

    // Repli sur le site "principal" de l'employé si employee_sites est vide.
    if (list.length === 0 && profile.site_id) {

      const { data: site } = await supabase
        .from('sites')
        .select('id, name, latitude, longitude, location_radius_m, max_gps_accuracy_m, gps_required')
        .eq('id', profile.site_id)
        .maybeSingle();
      if (site) list = [site as SiteOption];
    }

    return list;
  }, [profile]);



  const loadTodayRecord = useCallback(async () => {
    if (!profile) return;
    const today = format(new Date(), 'yyyy-MM-dd');

    const { data } = await supabase
      .from('attendances')
      .select('id, attendance_date, check_in, check_out, site_id, validation_status, is_offline')
      .eq('employee_id', profile.id)
      .eq('attendance_date', today)
      .maybeSingle();

    setTodayRecord(data ?? null);

    if (data) {
      const { data: anomalyRows } = await supabase
        .from('attendance_anomalies')
        .select('id, type, severity, description')
        .eq('attendance_id', data.id)
        .is('resolved_at', null);
      setAnomalies(anomalyRows ?? []);
    } else {
      setAnomalies([]);
    }
  }, [profile]);

  const loadHistory = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('attendances')
      .select('id, attendance_date, check_in, check_out, site_id, validation_status, is_offline')
      .eq('employee_id', profile.id)
      .order('attendance_date', { ascending: false })
      .limit(30);
    setHistory(data ?? []);
  }, [profile]);

  const refreshAll = useCallback(async () => {
    const siteList = await loadSites();
    setSites(siteList);
    setSelectedSiteId((current) => current || siteList[0]?.id || '');
    await Promise.all([loadTodayRecord(), loadHistory()]);
  }, [loadSites, loadTodayRecord, loadHistory]);

  // --- Offline queue sync ---------------------------------------------------

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    const queue = loadQueue();
    if (queue.length === 0) {
      setPendingCount(0);
      return;
    }

    const remaining: PendingOp[] = [];

    for (const op of queue) {
      try {
        if (op.type === 'check_in') {
          const { data, error } = await supabase
            .from('attendances')
            .insert(op.payload)
            .select('id')
            .single();
          if (error) throw error;
          // Si un check_out était fusionné dans ce même enregistrement en attente,
          // il a déjà été inclus dans op.payload lors de la mise en file (voir handleClockOut).
          void data;
        } else {
          if (!op.targetRowId) throw new Error('targetRowId manquant pour un check_out en attente');
          const { error } = await supabase
            .from('attendances')
            .update(op.payload)
            .eq('id', op.targetRowId);
          if (error) throw error;
        }
      } catch {
        // On garde l'opération en file pour une prochaine tentative.
        remaining.push(op);
      }
    }

    saveQueue(remaining);
    setPendingCount(remaining.length);
    if (remaining.length < queue.length) {
      toast({ title: '✅ Synchronisation', description: 'Pointages hors-ligne synchronisés.' });
      await Promise.all([loadTodayRecord(), loadHistory()]);
    }
  }, [toast, loadTodayRecord, loadHistory]);

  useEffect(() => {
    setPendingCount(loadQueue().length);
    const onOnline = () => {
      setIsOnline(true);
      syncQueue();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncQueue]);

  useEffect(() => {
    const init = async () => {
      await refreshAll();
      await syncQueue();
      setLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const handleClockIn = async () => {
    if (!profile || !selectedSiteId) return;

    setSubmitting(true);

    try {
      const site = sites.find((s) => s.id === selectedSiteId);

      if (!site) {
        throw new Error('Site sélectionné introuvable.');
      }

      const now = new Date();
      const attendanceDate = format(now, 'yyyy-MM-dd');

      const position = await getPosition();

      let latitude: number | undefined;
      let longitude: number | undefined;
      let accuracy: number | undefined;
      let distance: number | undefined;

      if (position) {
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        accuracy = position.coords.accuracy;

        if (
          site.latitude !== null &&
          site.longitude !== null
        ) {
          distance = haversineDistanceMeters(
            latitude,
            longitude,
            site.latitude,
            site.longitude
          );
        }
      } else if (site.gps_required) {
        throw new Error(
          'La localisation GPS est obligatoire pour pointer sur ce site.'
        );
      }

      const payload: AttendanceInsert = {
        employee_id: profile.id,
        site_id: selectedSiteId,
        attendance_date: attendanceDate,
        check_in: now.toISOString(),
        is_offline: !navigator.onLine,

        check_in_latitude: latitude,
        check_in_longitude: longitude,
        check_in_accuracy_m: accuracy,
        check_in_distance_m: distance,

        attendance_source: navigator.onLine
          ? 'online'
          : 'offline',
      };

      if (!navigator.onLine) {
        const operation: PendingCheckIn = {
          clientEventId: crypto.randomUUID(),
          type: 'check_in',
          createdAtLocal: now.toISOString(),
          payload,
        };

        const queue = loadQueue();

        queue.push(operation);

        saveQueue(queue);
        setPendingCount(queue.length);

        toast({
          title: '📴 Pointage enregistré',
          description:
            'Votre arrivée sera synchronisée dès que la connexion sera rétablie.',
        });

        await loadTodayRecord();
        await loadHistory();

        return;
      }

      const { data, error } = await supabase
        .from('attendances')
        .insert(payload)
        .select(
          'id, attendance_date, check_in, check_out, site_id, validation_status, is_offline'
        )
        .single();

      if (error) throw error;

      setTodayRecord(data);

      toast({
        title: '✅ Arrivée enregistrée',
        description: 'Votre pointage a bien été enregistré.',
      });

      await loadHistory();
    } catch (error) {
      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible d’enregistrer le pointage.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    if (!profile || !todayRecord) return;

    setSubmitting(true);

    try {
      const now = new Date();

      const payload: AttendanceUpdate = {
        check_out: now.toISOString(),
        is_offline: !navigator.onLine,
        attendance_source: navigator.onLine
          ? 'online'
          : 'offline',
      };

      if (!navigator.onLine) {
        const operation: PendingCheckOut = {
          clientEventId: crypto.randomUUID(),
          type: 'check_out',
          createdAtLocal: now.toISOString(),
          payload,
          targetRowId: todayRecord.id,
        };

        const queue = loadQueue();

        queue.push(operation);

        saveQueue(queue);
        setPendingCount(queue.length);

        toast({
          title: '📴 Départ enregistré',
          description:
            'Votre départ sera synchronisé dès que la connexion sera rétablie.',
        });

        setTodayRecord({
          ...todayRecord,
          check_out: now.toISOString(),
        });

        return;
      }

      const { data, error } = await supabase
        .from('attendances')
        .update(payload)
        .eq('id', todayRecord.id)
        .select(
          'id, attendance_date, check_in, check_out, site_id, validation_status, is_offline'
        )
        .single();

      if (error) throw error;

      setTodayRecord(data);

      toast({
        title: '✅ Départ enregistré',
        description: 'Votre départ a bien été enregistré.',
      });

      await loadHistory();
    } catch (error) {
      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible d’enregistrer le départ.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };



  // --- Render ------------------------------------------------------------------

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="page-title">Pointage</h1>
          {!isOnline && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <WifiOff className="h-4 w-4" /> Hors-ligne
            </span>
          )}
          {isOnline && pendingCount > 0 && (
            <span className="text-sm text-muted-foreground">{pendingCount} pointage(s) en attente de synchronisation</span>
          )}
        </div>

        <Card className="stat-card mb-8 max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Aujourd'hui — {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sites.length > 1 && !todayRecord && (
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> Site
                </label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!todayRecord ? (
              <div>

                <p className="text-sm text-muted-foreground mb-4">Vous n'avez pas encore pointé aujourd'hui.</p>
                <Button onClick={handleClockIn}
                  disabled={submitting || !selectedSiteId}
                  className="w-full">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
                  Marquer mon arrivée
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Arrivée</span>
                  <span className="font-medium">
                    {todayRecord.check_in ? format(new Date(todayRecord.check_in), 'HH:mm') : '—'}
                  </span>
                </div>
                {todayRecord.is_offline && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <WifiOff className="h-3 w-3" /> Enregistré hors-ligne, en attente de synchronisation
                  </p>
                )}
                {anomalies.length > 0 && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                    {anomalies.map((a) => (
                      <p key={a.id} className="text-xs text-amber-800 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {ANOMALY_LABELS[a.type] ?? a.type}
                        {a.description ? ` — ${a.description}` : ''}
                      </p>
                    ))}
                  </div>
                )}
                {todayRecord.check_out ? (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Départ</span>
                    <span className="font-medium">{format(new Date(todayRecord.check_out), 'HH:mm')}</span>
                  </div>
                ) : (
                  <Button onClick={handleClockOut} variant="outline" disabled={submitting} className="w-full mt-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
                    Marquer mon départ
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>


        <h2 className="font-display text-lg font-semibold mb-4">Historique récent</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="table-header px-4 py-3 text-left">Date</th>
                  <th className="table-header px-4 py-3 text-left">Arrivée</th>
                  <th className="table-header px-4 py-3 text-left">Départ</th>
                  <th className="table-header px-4 py-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm">{format(new Date(record.attendance_date), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {record.check_in ? format(new Date(record.check_in), 'HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {record.check_out ? format(new Date(record.check_out), 'HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {record.is_offline && '📴 '}
                      {record.validation_status ?? (record.check_out ? 'Complet' : 'En cours')}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Aucun historique de pointage
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );

}
