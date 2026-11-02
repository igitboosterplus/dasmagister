import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { MagistereManagerFeatures } from '@/components/Magistere/MagistereManagerFeatures';
import { MagistereEmployeeFeatures } from '@/components/Magistere/MagistereEmployeeFeatures';
import { Badge } from '@/components/ui/badge';
import { Building2, Sparkles, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function MagisterePage() {
  const { profile, role, isRhManager } = useAuth();
  const [structureName, setStructureName] = useState<string>('Magistère');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const fetchStructure = async () => {
      if (!profile?.structure_id) return;
      try {
        const { data } = await supabase
          .from('structures')
          .select('name')
          .eq('id', profile.structure_id)
          .single();
        if (data?.name) {
          setStructureName(data.name);
        }
      } catch (e) {
        // Fallback default name
      }
    };
    fetchStructure();
  }, [profile?.structure_id]);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  };

  if (!profile?.structure_id) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground animate-fade-in">
          <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm font-medium">Chargement de l'espace Magistère...</p>
        </div>
      </DashboardLayout>
    );
  }

  const isManager = role === 'manager' || role === 'admin' || isRhManager;

  return (
    <DashboardLayout>
      <div className="animate-fade-in space-y-6 pb-12" key={refreshKey}>
        {/* Modern Magistère Hero Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/[0.04] p-5 sm:p-7 shadow-sm">
          {/* Subtle decorative glow */}
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
          <div className="absolute -left-12 -bottom-12 h-44 w-44 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground shadow-xs">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{structureName.toUpperCase()}</span>
                </span>

                <Badge
                  variant="outline"
                  className="bg-primary/5 text-primary border-primary/20 font-semibold text-xs py-0.5"
                >
                  <Sparkles className="h-3 w-3 mr-1 text-primary" />
                  {isRhManager
                    ? 'Portail Responsable RH & Gestion'
                    : isManager
                    ? 'Portail Responsable & Gestion'
                    : 'Portail Collaborateur & Terrain'}
                </Badge>

                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Synchronisation active
                </span>
              </div>

              <div>
                <h1 className="page-title text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Espace {structureName}
                </h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                  {isManager
                    ? 'Coordination opérationnelle de Magistère : suivi des missions terrain, gestion des absences, traitement des doléances et validation des inscriptions.'
                    : 'Gérez vos missions assignées, déclarez vos disponibilités ou absences et déposez vos requêtes auprès du responsable de votre site.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start md:self-center shrink-0">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Actualiser les données"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border/80 bg-card hover:bg-muted text-xs font-semibold text-foreground transition-all shadow-xs hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-primary' : ''}`} />
                <span>Actualiser</span>
              </button>
            </div>
          </div>
        </div>

        {/* Feature Component by Role */}
        {isManager ? (
          <MagistereManagerFeatures structureId={profile.structure_id} />
        ) : (
          <MagistereEmployeeFeatures
            employeeId={profile.id}
            structureId={profile.structure_id}
          />
        )}
      </div>
    </DashboardLayout>
  );
}