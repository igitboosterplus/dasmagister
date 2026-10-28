import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
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
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Loader2,
  Ban,
  Filter,
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

import { ManagerRegistrationsTab } from '@/components/ManagerRegistrationsTab';

export function MagistereManagerFeatures({ structureId }: { structureId: string }) {
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary font-bold">
              MAGISTÈRE
            </Badge>
            <span>Fonctionnalités Spécifiques Manager</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Outils dédiés à la coordination interne, suivi des missions, validation des inscriptions et doléances.
          </p>
        </div>
      </div>

      <Tabs defaultValue="missions" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 mb-6 w-full max-w-3xl">
          <TabsTrigger value="missions" className="text-xs sm:text-sm">
            Missions
          </TabsTrigger>
          <TabsTrigger value="absences" className="text-xs sm:text-sm">
            Demandes d'absence
          </TabsTrigger>
          <TabsTrigger value="reports" className="text-xs sm:text-sm">
            Doléances reçues
          </TabsTrigger>
          <TabsTrigger value="types" className="text-xs sm:text-sm">
            Types de doléances
          </TabsTrigger>
          <TabsTrigger value="inscriptions" className="text-xs sm:text-sm flex items-center gap-1.5">
            <span>Inscriptions</span>
            {pendingCount > 0 && (
              <span className="h-4 min-w-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-white flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="missions" className="mt-0">
          <ManagerMissionsTab structureId={structureId} />
        </TabsContent>

        <TabsContent value="absences" className="mt-0">
          <ManagerAbsencesTab structureId={structureId} />
        </TabsContent>

        <TabsContent value="reports" className="mt-0">
          <ManagerReportsTab structureId={structureId} />
        </TabsContent>

        <TabsContent value="types" className="mt-0">
          <ManagerReportTypesTab structureId={structureId} />
        </TabsContent>

        <TabsContent value="inscriptions" className="mt-0">
          <ManagerRegistrationsTab structureId={structureId} onCountChange={setPendingCount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// TAB 1 : MISSIONS
// ============================================================
function ManagerMissionsTab({ structureId }: { structureId: string }) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [missions, setMissions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    employee_id: '',
    planned_start: '',
    planned_end: '',
  });

  const loadData = async () => {
    if (!structureId) return;

    try {
      setLoading(true);

      // 1. Employés actifs de cette structure
      const { data: emps, error: empsError } = await supabase
        .from('employees')
        .select('id, first_name, last_name')
        .eq('structure_id', structureId)
        .eq('is_active', true)
        .order('last_name', { ascending: true });

      if (empsError) throw empsError;
      setEmployees(emps || []);

      // 2. Missions de la structure avec jointure employé
      const { data: m, error: mError } = await supabase
        .from('missions')
        .select(`
          id,
          structure_id,
          employee_id,
          title,
          description,
          location,
          planned_start,
          planned_end,
          started_at,
          completed_at,
          status,
          created_at,
          employees!missions_employee_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq('structure_id', structureId)
        .order('planned_start', { ascending: false });

      if (mError) throw mError;
      setMissions(m || []);
    } catch (err: any) {
      console.error('Erreur chargement missions:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de charger les missions.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [structureId]);

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.employee_id || !formData.planned_start) {
      toast({
        title: 'Champs requis',
        description: 'Veuillez renseigner le titre, le collaborateur et la date de début prévue.',
        variant: 'destructive',
      });
      return;
    }

    const startDate = new Date(formData.planned_start);
    let endDate: Date | null = null;

    if (formData.planned_end) {
      endDate = new Date(formData.planned_end);
      if (endDate < startDate) {
        toast({
          title: 'Dates invalides',
          description: 'La fin prévue ne peut pas être antérieure au début.',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setSubmitting(true);

      const { error } = await supabase.from('missions').insert([
        {
          structure_id: structureId,
          employee_id: formData.employee_id,
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          location: formData.location.trim() || null,
          planned_start: startDate.toISOString(),
          planned_end: endDate ? endDate.toISOString() : null,
          created_by: profile?.id || null,
          status: 'assigned',
        },
      ]);

      if (error) throw error;

      toast({
        title: 'Mission planifiée',
        description: 'L’ordre de mission a été assigné au collaborateur avec succès.',
      });

      setOpen(false);
      setFormData({
        title: '',
        description: '',
        location: '',
        employee_id: '',
        planned_start: '',
        planned_end: '',
      });
      loadData();
    } catch (err: any) {
      console.error('Erreur création mission:', err);
      toast({
        title: 'Erreur de création',
        description: err.message || 'Impossible d’enregistrer la mission.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelMission = async (id: string) => {
    try {
      setActionLoadingId(id);
      const { error } = await supabase
        .from('missions')
        .update({ status: 'cancelled' })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Mission annulée',
        description: 'Le statut de la mission a été mis à jour.',
      });
      loadData();
    } catch (err: any) {
      console.error('Erreur annulation mission:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible d’annuler la mission.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const getMissionStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Terminée
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" /> En cours
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
            <Ban className="h-3 w-3 mr-1" /> Annulée
          </Badge>
        );
      case 'assigned':
      default:
        return (
          <Badge variant="outline" className="border-primary/40 text-primary">
            Assignée
          </Badge>
        );
    }
  };

  const filteredMissions = useMemo(() => {
    return missions.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const emp = Array.isArray(m.employees) ? m.employees[0] : m.employees;
        const empName = `${emp?.first_name || ''} ${emp?.last_name || ''}`.toLowerCase();
        const title = (m.title || '').toLowerCase();
        const loc = (m.location || '').toLowerCase();
        if (!title.includes(q) && !empName.includes(q) && !loc.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [missions, statusFilter, searchQuery]);

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border/50">
        <div>
          <CardTitle className="text-lg font-bold font-display">
            Gestion des Missions
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Planifiez, assignez et suivez le déroulement des ordres de mission terrain.
          </CardDescription>
        </div>

        <Button onClick={() => setOpen(true)} className="gap-2 self-start sm:self-auto shadow-sm">
          <PlusCircle className="h-4 w-4" />
          <span>Nouvelle Mission</span>
        </Button>
      </CardHeader>

      <CardContent className="pt-5 space-y-4">
        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par titre, collaborateur, lieu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Filtrer par statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="assigned">Assignée</SelectItem>
              <SelectItem value="in_progress">En cours</SelectItem>
              <SelectItem value="completed">Terminée</SelectItem>
              <SelectItem value="cancelled">Annulée</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement des missions...</span>
          </div>
        ) : filteredMissions.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 rounded-xl border border-dashed border-border/70 p-6">
            <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Aucune mission trouvée</p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchQuery || statusFilter !== 'all'
                ? 'Aucun résultat ne correspond à vos filtres.'
                : 'Créez un nouvel ordre de mission en cliquant sur "Nouvelle Mission".'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMissions.map((m) => {
              const emp = Array.isArray(m.employees) ? m.employees[0] : m.employees;
              const empFullName = emp ? `${emp.first_name} ${emp.last_name}` : 'Non assigné';

              const startFmt = m.planned_start
                ? format(parseISO(m.planned_start), 'd MMM yyyy à HH:mm', { locale: fr })
                : null;
              const endFmt = m.planned_end
                ? format(parseISO(m.planned_end), 'd MMM yyyy à HH:mm', { locale: fr })
                : null;

              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-sm hover:border-primary/30 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-base text-foreground tracking-tight">
                        {m.title}
                      </h4>
                      {getMissionStatusBadge(m.status)}
                    </div>

                    {m.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {m.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-primary" />
                        <span>Assigné à : <strong className="text-foreground">{empFullName}</strong></span>
                      </span>

                      {m.location && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                          <span>{m.location}</span>
                        </span>
                      )}

                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
                        <span>
                          Début : {startFmt}
                          {endFmt ? ` • Fin : ${endFmt}` : ''}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  {m.status === 'assigned' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoadingId === m.id}
                        onClick={() => handleCancelMission(m.id)}
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
                      >
                        {actionLoadingId === m.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                        )}
                        Annuler
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dialog Création de Mission */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display">Planifier une nouvelle mission</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Définissez les objectifs et assignez un collaborateur actif de votre structure.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Intitulé / Titre de la mission *</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ex: Audit de conformité, Intervention site client..."
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Collaborateur assigné *</Label>
                <Select
                  value={formData.employee_id}
                  onValueChange={(val) => setFormData({ ...formData, employee_id: val })}
                >
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Sélectionnez un employé de votre équipe" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.first_name} {e.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Lieu / Destination</Label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ex: Douala, Akwa ou Client XYZ"
                  className="text-xs h-9"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Début prévu *</Label>
                  <Input
                    type="datetime-local"
                    value={formData.planned_start}
                    onChange={(e) => setFormData({ ...formData, planned_start: e.target.value })}
                    className="text-xs h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Fin prévue (optionnelle)</Label>
                  <Input
                    type="datetime-local"
                    value={formData.planned_end}
                    onChange={(e) => setFormData({ ...formData, planned_end: e.target.value })}
                    className="text-xs h-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Instructions & Description</Label>
                <Textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Précisez les objectifs, le matériel requis ou les contacts..."
                  className="text-xs resize-none"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={submitting || !formData.title.trim() || !formData.employee_id || !formData.planned_start}
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Créer la mission
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ============================================================
// TAB 2 : DEMANDES D'ABSENCE
// ============================================================
function ManagerAbsencesTab({ structureId }: { structureId: string }) {
  const { toast } = useToast();

  const [absences, setAbsences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const loadData = async () => {
    if (!structureId) return;

    try {
      setLoading(true);

      const { data: m, error } = await supabase
        .from('employee_absences')
        .select(`
          id,
          employee_id,
          structure_id,
          type,
          start_date,
          end_date,
          reason,
          status,
          approved_by,
          approved_at,
          rejection_reason,
          created_at,
          employees!employee_absences_employee_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq('structure_id', structureId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAbsences(m || []);
    } catch (err: any) {
      console.error('Erreur chargement absences:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de charger les demandes d’absence.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [structureId]);

  const handleApprove = async (id: string) => {
    try {
      setActionLoadingId(id);

      const { error } = await supabase.rpc('approve_absence', { p_absence_id: id });
      if (error) throw error;

      toast({
        title: 'Demande approuvée',
        description: 'L’absence du collaborateur a été validée.',
      });

      loadData();
    } catch (err: any) {
      console.error('Erreur approbation:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible d’approuver cette absence.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const openRejectDialog = (id: string) => {
    setRejectId(id);
    setRejectReason('');
    setRejectDialogOpen(true);
  };

  const confirmReject = async () => {
    if (!rejectId || !rejectReason.trim()) {
      toast({
        title: 'Motif requis',
        description: 'Veuillez saisir un motif de refus pour informer l’employé.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setActionLoadingId(rejectId);

      const { error } = await supabase.rpc('reject_absence', {
        p_absence_id: rejectId,
        p_reason: rejectReason.trim(),
      });

      if (error) throw error;

      toast({
        title: 'Demande refusée',
        description: 'La demande d’absence a été rejetée avec motif.',
      });

      setRejectDialogOpen(false);
      loadData();
    } catch (err: any) {
      console.error('Erreur refus:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de refuser cette absence.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const getAbsenceTypeLabel = (type: string) => {
    switch (type) {
      case 'leave':
        return 'Congé payé';
      case 'authorized_absence':
        return 'Permission exceptionnelle';
      case 'sick':
        return 'Arrêt maladie';
      case 'mission':
        return 'Ordre de mission';
      case 'training':
        return 'Formation professionnelle';
      case 'other':
      default:
        return 'Autre absence';
    }
  };

  const getAbsenceStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Approuvée
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="h-3 w-3 mr-1" /> Refusée
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" /> En attente
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const calculateDays = (start: string, end: string) => {
    try {
      const s = parseISO(start);
      const e = parseISO(end);
      const diff = differenceInCalendarDays(e, s) + 1;
      return Math.max(1, diff);
    } catch {
      return 1;
    }
  };

  const filteredAbsences = useMemo(() => {
    return absences.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });
  }, [absences, statusFilter]);

  const pendingCount = absences.filter((a) => a.status === 'pending').length;

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-bold font-display">
              Demandes d'absence
            </CardTitle>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white font-bold text-[11px] px-2 py-0.5">
                {pendingCount} à traiter
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Examinez, validez ou refusez les demandes de congés et d’indisponibilités des collaborateurs.
          </CardDescription>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs">
            <SelectValue placeholder="Filtrer par statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les demandes</SelectItem>
            <SelectItem value="pending">En attente ({pendingCount})</SelectItem>
            <SelectItem value="approved">Approuvées</SelectItem>
            <SelectItem value="rejected">Refusées</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="pt-5 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement des demandes d'absence...</span>
          </div>
        ) : filteredAbsences.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 rounded-xl border border-dashed border-border/70 p-6">
            <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Aucune demande trouvée</p>
            <p className="text-xs text-muted-foreground mt-1">
              {statusFilter !== 'all'
                ? 'Aucune demande ne correspond à ce filtre.'
                : 'Aucune demande d’absence n’a été soumise pour le moment.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAbsences.map((a) => {
              const emp = Array.isArray(a.employees) ? a.employees[0] : a.employees;
              const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Collaborateur inconnu';

              const sFormatted = a.start_date
                ? format(parseISO(a.start_date), 'd MMMM yyyy', { locale: fr })
                : '';
              const eFormatted = a.end_date
                ? format(parseISO(a.end_date), 'd MMMM yyyy', { locale: fr })
                : '';
              const durationDays = calculateDays(a.start_date, a.end_date);

              return (
                <div
                  key={a.id}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-sm hover:border-primary/30 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-base text-foreground tracking-tight flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" />
                        {empName}
                      </span>
                      {getAbsenceStatusBadge(a.status)}
                      <Badge variant="outline" className="text-xs font-normal">
                        {getAbsenceTypeLabel(a.type)}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                        <span>Du {sFormatted} au {eFormatted}</span>
                        <span className="text-xs font-semibold text-primary ml-1">
                          ({durationDays} {durationDays > 1 ? 'jours' : 'jour'})
                        </span>
                      </p>

                      {a.reason && (
                        <p className="text-muted-foreground">
                          Motif : <strong className="text-foreground">{a.reason}</strong>
                        </p>
                      )}

                      {a.rejection_reason && (
                        <p className="text-destructive font-medium bg-destructive/5 p-2 rounded-lg border border-destructive/20 mt-1">
                          Motif du refus : {a.rejection_reason}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions for Pending Status */}
                  {a.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoadingId === a.id}
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
                        onClick={() => openRejectDialog(a.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Refuser
                      </Button>

                      <Button
                        size="sm"
                        disabled={actionLoadingId === a.id}
                        onClick={() => handleApprove(a.id)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                      >
                        {actionLoadingId === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        )}
                        Approuver
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Dialog Refus d'Absence */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>Motif du refus de l'absence</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Veuillez indiquer la raison pour laquelle vous rejetez cette demande. Elle sera consultable par le collaborateur.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Label className="text-xs font-semibold mb-1.5 block">
              Explication du refus *
            </Label>
            <Textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex: Période de forte activité nécessitant la présence de l'équipe..."
              className="text-xs resize-none"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
              disabled={Boolean(actionLoadingId)}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmReject}
              disabled={!rejectReason.trim() || Boolean(actionLoadingId)}
            >
              {actionLoadingId && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Confirmer le refus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================
// TAB 3 : DOLÉANCES REÇUES
// ============================================================
function ManagerReportsTab({ structureId }: { structureId: string }) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [statusDialog, setStatusDialog] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'review' | 'reject' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const STATUS_LABELS: Record<string, string> = {
    draft: 'Brouillon',
    submitted: 'Soumise',
    received: 'Reçue',
    forwarded: 'Transmise',
    reviewed: 'Examinée',
    archived: 'Archivée',
    rejected: 'Rejetée',
  };

  const loadData = async () => {
    if (!profile?.id) return;

    try {
      setLoading(true);

      const { data: r, error } = await supabase
        .from('reports')
        .select(`
          id,
          title,
          description,
          status,
          submitted_at,
          created_at,
          employee_id,
          employees!reports_employee_id_fkey(
            first_name,
            last_name
          ),
          report_types (
            id,
            name
          )
        `)
        .or(`recipient_id.eq.${profile.id},recipient_employee_id.eq.${profile.id}`)
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
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de charger les doléances.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile?.id, structureId]);

  const handleUpdateStatus = async () => {
    if (!selectedReportId || !actionType) return;

    try {
      setActionLoading(true);
      const newStatus = actionType === 'review' ? 'reviewed' : 'rejected';

      const { error } = await supabase
        .from('reports')
        .update({ status: newStatus })
        .eq('id', selectedReportId);

      if (error) throw error;

      toast({
        title: 'Statut mis à jour',
        description: `La doléance a été marquée comme : ${newStatus === 'reviewed' ? 'Examinée' : 'Rejetée'}.`,
      });
      setStatusDialog(false);
      loadData();
    } catch (err: any) {
      console.error('Erreur mise à jour doléance:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de mettre à jour le statut.',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getReportStatusBadge = (status: string) => {
    switch (status) {
      case 'reviewed':
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Examinée
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="h-3 w-3 mr-1" /> Rejetée
          </Badge>
        );
      case 'submitted':
      case 'received':
      case 'forwarded':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" /> {STATUS_LABELS[status] || status}
          </Badge>
        );
      default:
        return <Badge variant="outline">{STATUS_LABELS[status] || status}</Badge>;
    }
  };

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const empName = `${r.employees?.first_name || ''} ${r.employees?.last_name || ''}`.toLowerCase();
        const searchLow = search.toLowerCase();
        const titleMatch = (r.title || '').toLowerCase().includes(searchLow);
        const descMatch = (r.description || '').toLowerCase().includes(searchLow);
        const empMatch = empName.includes(searchLow);
        if (!titleMatch && !descMatch && !empMatch) return false;
      }
      return true;
    });
  }, [reports, search, statusFilter]);

  const pendingCount = reports.filter((r) =>
    ['submitted', 'received', 'forwarded'].includes(r.status)
  ).length;

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-bold font-display">
              Doléances et Requêtes reçues
            </CardTitle>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white font-bold text-[11px] px-2 py-0.5">
                {pendingCount} en attente
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Consultez et traitez les requêtes et doléances soumises par vos collaborateurs.
          </CardDescription>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs">
            <SelectValue placeholder="Filtrer par statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les doléances</SelectItem>
            <SelectItem value="submitted">Soumises</SelectItem>
            <SelectItem value="reviewed">Examinées</SelectItem>
            <SelectItem value="rejected">Rejetées</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="pt-5 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par titre, nom de collaborateur, contenu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement des doléances...</span>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 rounded-xl border border-dashed border-border/70 p-6">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Aucune doléance trouvée</p>
            <p className="text-xs text-muted-foreground mt-1">
              {search || statusFilter !== 'all'
                ? 'Aucun résultat ne correspond à vos filtres.'
                : 'Aucune doléance n’a été soumise pour le moment.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((r) => {
              const empFullName = r.employees
                ? `${r.employees.first_name} ${r.employees.last_name}`
                : 'Collaborateur inconnu';
              const dateFmt = r.submitted_at || r.created_at
                ? format(parseISO(r.submitted_at || r.created_at), 'd MMMM yyyy à HH:mm', { locale: fr })
                : null;
              const canAct = ['submitted', 'received', 'forwarded'].includes(r.status);

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-sm hover:border-primary/30 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-base text-foreground tracking-tight flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        {r.title}
                      </h4>
                      {getReportStatusBadge(r.status)}
                      <Badge variant="outline" className="text-xs font-normal">
                        {r.report_types?.name || 'Type non défini'}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <User className="h-3.5 w-3.5 text-primary" />
                        <span>De : <strong>{empFullName}</strong></span>
                        {dateFmt && <span className="text-muted-foreground font-normal ml-2">• Reçue le {dateFmt}</span>}
                      </p>

                      {r.description && (
                        <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50 leading-relaxed max-w-3xl">
                          {r.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {canAct && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
                        onClick={() => {
                          setSelectedReportId(r.id);
                          setActionType('reject');
                          setStatusDialog(true);
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Rejeter
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                        onClick={() => {
                          setSelectedReportId(r.id);
                          setActionType('review');
                          setStatusDialog(true);
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Examiner
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Mise à jour du statut de la doléance</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Êtes-vous sûr de vouloir marquer cette doléance comme{' '}
              <strong className="text-foreground">
                {actionType === 'review' ? '« Examinée »' : '« Rejetée »'}
              </strong>{' '}
              ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-3">
            <Button variant="outline" size="sm" onClick={() => setStatusDialog(false)} disabled={actionLoading}>
              Annuler
            </Button>
            <Button
              variant={actionType === 'reject' ? 'destructive' : 'default'}
              size="sm"
              onClick={handleUpdateStatus}
              disabled={actionLoading}
            >
              {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================
// TAB 4 : TYPES DE DOLÉANCES / RAPPORTS
// ============================================================
function ManagerReportTypesTab({ structureId }: { structureId: string }) {
  const { toast } = useToast();

  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadData = async () => {
    if (!structureId) return;

    try {
      setLoading(true);

      const { data: rt, error } = await supabase
        .from('report_types')
        .select('id, name, structure_id, is_active, created_at')
        .or(`structure_id.is.null,structure_id.eq.${structureId}`)
        .order('name', { ascending: true });

      if (error) throw error;
      setTypes(rt || []);
    } catch (err: any) {
      console.error('Erreur chargement types rapports:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de charger les types de doléances.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [structureId]);

  const handleCreate = async () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;

    const exists = types.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast({
        title: 'Type déjà existant',
        description: 'Un type portant ce nom est déjà enregistré pour cette structure.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);

      const { error } = await supabase.from('report_types').insert({
        name: trimmed,
        structure_id: structureId,
        is_active: true,
      });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: 'Nom dupliqué',
            description: 'Ce nom existe déjà dans votre structure.',
            variant: 'destructive',
          });
          return;
        }
        throw error;
      }

      toast({
        title: 'Type créé',
        description: `Le type "${trimmed}" est maintenant disponible pour vos collaborateurs.`,
      });

      setNewTypeName('');
      loadData();
    } catch (err: any) {
      console.error('Erreur création type:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de créer ce type de doléance.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    try {
      setActionLoadingId(id);

      const { error } = await supabase
        .from('report_types')
        .update({ is_active: !current })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: !current ? 'Type activé' : 'Type désactivé',
        description: !current
          ? 'Ce format est de nouveau sélectionnable par les collaborateurs.'
          : 'Ce format ne sera plus proposé pour les nouvelles doléances.',
      });

      loadData();
    } catch (err: any) {
      console.error('Erreur modification type:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de modifier le statut.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-bold font-display">
          Types de Doléances et Rapports
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground mt-0.5">
          Gérez les catégories de requêtes et rapports personnalisées mises à disposition des collaborateurs de Magistère.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {/* Add new type field */}
        <div className="flex flex-col sm:flex-row gap-2 max-w-md">
          <Input
            placeholder="Nouveau type (ex: Demande de matériel, Incident...)"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="text-xs h-9 flex-1"
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={submitting || !newTypeName.trim()}
            className="shrink-0 gap-1.5"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlusCircle className="h-3.5 w-3.5" />
            )}
            <span>Ajouter</span>
          </Button>
        </div>

        {/* List of Types */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Chargement des types...</span>
          </div>
        ) : types.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 rounded-xl border border-dashed border-border/70 p-6">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Aucun type configuré</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajoutez un premier type de doléance pour votre structure ci-dessus.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {types.map((t) => {
              const isGlobal = t.structure_id === null;

              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-border/80 bg-card p-3.5 flex items-center justify-between shadow-sm hover:border-primary/30 transition-all gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {t.name}
                        </span>
                        {isGlobal ? (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                            Global Système
                          </Badge>
                        ) : (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] py-0 px-1.5">
                            Magistère
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {isGlobal
                          ? 'Défini pour toutes les structures'
                          : 'Personnalisé pour votre structure'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      className={
                        t.is_active
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs'
                          : 'bg-muted text-muted-foreground text-xs'
                      }
                    >
                      {t.is_active ? 'Actif' : 'Inactif'}
                    </Badge>

                    {!isGlobal && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={actionLoadingId === t.id}
                        onClick={() => toggleActive(t.id, t.is_active)}
                        className="text-xs text-muted-foreground hover:text-foreground h-8"
                      >
                        {actionLoadingId === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        {t.is_active ? 'Désactiver' : 'Activer'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
