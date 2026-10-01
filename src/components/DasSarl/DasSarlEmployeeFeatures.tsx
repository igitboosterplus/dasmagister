import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarDays, MapPin, CheckCircle2, PlayCircle, PlusCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function DasSarlEmployeeFeatures({ employeeId, structureId }: { employeeId: string, structureId: string }) {
    return (
        <div className="mt-8 border-t pt-8">
            <div className="mb-6">
                <h2 className="text-xl font-bold tracking-tight mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary">DAS-SARL</Badge>
                    Mon Espace Interne
                </h2>
            </div>

            <Tabs defaultValue="missions" className="w-full">
                <TabsList className="mb-6">
                    <TabsTrigger value="missions">Mes Missions</TabsTrigger>
                    <TabsTrigger value="absences">Mes Déclarations d'absence</TabsTrigger>
                </TabsList>

                <TabsContent value="missions">
                    <EmployeeMissionsTab employeeId={employeeId} />
                </TabsContent>

                <TabsContent value="absences">
                    <EmployeeAbsencesTab employeeId={employeeId} structureId={structureId} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

export function EmployeeMissionsTab({ employeeId }: { employeeId: string }) {
    const [missions, setMissions] = useState<any[]>([]);
    const { toast } = useToast();

    const loadData = async () => {
        const { data: m, error } = await supabase.from('missions')
            .select('*')
            .eq('employee_id', employeeId)
            .order('planned_start', { ascending: false });
        if (!error && m) setMissions(m);
    };

    useEffect(() => { loadData(); }, [employeeId]);

    const handleStart = async (id: string) => {
        if (!navigator.geolocation) {
            toast({ title: 'Erreur', description: 'Géolocalisation non supportée', variant: 'destructive' });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords;
                const { error } = await supabase.rpc('start_mission', { p_mission_id: id, p_lat: latitude, p_lon: longitude });
                if (error) {
                    toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
                } else {
                    toast({ title: 'Succès', description: 'Mission démarrée (Position enregistrée) !' });
                    loadData();
                }
            },
            (err) => {
                toast({ title: 'Erreur GPS', description: 'Localisation requise pour le pointage.', variant: 'destructive' });
            }
        );
    };

    const handleComplete = async (id: string) => {
        if (!navigator.geolocation) {
            toast({ title: 'Erreur', description: 'Géolocalisation non supportée', variant: 'destructive' });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords;
                const { error } = await supabase.rpc('complete_mission', { p_mission_id: id, p_lat: latitude, p_lon: longitude });
                if (error) {
                    toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
                } else {
                    toast({ title: 'Succès', description: 'Mission terminée (Position enregistrée) !' });
                    loadData();
                }
            },
            (err) => {
                toast({ title: 'Erreur GPS', description: 'Localisation requise pour le pointage.', variant: 'destructive' });
            }
        );
    };

    return (
        <div className="space-y-4">
            {missions.length === 0 ? (
                <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg">Aucune mission ne vous est assignée.</div>
            ) : (
                missions.map(m => (
                    <Card key={m.id}>
                        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <h4 className="font-medium text-lg flex items-center gap-2">
                                    {m.title}
                                    <Badge variant={m.status === 'completed' ? 'default' : m.status === 'in_progress' ? 'secondary' : 'outline'}>
                                        {m.status === 'completed' ? 'Terminée' : m.status === 'in_progress' ? 'En cours' : 'Assignée'}
                                    </Badge>
                                </h4>
                                <p className="text-sm text-muted-foreground mt-1 mb-2">{m.description}</p>
                                <div className="text-sm text-foreground flex flex-wrap gap-4">
                                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.location || 'Non précisé'}</span>
                                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />
                                        Prévu le : {new Date(m.planned_start).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                                    </span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                {m.status === 'assigned' && (
                                    <Button onClick={() => handleStart(m.id)}><PlayCircle className="mr-2 h-4 w-4" /> Démarrer</Button>
                                )}
                                {m.status === 'in_progress' && (
                                    <Button variant="default" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => handleComplete(m.id)}>
                                        <CheckCircle2 className="mr-2 h-4 w-4" /> Terminer
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

function EmployeeAbsencesTab({ employeeId, structureId }: { employeeId: string, structureId: string }) {
    const [absences, setAbsences] = useState<any[]>([]);
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        type: 'leave',
        start_date: '',
        end_date: '',
        reason: ''
    });

    const loadData = async () => {
        const { data: m, error } = await supabase.from('employee_absences')
            .select('*')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false });
        if (!error && m) setAbsences(m);
    };

    useEffect(() => { loadData(); }, [employeeId]);

    const handleCreate = async () => {
        if (!formData.start_date || !formData.end_date) return;
        setLoading(true);
        const { error } = await supabase.from('employee_absences').insert({
            employee_id: employeeId,
            structure_id: structureId,
            type: formData.type,
            start_date: formData.start_date,
            end_date: formData.end_date,
            reason: formData.reason,
            status: 'pending'
        });
        setLoading(false);

        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Demande envoyée' });
            setOpen(false);
            loadData();
        }
    };

    return (
        <>
            <div className="mb-4 flex justify-end">
                <Button onClick={() => setOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Nouvelle Demande</Button>
            </div>

            <div className="space-y-4">
                {absences.length === 0 ? (
                    <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg">Aucune demande d'absence effectuée.</div>
                ) : (
                    absences.map(a => (
                        <Card key={a.id}>
                            <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-4">
                                <div>
                                    <h4 className="font-medium flex items-center gap-2">
                                        {a.type.toUpperCase()}
                                        <Badge variant={a.status === 'approved' ? 'default' : a.status === 'rejected' ? 'destructive' : 'secondary'}>
                                            {a.status}
                                        </Badge>
                                    </h4>
                                    <div className="text-sm mt-1">Du: {new Date(a.start_date).toLocaleDateString()} Au: {new Date(a.end_date).toLocaleDateString()}</div>
                                    <div className="text-sm text-muted-foreground mt-1">Motif: {a.reason}</div>
                                    {a.rejection_reason && <div className="text-sm text-destructive mt-1">Refusé pour: {a.rejection_reason}</div>}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Déclarer une indisponibilité</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Type d'absence</Label>
                            <Select defaultValue={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="leave">Congé payé</SelectItem>
                                    <SelectItem value="sick">Maladie</SelectItem>
                                    <SelectItem value="mission">Mission externe</SelectItem>
                                    <SelectItem value="authorized_absence">Absence exceptionnelle</SelectItem>
                                    <SelectItem value="other">Autre</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Date de début</Label>
                                <Input type="date" value={formData.start_date} onChange={e => setFormData({ ...formData, start_date: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Date de fin</Label>
                                <Input type="date" value={formData.end_date} onChange={e => setFormData({ ...formData, end_date: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Motif</Label>
                            <Textarea value={formData.reason} onChange={e => setFormData({ ...formData, reason: e.target.value })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                        <Button onClick={handleCreate} disabled={loading || !formData.start_date || !formData.end_date}>Soumettre</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
