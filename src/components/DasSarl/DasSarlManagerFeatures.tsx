import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Search, FileText, CalendarDays, MapPin } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function DasSarlManagerFeatures({ structureId }: { structureId: string }) {
    // We'll manage state here for the 3 tabs: Missions, Absences, Report Types.

    return (
        <div className="mt-12">
            <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary">DAS-SARL</Badge>
                    Fonctionnalités Spécifiques
                </h2>
                <p className="text-muted-foreground">
                    Ces outils sont dédiés exclusivement à la coordination interne de Das-Sarl.
                </p>
            </div>

            <Tabs defaultValue="missions" className="w-full">
                <TabsList className="grid grid-cols-3 mb-8 w-[400px]">
                    <TabsTrigger value="missions">Missions</TabsTrigger>
                    <TabsTrigger value="absences">Demandes d'absence</TabsTrigger>
                    <TabsTrigger value="reports">Types de rapports</TabsTrigger>
                </TabsList>

                <TabsContent value="missions">
                    <ManagerMissionsTab structureId={structureId} />
                </TabsContent>

                <TabsContent value="absences">
                    <ManagerAbsencesTab structureId={structureId} />
                </TabsContent>

                <TabsContent value="reports">
                    <ManagerReportTypesTab structureId={structureId} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function ManagerMissionsTab({ structureId }: { structureId: string }) {
    const [missions, setMissions] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        location: '',
        employee_id: '',
        planned_start: '',
        planned_end: ''
    });

    const loadData = async () => {
        // Les employés de cette structure pour l'assignation
        const { data: emps } = await supabase.from('employees').select('id, first_name, last_name').eq('structure_id', structureId).eq('is_active', true);
        if (emps) setEmployees(emps);

        // Les missions
        const { data: m, error } = await supabase.from('missions').select(`*, employees!missions_employee_id_fkey(first_name, last_name)`).eq('structure_id', structureId).order('planned_start', { ascending: false });
        if (!error && m) setMissions(m);
    };

    useEffect(() => { loadData(); }, []);

    const handleCreate = async () => {
        if (!formData.title || !formData.employee_id || !formData.planned_start) return;
        setLoading(true);

        // Le status par defaut est 'assigned' (cf sql)
        const { error } = await supabase.from('missions').insert([{
            structure_id: structureId,
            employee_id: formData.employee_id,
            title: formData.title,
            description: formData.description,
            location: formData.location,
            planned_start: new Date(formData.planned_start).toISOString(),
            planned_end: formData.planned_end ? new Date(formData.planned_end).toISOString() : null,
        }]);

        setLoading(false);
        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Mission créée avec succès' });
            setOpen(false);
            loadData();
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Gestion des Missions</CardTitle>
                    <CardDescription>Planifiez et suivez les missions de vos collaborateurs.</CardDescription>
                </div>
                <Button onClick={() => setOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Nouvelle Mission</Button>
            </CardHeader>
            <CardContent>
                {missions.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">Aucune mission trouvée</div>
                ) : (
                    <div className="space-y-4">
                        {missions.map(m => (
                            <div key={m.id} className="border p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-medium text-lg flex items-center gap-2">
                                        {m.title}
                                        <Badge variant={m.status === 'completed' ? 'default' : m.status === 'in_progress' ? 'secondary' : 'outline'}>
                                            {m.status === 'completed' ? 'Terminée' : m.status === 'in_progress' ? 'En cours' : 'Assignée'}
                                        </Badge>
                                    </h4>
                                    <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-4">
                                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.location || 'Non précisé'}</span>
                                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />
                                            {new Date(m.planned_start).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                        <span>Assigné à: <strong className="text-foreground">{m.employees?.first_name} {m.employees?.last_name}</strong></span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Créer une nouvelle mission</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Titre</Label>
                            <Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Ex: Livraison Client A" />
                        </div>
                        <div className="space-y-2">
                            <Label>Employé</Label>
                            <Select onValueChange={v => setFormData({ ...formData, employee_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Sélectionner un employé" /></SelectTrigger>
                                <SelectContent>
                                    {employees.map(e => (
                                        <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Lieu</Label>
                            <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Début prévu</Label>
                                <Input type="datetime-local" value={formData.planned_start} onChange={e => setFormData({ ...formData, planned_start: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Fin prévue (optionnel)</Label>
                                <Input type="datetime-local" value={formData.planned_end} onChange={e => setFormData({ ...formData, planned_end: e.target.value })} />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                        <Button onClick={handleCreate} disabled={loading || !formData.title || !formData.employee_id || !formData.planned_start}>Créer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function ManagerAbsencesTab({ structureId }: { structureId: string }) {
    const [absences, setAbsences] = useState<any[]>([]);
    const { toast } = useToast();
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectId, setRejectId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const loadData = async () => {
        // Les employés de cette structure pour l'assignation
        const { data: m, error } = await supabase.from('employee_absences')
            .select(`*, employees!employee_absences_employee_id_fkey(first_name, last_name)`)
            .eq('structure_id', structureId)
            .order('created_at', { ascending: false });
        if (!error && m) setAbsences(m);
    };

    useEffect(() => { loadData(); }, []);

    const handleApprove = async (id: string) => {
        const { error } = await supabase.rpc('approve_absence', { p_absence_id: id });
        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Absence approuvée' });
            loadData();
        }
    };

    const openRejectDialog = (id: string) => {
        setRejectId(id);
        setRejectReason('');
        setRejectDialogOpen(true);
    };

    const confirmReject = async () => {
        if (!rejectId || !rejectReason.trim()) {
            toast({ title: 'Erreur', description: 'Veuillez saisir un motif.', variant: 'destructive' });
            return;
        }

        const { error } = await supabase.rpc('reject_absence', { p_absence_id: rejectId, p_reason: rejectReason });
        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Absence refusée' });
            setRejectDialogOpen(false);
            loadData();
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Demandes d'absence</CardTitle>
                <CardDescription>Validez ou refusez les indisponibilités.</CardDescription>
            </CardHeader>
            <CardContent>
                {absences.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">Aucune demande trouvée</div>
                ) : (
                    <div className="space-y-4">
                        {absences.map(a => (
                            <div key={a.id} className="border p-4 rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-medium text-lg flex items-center gap-2">
                                        {a.employees?.first_name} {a.employees?.last_name}
                                        <Badge variant={a.status === 'approved' ? 'default' : a.status === 'rejected' ? 'destructive' : 'secondary'}>
                                            {a.status.toUpperCase()}
                                        </Badge>
                                    </h4>
                                    <div className="text-sm text-muted-foreground mt-1">
                                        <div>Du: {new Date(a.start_date).toLocaleDateString()} Au: {new Date(a.end_date).toLocaleDateString()}</div>
                                        <div>Motif: <strong className="text-foreground">{a.reason}</strong> (Type: {a.type})</div>
                                        {a.rejection_reason && <div className="text-destructive mt-1">Refus: {a.rejection_reason}</div>}
                                    </div>
                                </div>
                                {a.status === 'pending' && (
                                    <div className="flex gap-2">
                                        <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => openRejectDialog(a.id)}>Refuser</Button>
                                        <Button onClick={() => handleApprove(a.id)}>Approuver</Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Motif du refus</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Label className="mb-2 block">Veuillez indiquer pourquoi vous refusez cette demande :</Label>
                        <Textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Saisissez votre motif ici..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Annuler</Button>
                        <Button variant="destructive" onClick={confirmReject}>Confirmer le refus</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function ManagerReportTypesTab({ structureId }: { structureId: string }) {
    const [types, setTypes] = useState<any[]>([]);
    const { toast } = useToast();
    const [newTypeName, setNewTypeName] = useState('');

    const loadData = async () => {
        // Récupérer les types "globaux" (structure_id is null) ET ceux propres à Das-Sarl
        const { data: rt, error } = await supabase.from('report_types')
            .select('*')
            .or(`structure_id.is.null,structure_id.eq.${structureId}`)
            .order('name', { ascending: true });
        if (!error && rt) setTypes(rt);
    };

    useEffect(() => { loadData(); }, []);

    const handleCreate = async () => {
        if (!newTypeName.trim()) return;
        const { error } = await supabase.from('report_types').insert({
            name: newTypeName.trim(),
            structure_id: structureId,
            is_active: true
        });
        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Type créé' });
            setNewTypeName('');
            loadData();
        }
    };

    const toggleActive = async (id: string, current: boolean) => {
        const { error } = await supabase.from('report_types').update({ is_active: !current }).eq('id', id);
        if (!error) loadData();
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Types de Rapports Spécifiques</CardTitle>
                <CardDescription>Gérez les formats de rapports disponibles pour vos collaborateurs.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-6 max-w-sm">
                    <Input placeholder="Nouveau type..." value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                    <Button onClick={handleCreate}>Ajouter</Button>
                </div>
                <div className="space-y-2">
                    {types.map(t => (
                        <div key={t.id} className="border p-4 rounded-lg flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium">{t.name}</span>
                                {t.structure_id === null && <Badge variant="outline">Global</Badge>}
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant={t.is_active ? 'default' : 'secondary'}>{t.is_active ? 'Actif' : 'Inactif'}</Badge>
                                {t.structure_id !== null && (
                                    <Button variant="ghost" size="sm" onClick={() => toggleActive(t.id, t.is_active)}>
                                        {t.is_active ? 'Désactiver' : 'Activer'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
