import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface DashboardStats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
}

export default function Dashadmin() {
  const { profile } = useAuth();

  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 0,
    presentToday: 0,
    lateToday: 0,
    absentToday: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);

        const today = new Date().toISOString().split('T')[0];

        const [employeesRes, attendanceRes] = await Promise.all([
          supabase
            .from('employees')
            .select('id')
            .eq('is_active', true),

          supabase
            .from('attendances')
            .select('id, employee_id, check_in, validation_status')
            .eq('attendance_date', today),
        ]);

        if (employeesRes.error) {
          console.error('Erreur employés:', employeesRes.error);
          return;
        }
        if (attendanceRes.error) {
          console.error('Erreur pointages:', attendanceRes.error);
          return;
        }

        const employees = employeesRes.data || [];
        const attendances = attendanceRes.data || [];

        // Dédupliquer par employé (garder le plus récent check_in)
        const seenEmployees = new Set<string>();
        let present = 0;
        let late = 0;

        for (const att of attendances) {
          if (!att.check_in) continue;
          if (seenEmployees.has(att.employee_id)) continue;
          seenEmployees.add(att.employee_id);
          present++;
          // La V3 remplit validation_status = 'late' côté serveur (clock_in RPC)
          if (att.validation_status === 'late') late++;
        }

        const absent = Math.max(employees.length - present, 0);

        setStats({
          totalEmployees: employees.length,
          presentToday: present,
          lateToday: late,
          absentToday: absent,
        });
      } catch (error) {
        console.error('Erreur chargement statistiques:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const statCards = [
    {
      label: 'Total Employés',
      value: stats.totalEmployees,
      icon: Users,
      color: 'text-primary',
    },
    {
      label: "Présents Aujourd'hui",
      value: stats.presentToday,
      icon: CheckCircle,
      color: 'text-success',
    },
    {
      label: 'En Retard',
      value: stats.lateToday,
      icon: Clock,
      color: 'text-warning',
    },
    {
      label: 'Absents',
      value: stats.absentToday,
      icon: AlertTriangle,
      color: 'text-destructive',
    },
  ];

  return (
    <DashboardLayout>
      <div className="animate-fade-in">

        {/* En-tête */}
        <div className="mb-8">
          <h1 className="page-title">
            Bonjour, {profile?.first_name} {profile?.last_name}
          </h1>

          <p className="text-muted-foreground mt-1">
            Voici le résumé de l'activité de votre entreprise aujourd'hui.
          </p>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat) => (
            <Card key={stat.label} className="stat-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>

                <stat.icon
                  className={`h-5 w-5 ${stat.color}`}
                />
              </CardHeader>

              <CardContent>
                {loading ? (
                  <div className="h-9 w-16 bg-muted animate-pulse rounded" />
                ) : (
                  <div className="text-3xl font-bold font-display">
                    {stat.value}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Résumé */}
        <Card className="stat-card">
          <CardHeader>
            <CardTitle className="text-lg">
              Résumé de la journée
            </CardTitle>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Taux de présence
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {stats.totalEmployees > 0
                      ? Math.round(
                        (stats.presentToday /
                          stats.totalEmployees) *
                        100
                      )
                      : 0}
                    %
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    Taux de retard
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {stats.presentToday > 0
                      ? Math.round(
                        (stats.lateToday /
                          stats.presentToday) *
                        100
                      )
                      : 0}
                    %
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    Taux d'absence
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {stats.totalEmployees > 0
                      ? Math.round(
                        (stats.absentToday /
                          stats.totalEmployees) *
                        100
                      )
                      : 0}
                    %
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}