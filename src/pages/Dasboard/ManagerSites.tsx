import { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Skeleton } from '@/components/ui/skeleton';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

import {
  MapPin,
  Plus,
  Search,
  Loader2,
  Clock,
  MoreHorizontal,
  Pencil,
  Eye,
  PowerOff,
  Power,
  Users,
  AlertTriangle,
  Store,
  Warehouse,
  Navigation,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  Database,
} from 'lucide-react';


// ============================================================
// TYPES
// ============================================================

interface City {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  type: 'magasin' | 'cave';

  structure_id: string;
  city_id: string;

  work_start: string | null;
  work_end: string | null;

  is_active: boolean;
  created_at: string;

  address: string | null;

  latitude: number | null;
  longitude: number | null;

  location_radius_m: number;
  max_gps_accuracy_m: number;

  gps_required: boolean;

  wifi_ssid: string | null;
  wifi_required: boolean;

  offline_attendance_enabled: boolean;

  timezone: string;

  updated_at: string;

  city_name: string;
  employee_count: number;
}

interface SiteFormValues {
  name: string;
  type: 'magasin' | 'cave';

  city_id: string;

  address: string;

  latitude: string;
  longitude: string;

  location_radius_m: string;
  max_gps_accuracy_m: string;

  gps_required: boolean;

  wifi_ssid: string;
  wifi_required: boolean;

  offline_attendance_enabled: boolean;

  timezone: string;

  work_start: string;
  work_end: string;

  is_active: boolean;
}

interface SiteSchedule {
  id?: string;
  site_id: string;
  day_of_week: number;
  is_working_day: boolean;
  work_start: string | null;
  work_end: string | null;
  break_start: string | null;
  break_end: string | null;
  grace_period_minutes: number;
}

interface ScheduleForm {
  day_of_week: number;
  is_working_day: boolean;
  work_start: string;
  work_end: string;
  break_start: string;
  break_end: string;
  grace_period_minutes: string;
}

type StatusFilter = 'active' | 'inactive' | 'all';
type DialogMode = 'create' | 'edit' | 'details' | null;


// ============================================================
// CONSTANTS
// ============================================================

const DAYS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
];

const TIMEZONES = [
  'Africa/Douala',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'UTC',
];

const EMPTY_FORM: SiteFormValues = {
  name: '',
  type: 'magasin',

  city_id: '',

  address: '',

  latitude: '',
  longitude: '',

  location_radius_m: '100',
  max_gps_accuracy_m: '100',

  gps_required: false,

  wifi_ssid: '',
  wifi_required: false,

  offline_attendance_enabled: true,

  timezone: 'Africa/Douala',

  work_start: '08:00',
  work_end: '17:00',

  is_active: true,
};


// ============================================================
// HELPERS
// ============================================================

const formatTime = (value: string | null | undefined) => {
  if (!value) return '—';
  return value.slice(0, 5);
};

const typeLabel = (type: string) =>
  type === 'magasin' ? 'Magasin' : 'Cave';

const TypeIcon = ({ type }: { type: string }) =>
  type === 'magasin'
    ? <Store className="h-4 w-4" />
    : <Warehouse className="h-4 w-4" />;

const dayLabel = (day: number) =>
  DAYS.find((d) => d.value === day)?.label || `Jour ${day}`;

const formatCoordinate = (value: number | null) =>
  value === null || value === undefined
    ? 'Non définie'
    : value.toFixed(6);


// ============================================================
// COMPONENT
// ============================================================

