import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  UserPlus,
  UserCheck,
  UserX,
  Phone,
  Clock,
  Loader2,
  CheckCircle2,
  Search,
  Filter,
  ShieldCheck,
  Inbox,
  Briefcase,
} from 'lucide-react';

interface PendingCandidate {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  account_status: string;
  created_at: string;
  service_id: string | null;
  position_id: string | null;
  positions?: { id: string; name: string } | { id: string; name: string }[];
  services?: { id: string; name: string } | { id: string; name: string }[];
}

export function ManagerRegistrationsTab({
  structureId,
  onCountChange,
}: {
  structureId: string;
  onCountChange?: (count: number) => void;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [candidates, setCandidates] = useState<PendingCandidate[]>([]);
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Formulaire d'affectation optionnelle lors de la validation
  const [assignedPositions, setAssignedPositions] = useState<Record<string, string>>({});
  const [assignedServices, setAssignedServices] = useState<Record<string, string>>({});

  // Dialogue de rejet
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<PendingCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchCandidates = useCallback(async () => {
    if (!structureId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select(`
          id,
          first_name,
          last_name,
          phone,
          account_status,
          created_at,
          service_id,
          position_id,
          positions (id, name),
          services (id, name)
        `)
        .eq('structure_id', structureId)
        .eq('account_status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const list = (data || []) as unknown as PendingCandidate[];
      setCandidates(list);
      if (onCountChange) {
        onCountChange(list.length);
      }
    } catch (err: any) {
      console.error('Erreur chargement candidats:', err);
    } finally {
      setLoading(false);
    }
  }, [structureId, onCountChange]);

  const fetchMeta = useCallback(async () => {
    try {
      const [posRes, srvRes] = await Promise.all([
        supabase.from('positions').select('id, name').order('name'),
        supabase.from('services').select('id, name').eq('structure_id', structureId).order('name'),
      ]);

      if (posRes.data) setPositions(posRes.data);
      if (srvRes.data) setServices(srvRes.data);
    } catch (err) {
      console.error('Erreur métadonnées:', err);
    }
  }, [structureId]);

  useEffect(() => {
    fetchCandidates();
    fetchMeta();

    if (!structureId) return;

    const channel = supabase
      .channel(`mgr-reg-${structureId}-${Math.random().toString(36).substring(2, 9)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employees',
          filter: `structure_id=eq.${structureId}`,
        },
        () => {
          fetchCandidates();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [structureId, fetchCandidates, fetchMeta]);

  const handleApprove = async (candidate: PendingCandidate) => {
    try {
      setActionLoadingId(candidate.id);
      const selectedPos = assignedPositions[candidate.id] || candidate.position_id || undefined;
      const selectedSrv = assignedServices[candidate.id] || candidate.service_id || undefined;

      const { error: rpcError } = await supabase.rpc('approve_registration', {
        p_employee_id: candidate.id,
        p_position_id: selectedPos,
        p_service_id: selectedSrv,
      });

      if (rpcError) {
        console.warn('RPC approve_registration fallback direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('employees')
          .update({
            account_status: 'active',
            is_active: true,
            position_id: selectedPos,
            service_id: selectedSrv,
            approved_by: profile?.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', candidate.id);

        if (updateError) throw updateError;

        // Notification de validation pour le nouvel employé (Direction Manager -> Employé)
        await supabase.from('notifications').insert({
          recipient_employee_id: candidate.id,
          type: 'registration_approved',
          title: 'Inscription validée !',
          message: 'Votre compte a été activé par votre responsable. Vous pouvez dès à présent utiliser toutes les fonctionnalités.',
          entity_type: 'employee',
          entity_id: candidate.id,
        });
      }

      toast({
        title: 'Inscription validée avec succès !',
        description: `${candidate.first_name} ${candidate.last_name} a été activé(e) et notifié(e).`,
      });

      fetchCandidates();
    } catch (err: any) {
      console.error('Erreur validation:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de valider l’inscription.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async () => {
    if (!selectedCandidate) return;
    try {
      setActionLoadingId(selectedCandidate.id);
      const reason = rejectReason.trim() || 'Inscription refusée par le responsable.';

      const { error: rpcError } = await supabase.rpc('reject_registration', {
        p_employee_id: selectedCandidate.id,
        p_reason: reason,
      });

      if (rpcError) {
        console.warn('RPC reject_registration fallback direct update:', rpcError);
        const { error: updateError } = await supabase
          .from('employees')
          .update({
            account_status: 'rejected',
            is_active: false,
            rejection_reason: reason,
          })
          .eq('id', selectedCandidate.id);

        if (updateError) throw updateError;

        await supabase.from('notifications').insert({
          recipient_employee_id: selectedCandidate.id,
          type: 'registration_rejected',
          title: 'Inscription refusée',
          message: `Votre demande d'inscription a été refusée : ${reason}`,
          entity_type: 'employee',
          entity_id: selectedCandidate.id,
        });
      }

      toast({
        title: 'Inscription rejetée',
        description: 'La décision a été transmise à l’utilisateur.',
      });

      setRejectDialogOpen(false);
      setSelectedCandidate(null);
      setRejectReason('');
      fetchCandidates();
    } catch (err: any) {
      console.error('Erreur rejet:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de refuser l’inscription.',
        variant: 'destructive',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const phone = c.phone?.toLowerCase() || '';
    return fullName.includes(q) || phone.includes(q);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <span>Demandes d'inscription en attente</span>
            {candidates.length > 0 && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold border-amber-500/20">
                {candidates.length} nouveau{candidates.length > 1 ? 'x' : ''}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Examinez les demandes d'inscription au sein de votre structure, confirmez l'affectation et activez l'accès.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom ou tél..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-xs h-9 bg-card"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
          <p className="text-xs">Chargement des demandes...</p>
        </div>
      ) : filteredCandidates.length === 0 ? (
        <Card className="border-dashed border-border/80">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h4 className="font-semibold text-base text-foreground">
              {candidates.length === 0
                ? 'Toutes les inscriptions sont à jour !'
                : 'Aucune inscription ne correspond à votre recherche.'}
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              {candidates.length === 0
                ? 'Dès qu’un nouvel employé s’enregistre pour votre structure, sa fiche s’affichera ici avec une notification instantanée.'
                : 'Modifiez vos critères de recherche.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredCandidates.map((c) => {
            const isOperating = actionLoadingId === c.id;
            const currentPosName = Array.isArray(c.positions) ? c.positions[0]?.name : c.positions?.name;
            const currentSrvName = Array.isArray(c.services) ? c.services[0]?.name : c.services?.name;

            return (
              <Card
                key={c.id}
                className="border-border/80 bg-card hover:border-primary/40 transition-all shadow-xs overflow-hidden"
              >
                <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center ring-2 ring-primary/20">
                        {c.first_name[0]}
                        {c.last_name[0]}
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold text-foreground">
                          {c.first_name} {c.last_name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Clock className="h-3 w-3" />
                          <span>
                            Inscrit{' '}
                            {c.created_at
                              ? formatDistanceToNow(parseISO(c.created_at), { addSuffix: true, locale: fr })
                              : 'récemment'}
                          </span>
                        </p>
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[11px] font-semibold"
                    >
                      En attente
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  {/* Coordonnées */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50">
                      <span className="text-[10px] text-muted-foreground block font-medium">
                        Numéro de téléphone
                      </span>
                      <span className="font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                        <Phone className="h-3 w-3 text-primary" />
                        {c.phone || 'Non renseigné'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50">
                      <span className="text-[10px] text-muted-foreground block font-medium">
                        Rôle attribué
                      </span>
                      <span className="font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                        <Briefcase className="h-3 w-3 text-primary" />
                        Employé
                      </span>
                    </div>
                  </div>

                  {/* Affectation Poste & Service (Optionnel avant validation) */}
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px] text-muted-foreground font-medium">
                          Poste / Fonction
                        </Label>
                        <Select
                          value={assignedPositions[c.id] || c.position_id || ''}
                          onValueChange={(val) =>
                            setAssignedPositions((prev) => ({ ...prev, [c.id]: val }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs mt-1 bg-background">
                            <SelectValue placeholder={currentPosName || 'Sélectionner un poste'} />
                          </SelectTrigger>
                          <SelectContent>
                            {positions.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {services.length > 0 && (
                        <div>
                          <Label className="text-[11px] text-muted-foreground font-medium">
                            Service de rattachement
                          </Label>
                          <Select
                            value={assignedServices[c.id] || c.service_id || ''}
                            onValueChange={(val) =>
                              setAssignedServices((prev) => ({ ...prev, [c.id]: val }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs mt-1 bg-background">
                              <SelectValue placeholder={currentSrvName || 'Sélectionner un service'} />
                            </SelectTrigger>
                            <SelectContent>
                              {services.map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-xs">
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Boutons d'action */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                    <Button
                      size="sm"
                      disabled={isOperating}
                      onClick={() => handleApprove(c)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 font-medium shadow-xs"
                    >
                      {isOperating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : (
                        <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Valider et activer l'accès
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isOperating}
                      onClick={() => {
                        setSelectedCandidate(c);
                        setRejectReason('');
                        setRejectDialogOpen(true);
                      }}
                      className="text-xs h-9 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30"
                    >
                      <UserX className="h-3.5 w-3.5 mr-1.5" />
                      Refuser
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialogue de Refus */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <UserX className="h-5 w-5" />
              <span>Refuser l'inscription</span>
            </DialogTitle>
            <DialogDescription>
              Vous allez refuser la demande d'inscription de{' '}
              <strong>
                {selectedCandidate?.first_name} {selectedCandidate?.last_name}
              </strong>
              . Le candidat sera informé du motif et ne pourra pas accéder à la structure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-xs font-medium text-foreground">
              Motif du refus (visible par le candidat) :
            </Label>
            <Textarea
              placeholder="Ex : Profil ou matricule non valide pour notre structure..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoadingId === selectedCandidate?.id}
              onClick={handleReject}
            >
              {actionLoadingId === selectedCandidate?.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Confirmer le refus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
