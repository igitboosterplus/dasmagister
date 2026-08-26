import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Settings as SettingsIcon, Plus, Loader2 } from 'lucide-react';

interface Structure {
  id: string;
  name: string;
  code: string;
}

interface Position {
  id: string;
  name: string;
}

export default function Settings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isAddingStructure, setIsAddingStructure] = useState(false);
  const [isAddingPosition, setIsAddingPosition] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [structures, setStructures] = useState<Structure[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const [newStructure, setNewStructure] = useState({ name: '', code: '' });
  const [newPosition, setNewPosition] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const [structuresRes, positionsRes] = await Promise.all([
      supabase.from('structures').select('*').order('name'),
      supabase.from('positions').select('*').order('name'),
    ]);
    if (structuresRes.data) setStructures(structuresRes.data);
    if (positionsRes.data) setPositions(positionsRes.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from('structures').insert({ name: newStructure.name, code: newStructure.code });
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Succès', description: 'Structure ajoutée' });
      setIsAddingStructure(false);
      setNewStructure({ name: '', code: '' });
      fetchData();
    }
    setSubmitting(false);
  };

  const handleAddPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from('positions').insert({ name: newPosition });
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Succès', description: 'Poste ajouté' });
      setIsAddingPosition(false);
      setNewPosition('');
      fetchData();
    }
    setSubmitting(false);
  };

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
      <div className="animate-fade-in max-w-4xl">
        <h1 className="page-title mb-6 flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" />
          Paramètres du système
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Structures */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="text-lg">Structures</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setIsAddingStructure(!isAddingStructure)}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </CardHeader>
            <CardContent>
              {isAddingStructure && (
                <form onSubmit={handleAddStructure} className="mb-4 bg-muted/30 p-4 rounded-lg space-y-3">
                  <div>
                    <Label>Nom</Label>
                    <Input required value={newStructure.name} onChange={(e) => setNewStructure({ ...newStructure, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Code</Label>
                    <Input required value={newStructure.code} onChange={(e) => setNewStructure({ ...newStructure, code: e.target.value })} />
                  </div>
                  <Button type="submit" disabled={submitting} className="w-full">
                    Enregistrer
                  </Button>
                </form>
              )}
              
              <ul className="space-y-2">
                {structures.map((s) => (
                  <li key={s.id} className="p-3 border rounded-md flex justify-between items-center text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs px-2 py-1 bg-muted rounded">{s.code}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Positions */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="text-lg">Postes</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setIsAddingPosition(!isAddingPosition)}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </CardHeader>
            <CardContent>
              {isAddingPosition && (
                <form onSubmit={handleAddPosition} className="mb-4 bg-muted/30 p-4 rounded-lg space-y-3">
                  <div>
                    <Label>Nom du poste</Label>
                    <Input required value={newPosition} onChange={(e) => setNewPosition(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={submitting} className="w-full">
                    Enregistrer
                  </Button>
                </form>
              )}
              
              <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                {positions.map((p) => (
                  <li key={p.id} className="p-3 border rounded-md text-sm font-medium">
                    {p.name}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
