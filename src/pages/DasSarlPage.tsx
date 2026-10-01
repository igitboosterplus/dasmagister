import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { DasSarlManagerFeatures } from '@/components/DasSarl/DasSarlManagerFeatures';
import { DasSarlEmployeeFeatures } from '@/components/DasSarl/DasSarlEmployeeFeatures';

export default function DasSarlPage() {
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
                    <h1 className="page-title">Espace Das-Sarl</h1>
                    <p className="text-muted-foreground mt-1">
                        Gérez vos missions, absences et configurations spécifiques.
                    </p>
                </div>

                {role === 'manager' || role === 'admin' ? (
                    <DasSarlManagerFeatures structureId={profile.structure_id} />
                ) : (
                    <DasSarlEmployeeFeatures employeeId={profile.id} structureId={profile.structure_id} />
                )}
            </div>
        </DashboardLayout>
    );
}
