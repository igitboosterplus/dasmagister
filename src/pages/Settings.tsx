import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
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

import { useToast } from '@/hooks/use-toast';

import {
  Settings as SettingsIcon,
  Plus,
  Loader2,
  Building2,
  BriefcaseBusiness,
  RefreshCw,
} from 'lucide-react';

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
  const [submitting, setSubmitting] = useState(false);

  const [isAddingStructure, setIsAddingStructure] = useState(false);
  const [isAddingPosition, setIsAddingPosition] = useState(false);

  const [structures, setStructures] = useState<Structure[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const [newStructure, setNewStructure] = useState({
    name: '',
    code: '',
  });

  const [newPosition, setNewPosition] = useState('');

  /**
   * Chargement des paramètres globaux
   */
  const fetchSettings = async () => {
    setLoading(true);

    try {
      const [structuresResult, positionsResult] = await Promise.all([
        supabase
          .from('structures')
          .select('id, name, code')
          .order('name', { ascending: true }),

        supabase
          .from('positions')
          .select('id, name')
          .order('name', { ascending: true }),
      ]);

      if (structuresResult.error) {
        throw structuresResult.error;
      }

      if (positionsResult.error) {
        throw positionsResult.error;
      }

      setStructures(structuresResult.data ?? []);
      setPositions(positionsResult.data ?? []);
    } catch (error) {
      console.error('Erreur chargement paramètres:', error);

      toast({
        title: 'Erreur',
        description:
          'Impossible de charger les paramètres du système.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  /**
   * Ajout d'une structure
   */
  const handleAddStructure = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const name = newStructure.name.trim();
    const code = newStructure.code.trim().toUpperCase();

    if (!name || !code) {
      toast({
        title: 'Champs requis',
        description: 'Le nom et le code de la structure sont obligatoires.',
        variant: 'destructive',
      });

      return;
    }

    setSubmitting(true);

    try {
      /**
       * Vérification du code avant insertion
       */
      const { data: existingStructure, error: checkError } = await supabase
        .from('structures')
        .select('id')
        .eq('code', code)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }

      if (existingStructure) {
        toast({
          title: 'Structure déjà existante',
          description: `Le code "${code}" est déjà utilisé.`,
          variant: 'destructive',
        });

        return;
      }

      const { error } = await supabase
        .from('structures')
        .insert({
          name,
          code,
        });

      if (error) {
        throw error;
      }

      toast({
        title: 'Structure créée',
        description: `La structure "${name}" a été ajoutée avec succès.`,
      });

      setNewStructure({
        name: '',
        code: '',
      });

      setIsAddingStructure(false);

      await fetchSettings();
    } catch (error) {
      console.error('Erreur ajout structure:', error);

      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible de créer la structure.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Ajout d'un poste
   */
  const handleAddPosition = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const name = newPosition.trim();

    if (!name) {
      toast({
        title: 'Champ requis',
        description: 'Le nom du poste est obligatoire.',
        variant: 'destructive',
      });

      return;
    }

    setSubmitting(true);

    try {
      /**
       * Vérification des doublons
       */
      const { data: existingPosition, error: checkError } = await supabase
        .from('positions')
        .select('id')
        .ilike('name', name)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }

      if (existingPosition) {
        toast({
          title: 'Poste déjà existant',
          description: `Le poste "${name}" existe déjà.`,
          variant: 'destructive',
        });

        return;
      }

      const { error } = await supabase
        .from('positions')
        .insert({
          name,
        });

      if (error) {
        throw error;
      }

      toast({
        title: 'Poste créé',
        description: `Le poste "${name}" a été ajouté avec succès.`,
      });

      setNewPosition('');
      setIsAddingPosition(false);

      await fetchSettings();
    } catch (error) {
      console.error('Erreur ajout poste:', error);

      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible de créer le poste.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Etat de chargement
   */
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
      <div className="animate-fade-in max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <SettingsIcon className="h-6 w-6" />
              Paramètres du système
            </h1>

            <p className="text-sm text-muted-foreground mt-1">
              Configurez les structures et les postes disponibles dans
              l'application.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchSettings}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ============================================================
              STRUCTURES
          ============================================================ */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />

                <div>
                  <CardTitle className="text-lg">
                    Structures
                  </CardTitle>

                  <p className="text-xs text-muted-foreground mt-1">
                    {structures.length}{' '}
                    {structures.length > 1
                      ? 'structures configurées'
                      : 'structure configurée'}
                  </p>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setIsAddingStructure((previous) => !previous)
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </CardHeader>

            <CardContent>
              {isAddingStructure && (
                <form
                  onSubmit={handleAddStructure}
                  className="mb-5 rounded-lg border bg-muted/30 p-4 space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="structure-name">
                      Nom de la structure
                    </Label>

                    <Input
                      id="structure-name"
                      placeholder="Ex. Direction Générale"
                      value={newStructure.name}
                      onChange={(event) =>
                        setNewStructure((previous) => ({
                          ...previous,
                          name: event.target.value,
                        }))
                      }
                      disabled={submitting}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="structure-code">
                      Code de la structure
                    </Label>

                    <Input
                      id="structure-code"
                      placeholder="Ex. DG"
                      value={newStructure.code}
                      onChange={(event) =>
                        setNewStructure((previous) => ({
                          ...previous,
                          code: event.target.value,
                        }))
                      }
                      disabled={submitting}
                      required
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="flex-1"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enregistrement...
                        </>
                      ) : (
                        'Enregistrer'
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => {
                        setIsAddingStructure(false);
                        setNewStructure({
                          name: '',
                          code: '',
                        });
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </form>
              )}

              {structures.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Aucune structure configurée.
                </div>
              ) : (
                <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
                  {structures.map((structure) => (
                    <li
                      key={structure.id}
                      className="p-3 border rounded-md flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="font-medium truncate">
                        {structure.name}
                      </span>

                      <span className="shrink-0 text-xs px-2 py-1 bg-muted rounded">
                        {structure.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ============================================================
              POSTES
          ============================================================ */}
          <Card className="stat-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-5 w-5 text-primary" />

                <div>
                  <CardTitle className="text-lg">
                    Postes
                  </CardTitle>

                  <p className="text-xs text-muted-foreground mt-1">
                    {positions.length}{' '}
                    {positions.length > 1
                      ? 'postes configurés'
                      : 'poste configuré'}
                  </p>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setIsAddingPosition((previous) => !previous)
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter
              </Button>
            </CardHeader>

            <CardContent>
              {isAddingPosition && (
                <form
                  onSubmit={handleAddPosition}
                  className="mb-5 rounded-lg border bg-muted/30 p-4 space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="position-name">
                      Nom du poste
                    </Label>

                    <Input
                      id="position-name"
                      placeholder="Ex. Responsable RH"
                      value={newPosition}
                      onChange={(event) =>
                        setNewPosition(event.target.value)
                      }
                      disabled={submitting}
                      required
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="flex-1"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enregistrement...
                        </>
                      ) : (
                        'Enregistrer'
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => {
                        setIsAddingPosition(false);
                        setNewPosition('');
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </form>
              )}

              {positions.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Aucun poste configuré.
                </div>
              ) : (
                <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
                  {positions.map((position) => (
                    <li
                      key={position.id}
                      className="p-3 border rounded-md text-sm font-medium"
                    >
                      {position.name}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

