import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Search, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';

export function MagistereManagerFeatures({ structureId }: { structureId: string }) {
    const { profile } = useAuth();
    const [reports, setReports] = useState<any[]>([]);
    const { toast } = useToast();
    const [search, setSearch] = useState('');

    // Status management state
    const [statusDialog, setStatusDialog] = useState(false);
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    const [actionType, setActionType] = useState<'review' | 'reject' | null>(null);

    const loadData = async () => {
        if (!profile?.id) return;

        // Obtenir doléances (rapports) reçues par ce manager
        const { data: r, error } = await supabase.from('reports')
            .select(`
                id,
                title,
                description,
                status,
                submitted_at,
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

        if (!error && r) {
            const norm = r.map((item: any) => ({
                ...item,
                report_types: Array.isArray(item.report_types)
                    ? item.report_types[0] ?? null
                    : item.report_types ?? null,
            }));
            setReports(norm);
        }
    };

    useEffect(() => { loadData(); }, [profile?.id]);

    const handleUpdateStatus = async () => {
        if (!selectedReportId || !actionType) return;

        const newStatus = actionType === 'review' ? 'reviewed' : 'rejected';

        const { error } = await supabase.from('reports')
            .update({ status: newStatus })
            .eq('id', selectedReportId);

        if (error) {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: `La doléance a été marquée comme : ${newStatus === 'reviewed' ? 'Examinée' : 'Rejetée'}.` });
            setStatusDialog(false);
            loadData();
        }
    };

    const STATUS_LABELS: Record<string, string> = {
        draft: 'Brouillon',
        submitted: 'Soumis',
        received: 'Reçu',
        forwarded: 'Transmis',
        reviewed: 'Examiné',
        archived: 'Archivé',
        rejected: 'Rejeté',
    };

    const filteredReports = reports.filter(r => {
        const empName = `${r.employees?.first_name || ''} ${r.employees?.last_name || ''}`.toLowerCase();
        const searchLow = search.toLowerCase();
        return r.title.toLowerCase().includes(searchLow) ||
            (r.description && r.description.toLowerCase().includes(searchLow)) ||
            empName.includes(searchLow);
    });

    return (
        <div className="mt-8 border-t pt-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary">MAGISTERE</Badge>
                    Doléances reçues
                </h2>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Rechercher par titre, nom..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {filteredReports.length === 0 ? (
                    <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg">
                        Aucune doléance reçue.
                    </div>
                ) : (
                    filteredReports.map(r => (
                        <Card key={r.id} className="hover:shadow-md transition-shadow">
                            <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="space-y-2 flex-grow">
                                    <h4 className="font-medium text-lg flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        {r.title}
                                        <Badge variant={r.status === 'reviewed' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}>
                                            {STATUS_LABELS[r.status] || r.status}
                                        </Badge>
                                    </h4>
                                    <div className="text-sm text-foreground flex flex-wrap gap-4">
                                        <span>
                                            <span className="font-medium mr-1">Employé :</span>
                                            {r.employees?.first_name} {r.employees?.last_name}
                                        </span>
                                        <span>
                                            <span className="font-medium mr-1">Type :</span>
                                            {r.report_types?.name || 'Non défini'}
                                        </span>
                                    </div>
                                    <div className="text-sm text-muted-foreground max-w-2xl bg-muted/30 p-2 rounded-md">
                                        {r.description}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 items-end min-w-[150px]">
                                    <div className="text-xs text-muted-foreground mb-2">
                                        Reçu le : {new Date(r.submitted_at || Date.now()).toLocaleDateString()}
                                    </div>
                                    {(r.status === 'submitted' || r.status === 'received' || r.status === 'forwarded') && (
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => {
                                                    setSelectedReportId(r.id);
                                                    setActionType('reject');
                                                    setStatusDialog(true);
                                                }}
                                            >
                                                <XCircle className="h-4 w-4 mr-1" /> Rejeter
                                            </Button>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                                onClick={() => {
                                                    setSelectedReportId(r.id);
                                                    setActionType('review');
                                                    setStatusDialog(true);
                                                }}
                                            >
                                                <CheckCircle2 className="h-4 w-4 mr-1" /> Terminé
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Mise à jour du statut</DialogTitle>
                        <DialogDescription>
                            Êtes-vous sûr de vouloir marquer cette doléance comme {actionType === 'review' ? '« Examinée »' : '« Rejetée »'} ?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setStatusDialog(false)}>Annuler</Button>
                        <Button
                            variant={actionType === 'reject' ? 'destructive' : 'default'}
                            onClick={handleUpdateStatus}
                        >
                            Confirmer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
