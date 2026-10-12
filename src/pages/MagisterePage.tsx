import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { MagistereManagerFeatures } from '@/components/Magistere/MagistereManagerFeatures';
import { MagistereEmployeeFeatures } from '@/components/Magistere/MagistereEmployeeFeatures';

export default function MagisterePage() {
    const { profile, role } = useAuth();

    if (!profile?.structure_id) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[400px]">
                    Chargement...
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="animate-fade-in">
                <div className="mb-6">
                    <h1 className="page-title">Espace Magistere</h1>
                    <p className="text-muted-foreground mt-1">
                        Consultez et soumettez vos doléances au responsable de votre site.
                    </p>
                </div>

                {role === 'manager' ? (
                    <MagistereManagerFeatures structureId={profile.structure_id} />
                ) : (
                    <MagistereEmployeeFeatures employeeId={profile.id} structureId={profile.structure_id} />
                )}
            </div>
        </DashboardLayout>
    );
}