import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Search, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function MagistereEmployeeFeatures({ employeeId, structureId }: { employeeId: string, structureId: string }) {
    const [reports, setReports] = useState<any[]>([]);
    const [reportTypes, setReportTypes] = useState<any[]>([]);
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    const [formData, setFormData] = useState({
        typeId: '',
        title: '',
        description: ''
    });

    const loadData = async () => {
        // Obtenir types
        const { data: types, error: typesError } = await supabase.from('report_types')
            .select('id, name')
            .order('name');
        if (!typesError && types) setReportTypes(types);

        // Obtenir doléances (rapports)
        const { data: r, error } = await supabase.from('reports')
            .select(`
                id,
                title,
                description,
                status,
                submitted_at,
                report_types (
                    id,
                    name
                )
            `)
            .or(`employee_id.eq.${employeeId},author_employee_id.eq.${employeeId}`)
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

    useEffect(() => { loadData(); }, [employeeId]);

    const handleCreate = async () => {
        if (!formData.typeId || !formData.title.trim() || !formData.description.trim()) {
            toast({ title: 'Information', description: 'Veuillez remplir tous les champs obligatoires.', variant: 'destructive' });
            return;
        }

        setLoading(true);
        const { data: reportId, error: reportError } = await supabase.rpc(
            'submit_report',
            {
                p_report_type_id: formData.typeId,
                p_title: formData.title.trim(),
                p_description: formData.description.trim()
            }
        );

        setLoading(false);

        if (reportError) {
            toast({ title: 'Erreur', description: reportError.message, variant: 'destructive' });
        } else {
            toast({ title: 'Succès', description: 'Votre doléance a été soumise avec succès au responsable.' });
            setOpen(false);
            setFormData({ typeId: '', title: '', description: '' });
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

    const filteredReports = reports.filter(r =>
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="mt-8 border-t pt-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary">MAGISTERE</Badge>
                    Mes Doléances
                </h2>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Rechercher..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                    <Button onClick={() => setOpen(true)} className="whitespace-nowrap">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Nouvelle Doléance
                    </Button>
                </div>
            </div>

            <div className="space-y-4">
                {filteredReports.length === 0 ? (
                    <div className="text-center text-muted-foreground p-8 bg-muted/20 rounded-lg">
                        Aucune doléance trouvée ou soumise.
                    </div>
                ) : (
                    filteredReports.map(r => (
                        <Card key={r.id} className="hover:shadow-md transition-shadow">
                            <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-lg flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        {r.title}
                                        <Badge variant={r.status === 'reviewed' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}>
                                            {STATUS_LABELS[r.status] || r.status}
                                        </Badge>
                                    </h4>
                                    <div className="text-sm text-foreground">
                                        <span className="font-medium mr-2">Type:</span>
                                        {r.report_types?.name || 'Non défini'}
                                    </div>
                                    <div className="text-sm text-muted-foreground max-w-2xl">
                                        {r.description}
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground whitespace-nowrap text-right">
                                    Soumis le : {new Date(r.submitted_at || r.created_at || Date.now()).toLocaleDateString()}
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
                        <DialogDescription>
                            Décrivez le sujet de votre doléance qui sera directement transmise au responsable de votre site.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Type de requête <span className="text-red-500">*</span></Label>
                            <Select value={formData.typeId} onValueChange={v => setFormData({ ...formData, typeId: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Sélectionnez un type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {reportTypes.map(t => (
                                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Titre <span className="text-red-500">*</span></Label>
                            <Input
                                placeholder="Sujet de votre doléance"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Description <span className="text-red-500">*</span></Label>
                            <Textarea
                                placeholder="Expliquez en détail..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="min-h-[120px]"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                        <Button onClick={handleCreate} disabled={loading || !formData.typeId || !formData.title || !formData.description}>
                            Soumettre
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