export default function ManagerSites() {

  const { role, profile } = useAuth();

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [sites, setSites] = useState<Site[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [schedules, setSchedules] = useState<SiteSchedule[]>([]);
  const [initialScheduleForms, setInitialScheduleForms] = useState<
    ScheduleForm[]
  >([]);
  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>('active');

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ----------------------------------------------------------
  // DIALOG
  // ----------------------------------------------------------

  const [dialogMode, setDialogMode] =
    useState<DialogMode>(null);

  const [selectedSite, setSelectedSite] =
    useState<Site | null>(null);

  const [formValues, setFormValues] =
    useState<SiteFormValues>(EMPTY_FORM);

  const [formErrors, setFormErrors] =
    useState<Partial<Record<keyof SiteFormValues, string>>>({});

  // ----------------------------------------------------------
  // SCHEDULES
  // ----------------------------------------------------------

  const [scheduleForms, setScheduleForms] =
    useState<ScheduleForm[]>(
      DAYS.map((day) => ({
        day_of_week: day.value,
        is_working_day: day.value <= 5,
        work_start: '08:00',
        work_end: '17:00',
        break_start: '',
        break_end: '',
        grace_period_minutes: '0',
      }))
    );

  // ----------------------------------------------------------
  // CONFIRM
  // ----------------------------------------------------------

  const [confirmOpen, setConfirmOpen] = useState(false);

  const [confirmAction, setConfirmAction] =
    useState<'activate' | 'deactivate' | null>(null);

  const [confirmSite, setConfirmSite] =
    useState<Site | null>(null);


  // ==========================================================
  // FETCH SITES
  // ==========================================================

  const fetchSites = async () => {

    if (!profile?.structure_id) return;

    try {

      setLoading(true);
      setErrorMessage(null);

      const { data, error } = await supabase
        .from('sites')
        .select(`
          id,
          name,
          type,
          structure_id,
          city_id,
          work_start,
          work_end,
          is_active,
          created_at,
          address,
          latitude,
          longitude,
          location_radius_m,
          max_gps_accuracy_m,
          gps_required,
          wifi_ssid,
          wifi_required,
          offline_attendance_enabled,
          timezone,
          updated_at,
          cities (
            name
          )
        `)
        .eq('structure_id', profile.structure_id)
        .order('name');

      if (error) throw error;

      const siteIds = (data || []).map(
        (site: any) => site.id
      );

      let employeeCounts: Record<string, number> = {};

      if (siteIds.length > 0) {

        const { data: empData, error: empError } =
          await supabase
            .from('employees')
            .select('site_id')
            .in('site_id', siteIds)
            .eq('is_active', true);

        if (!empError && empData) {

          empData.forEach((employee: any) => {

            if (!employee.site_id) return;

            employeeCounts[employee.site_id] =
              (employeeCounts[employee.site_id] || 0) + 1;

          });

        }

      }

      const mapped: Site[] = (data || []).map(
        (site: any) => {

          const city = Array.isArray(site.cities)
            ? site.cities[0]
            : site.cities;

          return {

            id: site.id,

            name: site.name,

            type: site.type,

            structure_id: site.structure_id,

            city_id: site.city_id,

            work_start: site.work_start,

            work_end: site.work_end,

            is_active: site.is_active,

            created_at: site.created_at,

            address: site.address,

            latitude: site.latitude,

            longitude: site.longitude,

            location_radius_m:
              site.location_radius_m ?? 100,

            max_gps_accuracy_m:
              site.max_gps_accuracy_m ?? 100,

            gps_required:
              site.gps_required ?? false,

            wifi_ssid:
              site.wifi_ssid,

            wifi_required:
              site.wifi_required ?? false,

            offline_attendance_enabled:
              site.offline_attendance_enabled ?? true,

            timezone:
              site.timezone || 'Africa/Douala',

            updated_at:
              site.updated_at,

            city_name:
              city?.name || '—',

            employee_count:
              employeeCounts[site.id] || 0,
          };

        }
      );

      setSites(mapped);

    } catch (error: any) {

      console.error(
        'Erreur chargement sites:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de charger les sites.'
      );

    } finally {

      setLoading(false);

    }

  };


  // ==========================================================
  // FETCH CITIES
  // ==========================================================

  const fetchCities = async () => {

    try {

      const { data, error } = await supabase
        .from('cities')
        .select('id, name')
        .order('name');

      if (error) throw error;

      setCities(data || []);

    } catch (error) {

      console.error(
        'Erreur chargement villes:',
        error
      );

    }

  };


  // ==========================================================
  // FETCH SCHEDULES
  // ==========================================================

  const formatInputTime = (
    value: string | null | undefined,
    fallback = ''
  ): string => {
    if (!value) return fallback;

    // PostgreSQL TIME peut arriver sous forme "08:00:00"
    // Le input HTML time attend "08:00"
    return value.slice(0, 5);
  };

  const fetchSchedules = async (siteId: string) => {
    try {
      const { data, error } = await supabase
        .from('site_work_schedules')
        .select(`
        id,
        site_id,
        day_of_week,
        is_working_day,
        work_start,
        work_end,
        break_start,
        break_end,
        grace_period_minutes
      `)
        .eq('site_id', siteId)
        .order('day_of_week');

      if (error) {
        console.error('Erreur récupération horaires:', error);
        throw error;
      }

      const mappedForms: ScheduleForm[] = DAYS.map((day) => {
        const existing = (data || []).find(
          (item: SiteSchedule) =>
            Number(item.day_of_week) === Number(day.value)
        );

        const isWorkingDay =
          existing?.is_working_day ?? day.value <= 5;

        return {
          day_of_week: day.value,

          is_working_day: isWorkingDay,

          work_start: isWorkingDay
            ? formatInputTime(existing?.work_start, '08:00')
            : '',

          work_end: isWorkingDay
            ? formatInputTime(existing?.work_end, '17:00')
            : '',

          break_start: formatInputTime(existing?.break_start, ''),

          break_end: formatInputTime(existing?.break_end, ''),

          grace_period_minutes: String(
            existing?.grace_period_minutes ?? 0
          ),
        };
      });

      setSchedules(data || []);
      setScheduleForms(mappedForms);

      // Très important si on utilise schedulesDirty
      setInitialScheduleForms(mappedForms);

    } catch (error) {
      console.error('Erreur fetchSchedules:', error);

      // Même si aucune configuration n'existe encore,
      // on fournit des valeurs valides au formulaire.
      const defaultForms: ScheduleForm[] = DAYS.map((day) => {
        const isWorkingDay = day.value <= 5;

        return {
          day_of_week: day.value,
          is_working_day: isWorkingDay,
          work_start: isWorkingDay ? '08:00' : '',
          work_end: isWorkingDay ? '17:00' : '',
          break_start: '',
          break_end: '',
          grace_period_minutes: '0',
        };
      });

      setSchedules([]);
      setScheduleForms(defaultForms);
      setInitialScheduleForms(defaultForms);
    }
  };


  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {

    if (role !== 'manager') {
      setLoading(false);
      return;
    }

    if (!profile?.structure_id) {
      setLoading(false);
      return;
    }

    fetchSites();
    fetchCities();

  }, [role, profile?.structure_id]);


  // ==========================================================
  // FILTERED SITES
  // ==========================================================

  const filteredSites = useMemo(() => {

    const q = search
      .toLowerCase()
      .trim();

    return sites.filter((site) => {

      if (
        statusFilter === 'active' &&
        !site.is_active
      ) {
        return false;
      }

      if (
        statusFilter === 'inactive' &&
        site.is_active
      ) {
        return false;
      }

      if (!q) return true;

      return (

        site.name
          .toLowerCase()
          .includes(q)

        ||

        site.city_name
          .toLowerCase()
          .includes(q)

        ||

        site.type
          .toLowerCase()
          .includes(q)

        ||

        (site.address || '')
          .toLowerCase()
          .includes(q)

      );

    });

  }, [sites, search, statusFilter]);


  // ==========================================================
  // FORM HELPERS
  // ==========================================================

  const updateField = <
    K extends keyof SiteFormValues
  >(
    key: K,
    value: SiteFormValues[K]
  ) => {

    setFormValues((previous) => ({
      ...previous,
      [key]: value,
    }));

    setFormErrors((previous) => ({
      ...previous,
      [key]: undefined,
    }));

  };


  // ==========================================================
  // SCHEDULE HELPERS
  // ==========================================================

  const updateSchedule = (
    dayOfWeek: number,
    field: keyof ScheduleForm,
    value: string | boolean
  ) => {

    setScheduleForms((previous) =>
      previous.map((schedule) =>
        schedule.day_of_week === dayOfWeek
          ? {
            ...schedule,
            [field]: value,
          }
          : schedule
      )
    );

  };


  // ==========================================================
  // VALIDATE SITE
  // ==========================================================

  const validateForm = (): boolean => {

    const errors: Partial<
      Record<keyof SiteFormValues, string>
    > = {};

    // Name
    if (!formValues.name.trim()) {
      errors.name =
        'Le nom du site est requis.';
    }

    // City
    if (!formValues.city_id) {
      errors.city_id =
        'La ville est requise.';
    }

    // Work hours
    if (!formValues.work_start) {
      errors.work_start =
        "L'heure de début est requise.";
    }

    if (!formValues.work_end) {
      errors.work_end =
        "L'heure de fin est requise.";
    }

    if (
      formValues.work_start &&
      formValues.work_end &&
      formValues.work_start >= formValues.work_end
    ) {
      errors.work_end =
        "L'heure de fin doit être après l'heure de début.";
    }

    // Latitude
    if (formValues.latitude.trim()) {

      const latitude =
        Number(formValues.latitude);

      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        errors.latitude =
          'La latitude doit être comprise entre -90 et 90.';
      }

    }

    // Longitude
    if (formValues.longitude.trim()) {

      const longitude =
        Number(formValues.longitude);

      if (
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        errors.longitude =
          'La longitude doit être comprise entre -180 et 180.';
      }

    }

    // GPS required
    if (
      formValues.gps_required &&
      (
        !formValues.latitude.trim() ||
        !formValues.longitude.trim()
      )
    ) {

      errors.latitude =
        'Les coordonnées sont requises lorsque le GPS est activé.';

      errors.longitude =
        'Les coordonnées sont requises lorsque le GPS est activé.';

    }

    // Radius
    const radius =
      Number(formValues.location_radius_m);

    if (
      !Number.isFinite(radius) ||
      radius <= 0
    ) {

      errors.location_radius_m =
        'Le rayon doit être supérieur à 0 m.';

    }

    // Accuracy
    const accuracy =
      Number(formValues.max_gps_accuracy_m);

    if (
      !Number.isFinite(accuracy) ||
      accuracy <= 0
    ) {

      errors.max_gps_accuracy_m =
        'La précision GPS doit être supérieure à 0 m.';

    }

    // Wi-Fi
    if (
      formValues.wifi_required &&
      !formValues.wifi_ssid.trim()
    ) {

      errors.wifi_ssid =
        'Le SSID Wi-Fi est requis lorsque le Wi-Fi est obligatoire.';

    }

    setFormErrors(errors);

    return Object.keys(errors).length === 0;

  };


  // ==========================================================
  // VALIDATE SCHEDULES
  // ==========================================================

  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes)
    ) {
      return NaN;
    }

    return hours * 60 + minutes;
  };

  const validateSchedules = (): boolean => {
    console.log(
      'HORAIRES AVANT VALIDATION:',
      JSON.parse(JSON.stringify(scheduleForms))
    );

    for (const schedule of scheduleForms) {
      const day = dayLabel(schedule.day_of_week);

      // Jour non travaillé
      if (!schedule.is_working_day) {
        continue;
      }

      // Vérification présence
      if (
        !schedule.work_start ||
        !schedule.work_end
      ) {
        setErrorMessage(
          `Les horaires sont incomplets pour ${day}.`
        );
        return false;
      }

      // Protection contre les valeurs d'affichage comme "—"
      if (
        schedule.work_start === '—' ||
        schedule.work_end === '—'
      ) {
        setErrorMessage(
          `Les horaires sont invalides pour ${day}.`
        );
        return false;
      }

      const workStart = timeToMinutes(schedule.work_start);
      const workEnd = timeToMinutes(schedule.work_end);

      if (
        !Number.isFinite(workStart) ||
        !Number.isFinite(workEnd)
      ) {
        setErrorMessage(
          `Les horaires sont invalides pour ${day}.`
        );
        return false;
      }

      if (workEnd <= workStart) {
        setErrorMessage(
          `L'heure de fin doit être après l'heure de début pour ${day}.`
        );
        return false;
      }

      // Pause
      if (schedule.break_start || schedule.break_end) {
        if (
          !schedule.break_start ||
          !schedule.break_end
        ) {
          setErrorMessage(
            `La pause est incomplète pour ${day}.`
          );
          return false;
        }

        const breakStart = timeToMinutes(
          schedule.break_start
        );

        const breakEnd = timeToMinutes(
          schedule.break_end
        );

        if (
          !Number.isFinite(breakStart) ||
          !Number.isFinite(breakEnd)
        ) {
          setErrorMessage(
            `La pause est invalide pour ${day}.`
          );
          return false;
        }

        if (breakEnd <= breakStart) {
          setErrorMessage(
            `L'heure de fin de pause doit être après l'heure de début pour ${day}.`
          );
          return false;
        }

        if (
          breakStart < workStart ||
          breakEnd > workEnd
        ) {
          setErrorMessage(
            `La pause doit être comprise dans les horaires de travail pour ${day}.`
          );
          return false;
        }
      }

      const grace = Number(
        schedule.grace_period_minutes
      );

      if (
        !Number.isFinite(grace) ||
        grace < 0
      ) {
        setErrorMessage(
          `La période de grâce est invalide pour ${day}.`
        );
        return false;
      }
    }

    return true;
  };


  // ==========================================================
  // OPEN CREATE
  // ==========================================================

  const openCreate = () => {

    setSelectedSite(null);

    setFormValues(EMPTY_FORM);

    setFormErrors({});

    setSchedules([]);

    setScheduleForms(
      DAYS.map((day) => ({
        day_of_week: day.value,

        is_working_day:
          day.value <= 5,

        work_start: '08:00',

        work_end: '17:00',

        break_start: '',

        break_end: '',

        grace_period_minutes: '0',
      }))
    );

    setDialogMode('create');

  };


  // ==========================================================
  // OPEN EDIT
  // ==========================================================

  const openEdit = async (site: Site) => {

    setSelectedSite(site);

    setFormValues({

      name: site.name,

      type: site.type,

      city_id: site.city_id,

      address: site.address || '',

      latitude:
        site.latitude !== null
          ? String(site.latitude)
          : '',

      longitude:
        site.longitude !== null
          ? String(site.longitude)
          : '',

      location_radius_m:
        String(site.location_radius_m),

      max_gps_accuracy_m:
        String(site.max_gps_accuracy_m),

      gps_required:
        site.gps_required,

      wifi_ssid:
        site.wifi_ssid || '',

      wifi_required:
        site.wifi_required,

      offline_attendance_enabled:
        site.offline_attendance_enabled,

      timezone:
        site.timezone || 'Africa/Douala',

      work_start:
        formatTime(site.work_start),

      work_end:
        formatTime(site.work_end),

      is_active:
        site.is_active,
    });

    setFormErrors({});

    setDialogMode('edit');

    await fetchSchedules(site.id);

  };


  // ==========================================================
  // OPEN DETAILS
  // ==========================================================

  const openDetails = async (site: Site) => {

    setSelectedSite(site);

    setDialogMode('details');

    await fetchSchedules(site.id);

  };


  // ==========================================================
  // CLOSE
  // ==========================================================

  const closeDialog = () => {

    if (actionLoading) return;

    setDialogMode(null);

    setSelectedSite(null);

    setFormErrors({});

  };


  // ==========================================================
  // CONFIRM
  // ==========================================================

  const openConfirm = (
    site: Site,
    action: 'activate' | 'deactivate'
  ) => {

    setConfirmSite(site);

    setConfirmAction(action);

    setConfirmOpen(true);

  };


  const closeConfirm = () => {

    if (actionLoading) return;

    setConfirmOpen(false);

    setConfirmSite(null);

    setConfirmAction(null);

  };


  // ==========================================================
  // SAVE SCHEDULES
  // ==========================================================
  const normalizeTimeForDb = (
    value: string | null | undefined
  ): string | null => {
    if (!value || value === '—') {
      return null;
    }

    // HH:MM -> HH:MM:SS
    if (value.length === 5) {
      return `${value}:00`;
    }

    return value;
  };

  const saveSchedules = async (siteId: string) => {
    const payload = scheduleForms.map((schedule) => ({
      site_id: siteId,
      day_of_week: schedule.day_of_week,

      is_working_day: schedule.is_working_day,

      work_start: schedule.is_working_day
        ? normalizeTimeForDb(schedule.work_start)
        : null,

      work_end: schedule.is_working_day
        ? normalizeTimeForDb(schedule.work_end)
        : null,

      break_start:
        schedule.is_working_day &&
          schedule.break_start
          ? normalizeTimeForDb(schedule.break_start)
          : null,

      break_end:
        schedule.is_working_day &&
          schedule.break_end
          ? normalizeTimeForDb(schedule.break_end)
          : null,

      grace_period_minutes:
        Number(schedule.grace_period_minutes) || 0,
    }));

    console.log(
      'PAYLOAD HORAIRES:',
      JSON.stringify(payload, null, 2)
    );

    const { error } = await supabase
      .from('site_work_schedules')
      .upsert(payload, {
        onConflict: 'site_id,day_of_week',
      });

    if (error) {
      console.error(
        'Erreur sauvegarde horaires:',
        error
      );

      throw error;
    }
  };



  // ==========================================================
  // CREATE SITE
  // ==========================================================

  const handleCreate = async () => {

    if (!validateForm()) return;

    if (!validateSchedules()) return;

    if (!profile?.structure_id) return;

    try {

      setActionLoading(true);

      setErrorMessage(null);

      const { data, error } =
        await supabase
          .from('sites')
          .insert({

            name:
              formValues.name.trim(),

            type:
              formValues.type,

            city_id:
              formValues.city_id,

            structure_id:
              profile.structure_id,

            work_start:
              formValues.work_start
                ? `${formValues.work_start}:00`
                : null,

            work_end:
              formValues.work_end
                ? `${formValues.work_end}:00`
                : null,

            is_active:
              formValues.is_active,

            address:
              formValues.address.trim() || null,

            latitude:
              formValues.latitude.trim()
                ? Number(formValues.latitude)
                : null,

            longitude:
              formValues.longitude.trim()
                ? Number(formValues.longitude)
                : null,

            location_radius_m:
              Number(
                formValues.location_radius_m
              ),

            max_gps_accuracy_m:
              Number(
                formValues.max_gps_accuracy_m
              ),

            gps_required:
              formValues.gps_required,

            wifi_ssid:
              formValues.wifi_ssid.trim() || null,

            wifi_required:
              formValues.wifi_required,

            offline_attendance_enabled:
              formValues.offline_attendance_enabled,

            timezone:
              formValues.timezone,

          })
          .select('id')
          .single();

      if (error) throw error;

      if (!data?.id) {
        throw new Error(
          'Le site a été créé mais son identifiant est introuvable.'
        );
      }

      await saveSchedules(data.id);

      closeDialog();

      await fetchSites();

    } catch (error: any) {

      console.error(
        'Erreur création site:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de créer le site.'
      );

    } finally {

      setActionLoading(false);

    }

  };


  // ==========================================================
  // UPDATE SITE
  // ==========================================================

  const handleUpdate = async () => {

    if (!selectedSite) return;

    if (!profile?.structure_id) return;

    if (!validateForm()) return;

    if (!validateSchedules()) return;

    try {

      setActionLoading(true);

      setErrorMessage(null);

      const { error } =
        await supabase
          .from('sites')
          .update({

            name:
              formValues.name.trim(),

            type:
              formValues.type,

            city_id:
              formValues.city_id,

            work_start:
              formValues.work_start
                ? `${formValues.work_start}:00`
                : null,

            work_end:
              formValues.work_end
                ? `${formValues.work_end}:00`
                : null,

            is_active:
              formValues.is_active,

            address:
              formValues.address.trim() || null,

            latitude:
              formValues.latitude.trim()
                ? Number(formValues.latitude)
                : null,

            longitude:
              formValues.longitude.trim()
                ? Number(formValues.longitude)
                : null,

            location_radius_m:
              Number(
                formValues.location_radius_m
              ),

            max_gps_accuracy_m:
              Number(
                formValues.max_gps_accuracy_m
              ),

            gps_required:
              formValues.gps_required,

            wifi_ssid:
              formValues.wifi_ssid.trim() || null,

            wifi_required:
              formValues.wifi_required,

            offline_attendance_enabled:
              formValues.offline_attendance_enabled,

            timezone:
              formValues.timezone,

          })
          .eq('id', selectedSite.id)
          .eq(
            'structure_id',
            profile.structure_id
          );

      if (error) throw error;

      await saveSchedules(selectedSite.id);

      closeDialog();

      await fetchSites();

    } catch (error: any) {

      console.error(
        'Erreur modification site:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de modifier le site.'
      );

    } finally {

      setActionLoading(false);

    }

  };


  // ==========================================================
  // TOGGLE ACTIVE
  // ==========================================================

  const handleToggleActive = async () => {

    if (
      !confirmSite ||
      !profile?.structure_id
    ) {
      return;
    }

    const newValue =
      confirmAction === 'activate';

    try {

      setActionLoading(true);

      setErrorMessage(null);

      const { error } =
        await supabase
          .from('sites')
          .update({
            is_active: newValue,
          })
          .eq('id', confirmSite.id)
          .eq(
            'structure_id',
            profile.structure_id
          );

      if (error) throw error;

      closeConfirm();

      await fetchSites();

    } catch (error: any) {

      console.error(
        'Erreur statut site:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de modifier le statut du site.'
      );

    } finally {

      setActionLoading(false);

    }

  };


  // ==========================================================
  // ACCESS GUARDS
  // ==========================================================

  if (role !== 'manager') {

    return (
      <DashboardLayout>

        <div className="flex items-center justify-center py-20">

          <p className="text-muted-foreground">
            Cette page est réservée aux managers.
          </p>

        </div>

      </DashboardLayout>
    );

  }


  if (!profile?.structure_id) {

    return (
      <DashboardLayout>

        <div className="flex flex-col items-center justify-center py-20 gap-3">

          <AlertTriangle className="h-10 w-10 text-warning" />

          <p className="text-muted-foreground text-center">

            Votre compte n'est associé à aucune structure.
            <br />

            Veuillez contacter un administrateur.

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

        <div className="animate-fade-in">

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">

            <div>

              <Skeleton className="h-8 w-32 mb-2" />

              <Skeleton className="h-4 w-56" />

            </div>

            <Skeleton className="h-10 w-36" />

          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {[1, 2, 3, 4, 5, 6].map((i) => (

              <Skeleton
                key={i}
                className="h-48 rounded-xl"
              />

            ))}

          </div>

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


        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">

          <div>

            <div className="flex items-center gap-2 mb-1">

              <MapPin className="h-6 w-6 text-primary" />

              <h1 className="page-title">
                Sites
              </h1>

            </div>

            <p className="text-muted-foreground">
              Gérez les sites de votre structure
            </p>

          </div>

          <Button
            onClick={openCreate}
            className="shrink-0"
          >

            <Plus className="h-4 w-4 mr-2" />

            Nouveau site

          </Button>

        </div>


        {/* ====================================================
            ERROR
        ==================================================== */}

        {errorMessage && (

          <Alert
            variant="destructive"
            className="mb-6"
          >

            <AlertTitle>
              Erreur
            </AlertTitle>

            <AlertDescription>
              {errorMessage}
            </AlertDescription>

          </Alert>

        )}


        {/* ====================================================
            TOOLBAR
        ==================================================== */}

        <div className="flex flex-col md:flex-row gap-3 mb-6">

          <div className="relative flex-1">

            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

            <Input
              className="pl-9"
              placeholder="Rechercher un site…"
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
            />

          </div>


          {/* <div className="flex gap-2">

            {(
              ['active', 'all', 'inactive']
              as StatusFilter[]
            ).map((filter) => {

              const labels: Record<
                StatusFilter,
                string
              > = {
                active: 'Actifs',
                all: 'Tous',
                inactive: 'Inactifs',
              };

              return (

                <Button
                  key={filter}
                  variant={
                    statusFilter === filter
                      ? 'default'
                      : 'outline'
                  }
                  size="sm"
                  onClick={() =>
                    setStatusFilter(filter)
                  }
                >
                  {labels[filter]}
                </Button>

              );

            })}

          </div> */}


          <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">

            <MapPin className="h-4 w-4" />

            <span>
              {filteredSites.length} site(s)
            </span>

          </div>

        </div>


        {/* ====================================================
            EMPTY
        ==================================================== */}

        {filteredSites.length === 0 && (

          <div className="flex flex-col items-center justify-center py-20 gap-4">

            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">

              <MapPin className="h-8 w-8 text-muted-foreground" />

            </div>

            <div className="text-center">

              <p className="font-semibold text-foreground mb-1">

                {search ||
                  statusFilter !== 'active'
                  ? 'Aucun site ne correspond à vos critères.'
                  : "Vous n'avez encore aucun site."}

              </p>

              {!search &&
                statusFilter === 'active' && (

                  <p className="text-sm text-muted-foreground">

                    Créez votre premier site pour organiser les lieux de travail.

                  </p>

                )}

            </div>

            {!search &&
              statusFilter === 'active' && (

                <Button onClick={openCreate}>

                  <Plus className="h-4 w-4 mr-2" />

                  Créer un site

                </Button>

              )}

          </div>

        )}


        {/* ====================================================
            GRID
        ==================================================== */}

        {filteredSites.length > 0 && (

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {filteredSites.map((site) => (

              <Card
                key={site.id}
                className={`relative transition-opacity ${!site.is_active
                    ? 'opacity-60'
                    : ''
                  }`}
              >

                <CardHeader className="pb-3">

                  <div className="flex items-start justify-between gap-2">

                    <div className="flex items-center gap-2 min-w-0">

                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">

                        <TypeIcon
                          type={site.type}
                        />

                      </div>

                      <CardTitle className="text-base leading-tight truncate">

                        {site.name}

                      </CardTitle>

                    </div>


                    <DropdownMenu>

                      <DropdownMenuTrigger asChild>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                        >

                          <MoreHorizontal className="h-4 w-4" />

                        </Button>

                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">

                        <DropdownMenuItem
                          onClick={() =>
                            openDetails(site)
                          }
                        >

                          <Eye className="h-4 w-4 mr-2" />

                          Voir les détails

                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() =>
                            openEdit(site)
                          }
                        >

                          <Pencil className="h-4 w-4 mr-2" />

                          Modifier

                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {site.is_active ? (

                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() =>
                              openConfirm(
                                site,
                                'deactivate'
                              )
                            }
                          >

                            <PowerOff className="h-4 w-4 mr-2" />

                            Désactiver

                          </DropdownMenuItem>

                        ) : (

                          <DropdownMenuItem
                            className="text-success"
                            onClick={() =>
                              openConfirm(
                                site,
                                'activate'
                              )
                            }
                          >

                            <Power className="h-4 w-4 mr-2" />

                            Réactiver

                          </DropdownMenuItem>

                        )}

                      </DropdownMenuContent>

                    </DropdownMenu>

                  </div>

                </CardHeader>


                <CardContent className="space-y-2 text-sm">

                  <div className="flex items-center gap-2 text-muted-foreground">

                    <MapPin className="h-3.5 w-3.5 shrink-0" />

                    <span className="truncate">

                      {site.city_name}

                    </span>

                  </div>


                  {site.address && (

                    <div className="flex items-center gap-2 text-muted-foreground">

                      <Navigation className="h-3.5 w-3.5 shrink-0" />

                      <span className="truncate">

                        {site.address}

                      </span>

                    </div>

                  )}


                  <div className="flex items-center gap-2 text-muted-foreground">

                    <Clock className="h-3.5 w-3.5 shrink-0" />

                    <span>

                      {formatTime(site.work_start)}
                      {' — '}
                      {formatTime(site.work_end)}

                    </span>

                  </div>


                  <div className="flex items-center gap-2 text-muted-foreground">

                    <Users className="h-3.5 w-3.5 shrink-0" />

                    <span>

                      {site.employee_count} employé(s)

                    </span>

                  </div>


                  <div className="flex items-center gap-2 text-muted-foreground">

                    {site.gps_required ? (

                      <ShieldCheck className="h-3.5 w-3.5" />

                    ) : (

                      <ShieldAlert className="h-3.5 w-3.5" />

                    )}

                    <span>

                      GPS {site.gps_required
                        ? 'activé'
                        : 'optionnel'}

                    </span>

                  </div>


                  <div className="flex items-center gap-2 text-muted-foreground">

                    {site.offline_attendance_enabled ? (

                      <Database className="h-3.5 w-3.5" />

                    ) : (

                      <Database className="h-3.5 w-3.5 opacity-40" />

                    )}

                    <span>

                      Hors ligne{' '}

                      {site.offline_attendance_enabled
                        ? 'activé'
                        : 'désactivé'}

                    </span>

                  </div>


                  <div className="flex items-center justify-between pt-2 border-t border-border/50">

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${site.is_active
                          ? 'text-success'
                          : 'text-muted-foreground'
                        }`}
                    >

                      <span
                        className={`h-1.5 w-1.5 rounded-full ${site.is_active
                            ? 'bg-success'
                            : 'bg-muted-foreground'
                          }`}
                      />

                      {site.is_active
                        ? 'Actif'
                        : 'Inactif'}

                    </span>


                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">

                      {typeLabel(site.type)}

                    </span>

                  </div>

                </CardContent>

              </Card>

            ))}

          </div>

        )}


        {/* ====================================================
            CREATE / EDIT
        ==================================================== */}

        <Dialog
          open={
            dialogMode === 'create' ||
            dialogMode === 'edit'
          }
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        >

          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">

            <DialogHeader>

              <DialogTitle>

                {dialogMode === 'create'
                  ? 'Nouveau site'
                  : 'Modifier le site'}

              </DialogTitle>

              <DialogDescription>

                {dialogMode === 'create'
                  ? 'Configurez les informations générales, la localisation et les paramètres de présence du site.'
                  : 'Modifiez la configuration du site.'}

              </DialogDescription>

            </DialogHeader>


            <div className="space-y-6 py-2">


              {/* ==================================================
                  INFORMATIONS GENERALES
              ================================================== */}

              <div className="space-y-4">

                <h3 className="font-semibold text-sm">
                  Informations générales
                </h3>


                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <div className="space-y-1.5">

                    <Label htmlFor="site-name">
                      Nom du site *
                    </Label>

                    <Input
                      id="site-name"
                      placeholder="Ex : Magasin Centre-Ville"
                      value={formValues.name}
                      onChange={(e) =>
                        updateField(
                          'name',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.name && (

                      <p className="text-xs text-destructive">
                        {formErrors.name}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label>
                      Type *
                    </Label>

                    <Select
                      value={formValues.type}
                      onValueChange={(value) =>
                        updateField(
                          'type',
                          value as
                          | 'magasin'
                          | 'cave'
                        )
                      }
                    >

                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>

                        <SelectItem value="magasin">
                          Magasin
                        </SelectItem>

                        <SelectItem value="cave">
                          Cave
                        </SelectItem>

                      </SelectContent>

                    </Select>

                  </div>


                  <div className="space-y-1.5">

                    <Label>
                      Ville *
                    </Label>

                    <Select
                      value={formValues.city_id}
                      onValueChange={(value) =>
                        updateField(
                          'city_id',
                          value
                        )
                      }
                    >

                      <SelectTrigger>

                        <SelectValue
                          placeholder="Sélectionner une ville"
                        />

                      </SelectTrigger>

                      <SelectContent>

                        {cities.map((city) => (

                          <SelectItem
                            key={city.id}
                            value={city.id}
                          >
                            {city.name}
                          </SelectItem>

                        ))}

                      </SelectContent>

                    </Select>

                    {formErrors.city_id && (

                      <p className="text-xs text-destructive">
                        {formErrors.city_id}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label htmlFor="site-address">
                      Adresse
                    </Label>

                    <Input
                      id="site-address"
                      placeholder="Ex : Rue de la République"
                      value={formValues.address}
                      onChange={(e) =>
                        updateField(
                          'address',
                          e.target.value
                        )
                      }
                    />

                  </div>

                </div>

              </div>


              {/* ==================================================
                  LOCALISATION GPS
              ================================================== */}

              <div className="space-y-4">

                <div className="flex items-center gap-2">

                  <Navigation className="h-4 w-4 text-primary" />

                  <h3 className="font-semibold text-sm">
                    Localisation GPS
                  </h3>

                </div>


                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <div className="space-y-1.5">

                    <Label htmlFor="latitude">
                      Latitude
                    </Label>

                    <Input
                      id="latitude"
                      type="number"
                      step="any"
                      placeholder="Ex : 4.051056"
                      value={formValues.latitude}
                      onChange={(e) =>
                        updateField(
                          'latitude',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.latitude && (

                      <p className="text-xs text-destructive">
                        {formErrors.latitude}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label htmlFor="longitude">
                      Longitude
                    </Label>

                    <Input
                      id="longitude"
                      type="number"
                      step="any"
                      placeholder="Ex : 9.767869"
                      value={formValues.longitude}
                      onChange={(e) =>
                        updateField(
                          'longitude',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.longitude && (

                      <p className="text-xs text-destructive">
                        {formErrors.longitude}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label htmlFor="radius">
                      Rayon autorisé (m)
                    </Label>

                    <Input
                      id="radius"
                      type="number"
                      min="1"
                      value={
                        formValues.location_radius_m
                      }
                      onChange={(e) =>
                        updateField(
                          'location_radius_m',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.location_radius_m && (

                      <p className="text-xs text-destructive">
                        {formErrors.location_radius_m}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label htmlFor="accuracy">
                      Précision GPS maximale (m)
                    </Label>

                    <Input
                      id="accuracy"
                      type="number"
                      min="1"
                      value={
                        formValues.max_gps_accuracy_m
                      }
                      onChange={(e) =>
                        updateField(
                          'max_gps_accuracy_m',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.max_gps_accuracy_m && (

                      <p className="text-xs text-destructive">
                        {formErrors.max_gps_accuracy_m}
                      </p>

                    )}

                  </div>

                </div>


                <div className="flex items-center justify-between rounded-lg border p-3">

                  <div className="flex items-center gap-3">

                    {formValues.gps_required ? (

                      <ShieldCheck className="h-5 w-5 text-primary" />

                    ) : (

                      <ShieldAlert className="h-5 w-5 text-muted-foreground" />

                    )}

                    <div>

                      <p className="text-sm font-medium">
                        GPS obligatoire
                      </p>

                      <p className="text-xs text-muted-foreground">
                        Les coordonnées GPS seront exigées lors du pointage.
                      </p>

                    </div>

                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={
                      formValues.gps_required
                        ? 'default'
                        : 'outline'
                    }
                    onClick={() =>
                      updateField(
                        'gps_required',
                        !formValues.gps_required
                      )
                    }
                  >
                    {formValues.gps_required
                      ? 'Activé'
                      : 'Désactivé'}
                  </Button>

                </div>

              </div>


              {/* ==================================================
                  WIFI
              ================================================== */}

              <div className="space-y-4">

                <div className="flex items-center gap-2">

                  {formValues.wifi_required ? (
                    <Wifi className="h-4 w-4 text-primary" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}

                  <h3 className="font-semibold text-sm">
                    Wi-Fi
                  </h3>

                </div>


                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <div className="space-y-1.5">

                    <Label htmlFor="wifi-ssid">
                      SSID du Wi-Fi
                    </Label>

                    <Input
                      id="wifi-ssid"
                      placeholder="Ex : ENTREPRISE_WIFI"
                      value={formValues.wifi_ssid}
                      onChange={(e) =>
                        updateField(
                          'wifi_ssid',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.wifi_ssid && (

                      <p className="text-xs text-destructive">
                        {formErrors.wifi_ssid}
                      </p>

                    )}

                  </div>


                  <div className="flex items-center justify-between rounded-lg border p-3">

                    <div>

                      <p className="text-sm font-medium">
                        Wi-Fi obligatoire
                      </p>

                      <p className="text-xs text-muted-foreground">
                        Utiliser le réseau comme information complémentaire de présence.
                      </p>

                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant={
                        formValues.wifi_required
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() =>
                        updateField(
                          'wifi_required',
                          !formValues.wifi_required
                        )
                      }
                    >
                      {formValues.wifi_required
                        ? 'Activé'
                        : 'Désactivé'}
                    </Button>

                  </div>

                </div>

              </div>


              {/* ==================================================
                  PRESENCE / HORS LIGNE
              ================================================== */}

              <div className="space-y-4">

                <div className="flex items-center gap-2">

                  <Database className="h-4 w-4 text-primary" />

                  <h3 className="font-semibold text-sm">
                    Présence
                  </h3>

                </div>


                <div className="flex items-center justify-between rounded-lg border p-3">

                  <div>

                    <p className="text-sm font-medium">
                      Pointage hors ligne
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Autoriser l'application à enregistrer les pointages sans connexion.
                    </p>

                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={
                      formValues.offline_attendance_enabled
                        ? 'default'
                        : 'outline'
                    }
                    onClick={() =>
                      updateField(
                        'offline_attendance_enabled',
                        !formValues.offline_attendance_enabled
                      )
                    }
                  >
                    {formValues.offline_attendance_enabled
                      ? 'Activé'
                      : 'Désactivé'}
                  </Button>

                </div>


                <div className="space-y-1.5">

                  <Label>
                    Fuseau horaire
                  </Label>

                  <Select
                    value={formValues.timezone}
                    onValueChange={(value) =>
                      updateField(
                        'timezone',
                        value
                      )
                    }
                  >

                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>

                      {TIMEZONES.map(
                        (timezone) => (

                          <SelectItem
                            key={timezone}
                            value={timezone}
                          >
                            {timezone}
                          </SelectItem>

                        )
                      )}

                    </SelectContent>

                  </Select>

                </div>

              </div>


              {/* ==================================================
                  HORAIRES GENERAUX
              ================================================== */}

              <div className="space-y-4">

                <div className="flex items-center gap-2">

                  <Clock className="h-4 w-4 text-primary" />

                  <h3 className="font-semibold text-sm">
                    Horaires généraux
                  </h3>

                </div>


                <div className="grid grid-cols-2 gap-3">

                  <div className="space-y-1.5">

                    <Label htmlFor="work-start">
                      Heure de début
                    </Label>

                    <Input
                      id="work-start"
                      type="time"
                      value={formValues.work_start}
                      onChange={(e) =>
                        updateField(
                          'work_start',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.work_start && (

                      <p className="text-xs text-destructive">
                        {formErrors.work_start}
                      </p>

                    )}

                  </div>


                  <div className="space-y-1.5">

                    <Label htmlFor="work-end">
                      Heure de fin
                    </Label>

                    <Input
                      id="work-end"
                      type="time"
                      value={formValues.work_end}
                      onChange={(e) =>
                        updateField(
                          'work_end',
                          e.target.value
                        )
                      }
                    />

                    {formErrors.work_end && (

                      <p className="text-xs text-destructive">
                        {formErrors.work_end}
                      </p>

                    )}

                  </div>

                </div>

              </div>


              {/* ==================================================
                  HORAIRES PAR JOUR
              ================================================== */}

              <div className="space-y-4">

                <div>

                  <h3 className="font-semibold text-sm">
                    Horaires par jour
                  </h3>

                  <p className="text-xs text-muted-foreground mt-1">
                    Ces horaires permettent de définir précisément les jours travaillés.
                  </p>

                </div>


                <div className="space-y-3">

                  {scheduleForms.map(
                    (schedule) => (

                      <div
                        key={schedule.day_of_week}
                        className="rounded-lg border p-3 space-y-3"
                      >

                        <div className="flex items-center justify-between">

                          <span className="font-medium text-sm">
                            {dayLabel(
                              schedule.day_of_week
                            )}
                          </span>

                          <Button
                            type="button"
                            size="sm"
                            variant={
                              schedule.is_working_day
                                ? 'default'
                                : 'outline'
                            }
                            onClick={() =>
                              updateSchedule(
                                schedule.day_of_week,
                                'is_working_day',
                                !schedule.is_working_day
                              )
                            }
                          >
                            {schedule.is_working_day
                              ? 'Jour travaillé'
                              : 'Repos'}
                          </Button>

                        </div>


                        {schedule.is_working_day && (

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                            <div className="space-y-1">

                              <Label className="text-xs">
                                Début
                              </Label>

                              <Input
                                type="time"
                                value={
                                  schedule.work_start
                                }
                                onChange={(e) =>
                                  updateSchedule(
                                    schedule.day_of_week,
                                    'work_start',
                                    e.target.value
                                  )
                                }
                              />

                            </div>


                            <div className="space-y-1">

                              <Label className="text-xs">
                                Fin
                              </Label>

                              <Input
                                type="time"
                                value={
                                  schedule.work_end
                                }
                                onChange={(e) =>
                                  updateSchedule(
                                    schedule.day_of_week,
                                    'work_end',
                                    e.target.value
                                  )
                                }
                              />

                            </div>


                            <div className="space-y-1">

                              <Label className="text-xs">
                                Début pause
                              </Label>

                              <Input
                                type="time"
                                value={
                                  schedule.break_start
                                }
                                onChange={(e) =>
                                  updateSchedule(
                                    schedule.day_of_week,
                                    'break_start',
                                    e.target.value
                                  )
                                }
                              />

                            </div>


                            <div className="space-y-1">

                              <Label className="text-xs">
                                Fin pause
                              </Label>

                              <Input
                                type="time"
                                value={
                                  schedule.break_end
                                }
                                onChange={(e) =>
                                  updateSchedule(
                                    schedule.day_of_week,
                                    'break_end',
                                    e.target.value
                                  )
                                }
                              />

                            </div>


                            <div className="space-y-1 col-span-2 md:col-span-1">

                              <Label className="text-xs">
                                Grâce (min)
                              </Label>

                              <Input
                                type="number"
                                min="0"
                                value={
                                  schedule.grace_period_minutes
                                }
                                onChange={(e) =>
                                  updateSchedule(
                                    schedule.day_of_week,
                                    'grace_period_minutes',
                                    e.target.value
                                  )
                                }
                              />

                            </div>

                          </div>

                        )}

                      </div>

                    )
                  )}

                </div>

              </div>


              {/* ==================================================
                  STATUT
              ================================================== */}

              <div className="space-y-1.5">

                <Label>
                  Statut
                </Label>

                <Select
                  value={
                    formValues.is_active
                      ? 'active'
                      : 'inactive'
                  }
                  onValueChange={(value) =>
                    updateField(
                      'is_active',
                      value === 'active'
                    )
                  }
                >

                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="active">
                      Actif
                    </SelectItem>

                    <SelectItem value="inactive">
                      Inactif
                    </SelectItem>

                  </SelectContent>

                </Select>

              </div>

            </div>


            <DialogFooter>

              <Button
                variant="outline"
                onClick={closeDialog}
                disabled={actionLoading}
              >
                Annuler
              </Button>

              <Button
                onClick={
                  dialogMode === 'create'
                    ? handleCreate
                    : handleUpdate
                }
                disabled={actionLoading}
              >

                {actionLoading && (

                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />

                )}

                {dialogMode === 'create'
                  ? 'Créer le site'
                  : 'Enregistrer'}

              </Button>

            </DialogFooter>

          </DialogContent>

        </Dialog>


        {/* ====================================================
            DETAILS
        ==================================================== */}

        <Dialog
          open={dialogMode === 'details'}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        >

          {selectedSite && (

            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">

              <DialogHeader>

                <DialogTitle className="flex items-center gap-2">

                  <TypeIcon
                    type={selectedSite.type}
                  />

                  {selectedSite.name}

                </DialogTitle>

                <DialogDescription>
                  Configuration détaillée du site
                </DialogDescription>

              </DialogHeader>


              <div className="space-y-6 py-2">


                {/* GENERAL */}

                <div className="grid grid-cols-2 gap-4 text-sm">

                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Type
                    </p>

                    <p className="font-medium">
                      {typeLabel(
                        selectedSite.type
                      )}
                    </p>

                  </div>


                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Ville
                    </p>

                    <p className="font-medium">
                      {selectedSite.city_name}
                    </p>

                  </div>


                  <div className="col-span-2">

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Adresse
                    </p>

                    <p className="font-medium">
                      {selectedSite.address ||
                        'Non renseignée'}
                    </p>

                  </div>


                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Début
                    </p>

                    <p className="font-medium">
                      {formatTime(
                        selectedSite.work_start
                      )}
                    </p>

                  </div>


                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Fin
                    </p>

                    <p className="font-medium">
                      {formatTime(
                        selectedSite.work_end
                      )}
                    </p>

                  </div>

                </div>


                {/* GPS */}

                <div className="rounded-lg border p-4 space-y-3">

                  <div className="flex items-center gap-2">

                    <Navigation className="h-4 w-4 text-primary" />

                    <h3 className="font-semibold text-sm">
                      Localisation
                    </h3>

                  </div>


                  <div className="grid grid-cols-2 gap-4 text-sm">

                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Latitude
                      </p>

                      <p className="font-medium">
                        {formatCoordinate(
                          selectedSite.latitude
                        )}
                      </p>

                    </div>


                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Longitude
                      </p>

                      <p className="font-medium">
                        {formatCoordinate(
                          selectedSite.longitude
                        )}
                      </p>

                    </div>


                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Rayon
                      </p>

                      <p className="font-medium">
                        {selectedSite.location_radius_m} m
                      </p>

                    </div>


                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Précision maximale
                      </p>

                      <p className="font-medium">
                        {selectedSite.max_gps_accuracy_m} m
                      </p>

                    </div>

                  </div>


                  <div className="flex items-center gap-2 text-sm">

                    {selectedSite.gps_required ? (

                      <ShieldCheck className="h-4 w-4 text-success" />

                    ) : (

                      <ShieldAlert className="h-4 w-4 text-muted-foreground" />

                    )}

                    GPS{' '}

                    {selectedSite.gps_required
                      ? 'obligatoire'
                      : 'optionnel'}

                  </div>

                </div>


                {/* WIFI */}

                <div className="rounded-lg border p-4 space-y-3">

                  <div className="flex items-center gap-2">

                    {selectedSite.wifi_required ? (

                      <Wifi className="h-4 w-4 text-primary" />

                    ) : (

                      <WifiOff className="h-4 w-4 text-muted-foreground" />

                    )}

                    <h3 className="font-semibold text-sm">
                      Wi-Fi
                    </h3>

                  </div>


                  <div className="grid grid-cols-2 gap-4 text-sm">

                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        SSID
                      </p>

                      <p className="font-medium">
                        {selectedSite.wifi_ssid ||
                          'Non configuré'}
                      </p>

                    </div>


                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Statut
                      </p>

                      <p className="font-medium">
                        {selectedSite.wifi_required
                          ? 'Obligatoire'
                          : 'Optionnel'}
                      </p>

                    </div>

                  </div>

                </div>


                {/* PRESENCE */}

                <div className="rounded-lg border p-4 space-y-3">

                  <h3 className="font-semibold text-sm">
                    Présence
                  </h3>

                  <div className="grid grid-cols-2 gap-4 text-sm">

                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Hors ligne
                      </p>

                      <p className="font-medium">
                        {selectedSite.offline_attendance_enabled
                          ? 'Autorisé'
                          : 'Désactivé'}
                      </p>

                    </div>


                    <div>

                      <p className="text-muted-foreground text-xs mb-1">
                        Fuseau horaire
                      </p>

                      <p className="font-medium">
                        {selectedSite.timezone}
                      </p>

                    </div>

                  </div>

                </div>


                {/* SCHEDULES */}

                <div className="rounded-lg border p-4 space-y-3">

                  <h3 className="font-semibold text-sm">
                    Horaires par jour
                  </h3>

                  {schedules.length === 0 ? (

                    <p className="text-sm text-muted-foreground">
                      Aucun horaire détaillé.
                    </p>

                  ) : (

                    <div className="space-y-2">

                      {DAYS.map((day) => {

                        const schedule =
                          schedules.find(
                            (item) =>
                              item.day_of_week ===
                              day.value
                          );

                        if (!schedule) {

                          return (

                            <div
                              key={day.value}
                              className="flex items-center justify-between text-sm"
                            >

                              <span>
                                {day.label}
                              </span>

                              <span className="text-muted-foreground">
                                Non configuré
                              </span>

                            </div>

                          );

                        }

                        return (

                          <div
                            key={day.value}
                            className="flex items-center justify-between text-sm"
                          >

                            <span>
                              {day.label}
                            </span>

                            <span className="text-muted-foreground">

                              {schedule.is_working_day

                                ? `${formatTime(
                                  schedule.work_start
                                )} — ${formatTime(
                                  schedule.work_end
                                )}`

                                : 'Repos'}

                            </span>

                          </div>

                        );

                      })}

                    </div>

                  )}

                </div>


                {/* STATUS */}

                <div className="grid grid-cols-2 gap-4 text-sm">

                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Statut
                    </p>

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${selectedSite.is_active
                          ? 'text-success'
                          : 'text-muted-foreground'
                        }`}
                    >

                      <span
                        className={`h-1.5 w-1.5 rounded-full ${selectedSite.is_active
                            ? 'bg-success'
                            : 'bg-muted-foreground'
                          }`}
                      />

                      {selectedSite.is_active
                        ? 'Actif'
                        : 'Inactif'}

                    </span>

                  </div>


                  <div>

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Employés
                    </p>

                    <p className="font-medium flex items-center gap-1">

                      <Users className="h-3.5 w-3.5" />

                      {selectedSite.employee_count}

                    </p>

                  </div>


                  <div className="col-span-2">

                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                      Créé le
                    </p>

                    <p className="font-medium">

                      {new Date(
                        selectedSite.created_at
                      ).toLocaleDateString(
                        'fr-FR',
                        {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        }
                      )}

                    </p>

                  </div>

                </div>

              </div>


              <DialogFooter>

                <Button
                  variant="outline"
                  onClick={closeDialog}
                >
                  Fermer
                </Button>

                <Button
                  onClick={() => {

                    const site =
                      selectedSite;

                    closeDialog();

                    if (site) {
                      openEdit(site);
                    }

                  }}
                >

                  <Pencil className="h-4 w-4 mr-2" />

                  Modifier

                </Button>

              </DialogFooter>

            </DialogContent>

          )}

        </Dialog>


        {/* ====================================================
            CONFIRM
        ==================================================== */}

        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {

            if (!open) {
              closeConfirm();
            }

          }}
        >

          <AlertDialogContent>

            <AlertDialogHeader>

              <AlertDialogTitle>

                {confirmAction === 'deactivate'
                  ? 'Désactiver ce site ?'
                  : 'Réactiver ce site ?'}

              </AlertDialogTitle>

              <AlertDialogDescription>

                {confirmAction === 'deactivate'

                  ? 'Le site sera marqué comme inactif. Les données historiques associées seront conservées.'

                  : 'Le site sera à nouveau actif et disponible pour les employés.'}

              </AlertDialogDescription>

            </AlertDialogHeader>


            <AlertDialogFooter>

              <AlertDialogCancel
                disabled={actionLoading}
                onClick={closeConfirm}
              >
                Annuler
              </AlertDialogCancel>

              <AlertDialogAction
                onClick={handleToggleActive}
                disabled={actionLoading}
                className={
                  confirmAction === 'deactivate'
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : ''
                }
              >

                {actionLoading && (

                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />

                )}

                Confirmer

              </AlertDialogAction>

            </AlertDialogFooter>

          </AlertDialogContent>

        </AlertDialog>

      </div>

    </DashboardLayout>

  );
}