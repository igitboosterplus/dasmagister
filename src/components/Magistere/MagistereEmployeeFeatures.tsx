import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PlusCircle,
  Search,
  FileText,
  CalendarDays,
  MapPin,
  PlayCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useSearchParams } from 'react-router-dom';

export function MagistereEmployeeFeatures({
  employeeId,
  structureId,
}: {
  employeeId: string;
  structureId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'missions';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const [counts, setCounts] = useState({
    activeMissions: 0,
    totalMissions: 0,
    pendingAbsences: 0,
    totalAbsences: 0,
    pendingReports: 0,
    totalReports: 0,
  });

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['missions', 'absences', 'doleances'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  // Chargement des compteurs collaborateur
  useEffect(() => {
    if (!employeeId) return;

    const fetchEmployeeCounts = async () => {
      try {
        const [missionsRes, absencesRes, reportsRes] = await Promise.all([
          supabase.from('missions').select('id, status').eq('employee_id', employeeId),
          supabase.from('employee_absences').select('id, status').eq('employee_id', employeeId),
          supabase.from('reports').select('id, status').eq('employee_id', employeeId),
        ]);

        const mList = missionsRes.data || [];
        const aList = absencesRes.data || [];
        const rList = reportsRes.data || [];

        setCounts({
          activeMissions: mList.filter((m) => m.status === 'in_progress' || m.status === 'assigned').length,
          totalMissions: mList.length,
          pendingAbsences: aList.filter((a) => a.status === 'pending').length,
          totalAbsences: aList.length,
          pendingReports: rList.filter((r) => r.status === 'submitted').length,
          totalReports: rList.length,
        });
      } catch (e) {
        console.error('Erreur compteurs employé Magistère:', e);
      }
    };

    fetchEmployeeCounts();
  }, [employeeId]);

  return (
    <div className="space-y-6">
      {/* Employee Quick Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <button
          onClick={() => handleTabChange('missions')}
          className={`p-4 rounded-xl border text-left transition-all group ${
            activeTab === 'missions'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border/80 bg-card hover:bg-muted/40 hover:border-primary/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Mes Missions
            </span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <MapPin className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-foreground">
              {counts.activeMissions}
            </span>
            <span className="text-xs text-muted-foreground">
              actives ({counts.totalMissions} au total)
            </span>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('absences')}
          className={`p-4 rounded-xl border text-left transition-all group ${
            activeTab === 'absences'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border/80 bg-card hover:bg-muted/40 hover:border-primary/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Mes Absences
            </span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CalendarDays className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-foreground">
              {counts.totalAbsences}
            </span>
            <span className="text-xs text-muted-foreground">
              posée{counts.totalAbsences > 1 ? 's' : ''} ({counts.pendingAbsences} en attente)
            </span>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('doleances')}
          className={`p-4 rounded-xl border text-left transition-all group ${
            activeTab === 'doleances'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border/80 bg-card hover:bg-muted/40 hover:border-primary/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Mes Doléances
            </span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <FileText className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-display text-foreground">
              {counts.totalReports}
            </span>
            <span className="text-xs text-muted-foreground">
              soumise{counts.totalReports > 1 ? 's' : ''} ({counts.pendingReports} en cours)
            </span>
          </div>
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="mb-6 grid grid-cols-3 max-w-md h-auto p-1 bg-muted/60 rounded-xl">
          <TabsTrigger value="missions" className="text-xs sm:text-sm py-2 rounded-lg">
            Mes Missions
          </TabsTrigger>
          <TabsTrigger value="absences" className="text-xs sm:text-sm py-2 rounded-lg">
            Mes Absences
          </TabsTrigger>
          <TabsTrigger value="doleances" className="text-xs sm:text-sm py-2 rounded-lg">
            Mes Doléances
          </TabsTrigger>
        </TabsList>

        <TabsContent value="missions" className="mt-0 focus-visible:outline-none">
          <EmployeeMissionsTab employeeId={employeeId} />
        </TabsContent>

        <TabsContent value="absences" className="mt-0 focus-visible:outline-none">
          <EmployeeAbsencesTab employeeId={employeeId} structureId={structureId} />
        </TabsContent>

        <TabsContent value="doleances" className="mt-0 focus-visible:outline-none">
          <EmployeeReportsTab employeeId={employeeId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// ONGLET 1 : MES MISSIONS
// ============================================================
function EmployeeMissionsTab({ employeeId }: { employeeId: string }) {
  const [missions, setMissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const { toast } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: m, error } = await supabase
        .from('missions')
        .select('*')
        .eq('employee_id', employeeId)
        .order('planned_start', { ascending: false });

      if (error) throw error;
      setMissions(m || []);
    } catch (err: any) {
      console.error('Erreur chargement missions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const handleStart = async (id: string) => {
    if (!navigator.geolocation) {
      toast({
        title: 'Erreur',
        description: 'La géolocalisation n’est pas supportée par votre navigateur.',
        variant: 'destructive',
      });
      return;
    }

    setActionLoadingId(id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const { error } = await supabase.rpc('start_mission', {
            p_mission_id: id,
            p_lat: latitude,
            p_lon: longitude,
          });

          if (error) throw error;

          toast({
            title: 'Mission démarrée',
            description: 'Votre prise de poste et position ont été enregistrées.',
          });
          loadData();
        } catch (err: any) {
          toast({
            title: 'Erreur',
            description: err.message || 'Impossible de démarrer la mission.',
            variant: 'destructive',
          });
        } finally {
          setActionLoadingId(null);
        }
      },
      (err) => {
        setActionLoadingId(null);
        toast({
          title: 'Erreur GPS',
          description: 'La localisation GPS est requise pour démarrer la mission.',
          variant: 'destructive',
        });
      }
    );
  };

  const handleComplete = async (id: string) => {
    if (!navigator.geolocation) {
      toast({
        title: 'Erreur',
        description: 'La géolocalisation n’est pas supportée par votre navigateur.',
        variant: 'destructive',
      });
      return;
    }

    setActionLoadingId(id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const { error } = await supabase.rpc('complete_mission', {
            p_mission_id: id,
            p_lat: latitude,
            p_lon: longitude,
          });

          if (error) throw error;

          toast({
            title: 'Mission terminée',
            description: 'La fin de mission a été confirmée avec succès.',
          });
          loadData();
        } catch (err: any) {
          toast({
            title: 'Erreur',
            description: err.message || 'Impossible de terminer la mission.',
            variant: 'destructive',
          });
        } finally {
          setActionLoadingId(null);
        }
      },
      (err) => {
        setActionLoadingId(null);
        toast({
          title: 'Erreur GPS',
          description: 'La localisation GPS est requise pour clôturer la mission.',
          variant: 'destructive',
        });
      }
    );
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs">Chargement de vos missions...</span>
        </div>
      ) : missions.length === 0 ? (
        <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg border border-dashed">
          Aucune mission ne vous est assignée pour le moment.
        </div>
      ) : (
        missions.map((m) => (
          <Card key={m.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-base text-foreground">{m.title}</h4>
                  <Badge
                    variant={
                      m.status === 'completed'
                        ? 'default'
                        : m.status === 'in_progress'
                        ? 'secondary'
                        : m.status === 'cancelled'
                        ? 'destructive'
                        : 'outline'
                    }
                  >
                    {m.status === 'completed'
                      ? 'Terminée'
                      : m.status === 'in_progress'
                      ? 'En cours'
                      : m.status === 'cancelled'
                      ? 'Annulée'
                      : 'Assignée'}
                  </Badge>
                </div>

                {m.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {m.description}
                  </p>
                )}

                <div className="text-xs text-muted-foreground flex flex-wrap gap-4 pt-1">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                    {m.location || 'Lieu non précisé'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
                    Prévu le :{' '}
                    {new Date(m.planned_start).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                {m.status === 'assigned' && (
                  <Button
                    size="sm"
                    disabled={actionLoadingId === m.id}
                    onClick={() => handleStart(m.id)}
                  >
                    {actionLoadingId === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <PlayCircle className="h-4 w-4 mr-1.5" />
                    )}
                    Démarrer
                  </Button>
                )}
                {m.status === 'in_progress' && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={actionLoadingId === m.id}
                    onClick={() => handleComplete(m.id)}
                  >
                    {actionLoadingId === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    )}
                    Terminer
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ============================================================
// ONGLET 2 : MES DÉCLARATIONS D'ABSENCE
// ============================================================
function EmployeeAbsencesTab({
  employeeId,
  structureId,
}: {
  employeeId: string;
  structureId: string;
}) {
  const [absences, setAbsences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const [formData, setFormData] = useState({
    type: 'leave',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: m, error } = await supabase
        .from('employee_absences')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAbsences(m || []);
    } catch (err: any) {
      console.error('Erreur chargement absences:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const handleCreate = async () => {
    if (!formData.start_date || !formData.end_date) {
      toast({
        title: 'Champs requis',
        description: 'Veuillez sélectionner les dates de début et de fin.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.from('employee_absences').insert({
        employee_id: employeeId,
        structure_id: structureId,
        type: formData.type as any,
        start_date: formData.start_date,
        end_date: formData.end_date,
        reason: formData.reason.trim() || null,
        status: 'pending',
      });

      if (error) throw error;

      toast({
        title: 'Demande envoyée',
        description: 'Votre demande d’absence a été transmise à votre responsable.',
      });
      setOpen(false);
      setFormData({ type: 'leave', start_date: '', end_date: '', reason: '' });
      loadData();
    } catch (err: any) {
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible d’envoyer la demande.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getAbsenceLabel = (type: string) => {
    switch (type) {
      case 'leave':
        return 'Congé payé';
      case 'sick':
        return 'Maladie';
      case 'mission':
        return 'Mission externe';
      case 'authorized_absence':
        return 'Absence exceptionnelle';
      case 'training':
        return 'Formation';
      case 'other':
      default:
        return 'Autre';
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)} size="sm">
          <PlusCircle className="mr-1.5 h-4 w-4" /> Nouvelle Demande
        </Button>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement de vos demandes...</span>
          </div>
        ) : absences.length === 0 ? (
          <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg border border-dashed">
            Aucune demande d'absence effectuée pour le moment.
          </div>
        ) : (
          absences.map((a) => (
            <Card key={a.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm">{getAbsenceLabel(a.type)}</h4>
                    <Badge
                      variant={
                        a.status === 'approved'
                          ? 'default'
                          : a.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {a.status === 'approved'
                        ? 'Approuvée'
                        : a.status === 'rejected'
                        ? 'Refusée'
                        : 'En attente'}
                    </Badge>
                  </div>

                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" />
                    <span>
                      Du {new Date(a.start_date).toLocaleDateString('fr-FR')} au{' '}
                      {new Date(a.end_date).toLocaleDateString('fr-FR')}
                    </span>
                  </div>

                  {a.reason && (
                    <div className="text-xs text-muted-foreground">
                      Motif : <strong className="text-foreground">{a.reason}</strong>
                    </div>
                  )}

                  {a.rejection_reason && (
                    <div className="text-xs text-destructive bg-destructive/5 p-2 rounded border border-destructive/20 mt-1">
                      Motif du refus : {a.rejection_reason}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Déclarer une indisponibilité</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Remplissez les détails de votre demande qui sera envoyée à votre manager.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Type d'absence</Label>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v })}
              >
                <SelectTrigger className="text-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave">Congé payé</SelectItem>
                  <SelectItem value="sick">Arrêt maladie</SelectItem>
                  <SelectItem value="mission">Mission externe</SelectItem>
                  <SelectItem value="authorized_absence">Absence exceptionnelle</SelectItem>
                  <SelectItem value="training">Formation</SelectItem>
                  <SelectItem value="other">Autre indisponibilité</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Date de début *</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Date de fin *</Label>
                <Input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="text-xs h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Motif / Explication</Label>
              <Textarea
                rows={3}
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Précisez la raison de votre demande..."
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={submitting || !formData.start_date || !formData.end_date}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Soumettre la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// ONGLET 3 : MES DOLÉANCES
// ============================================================
function EmployeeReportsTab({ employeeId }: { employeeId: string }) {
  const [reports, setReports] = useState<any[]>([]);
  const [reportTypes, setReportTypes] = useState<any[]>([]);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState('');

  const [formData, setFormData] = useState({
    typeId: '',
    title: '',
    description: '',
  });

  const loadData = async () => {
    try {
      setFetching(true);
      // Types disponibles
      const { data: types } = await supabase
        .from('report_types')
        .select('id, name')
        .order('name');
      if (types) setReportTypes(types);

      // Doléances soumises par l'employé
      const { data: r, error } = await supabase
        .from('reports')
        .select(`
          id,
          title,
          description,
          status,
          submitted_at,
          created_at,
          report_types (
            id,
            name
          )
        `)
        .or(`employee_id.eq.${employeeId},author_employee_id.eq.${employeeId}`)
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      const norm = (r || []).map((item: any) => ({
        ...item,
        report_types: Array.isArray(item.report_types)
          ? item.report_types[0] ?? null
          : item.report_types ?? null,
      }));
      setReports(norm);
    } catch (err: any) {
      console.error('Erreur chargement doléances:', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const handleCreate = async () => {
    if (!formData.typeId || !formData.title.trim() || !formData.description.trim()) {
      toast({
        title: 'Information',
        description: 'Veuillez remplir tous les champs obligatoires.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { error: reportError } = await supabase.rpc('submit_report', {
        p_report_type_id: formData.typeId,
        p_title: formData.title.trim(),
        p_description: formData.description.trim(),
      });

      if (reportError) throw reportError;

      toast({
        title: 'Doléance soumise',
        description: 'Votre doléance a été transmise avec succès à votre responsable.',
      });
      setOpen(false);
      setFormData({ typeId: '', title: '', description: '' });
      loadData();
    } catch (err: any) {
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de soumettre la doléance.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const STATUS_LABELS: Record<string, string> = {
    draft: 'Brouillon',
    submitted: 'Soumise',
    received: 'Reçue',
    forwarded: 'Transmise',
    reviewed: 'Examinée',
    archived: 'Archivée',
    rejected: 'Rejetée',
  };

  const filteredReports = reports.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>

        <Button onClick={() => setOpen(true)} size="sm">
          <PlusCircle className="mr-1.5 h-4 w-4" />
          Nouvelle Doléance
        </Button>
      </div>

      <div className="space-y-3">
        {fetching ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement de vos doléances...</span>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg border border-dashed">
            Aucune doléance trouvée ou soumise.
          </div>
        ) : (
          filteredReports.map((r) => (
            <Card key={r.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h4 className="font-semibold text-sm">{r.title}</h4>
                    <Badge
                      variant={
                        r.status === 'reviewed'
                          ? 'default'
                          : r.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {STATUS_LABELS[r.status] || r.status}
                    </Badge>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Type : <strong>{r.report_types?.name || 'Non défini'}</strong>
                  </div>

                  <div className="text-xs text-muted-foreground max-w-2xl bg-muted/30 p-2.5 rounded-lg border border-border/40 leading-relaxed">
                    {r.description}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground whitespace-nowrap text-right shrink-0">
                  Soumis le :{' '}
                  {new Date(r.submitted_at || r.created_at || Date.now()).toLocaleDateString(
                    'fr-FR'
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Soumettre une doléance</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Décrivez le sujet de votre requête qui sera transmise au responsable de votre site.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Type de requête <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.typeId}
                onValueChange={(v) => setFormData({ ...formData, typeId: v })}
              >
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Sélectionnez un type" />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Titre <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Sujet de votre doléance"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="text-xs h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                placeholder="Expliquez en détail votre demande ou situation..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="text-xs resize-none min-h-[100px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={
                loading ||
                !formData.typeId ||
                !formData.title.trim() ||
                !formData.description.trim()
              }
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Soumettre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
