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
  Building2,
  UserX,
} from 'lucide-react';



interface Stats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
}

interface Structure {
  id: string;
  name: string;
}


export default function DashboardManager() {
  const { role, profile } = useAuth();

  const [stats, setStats] = useState<Stats>({
    totalEmployees: 0,
    presentToday: 0,
    lateToday: 0,
    absentToday: 0,
  });

  const [structure, setStructure] =
    useState<Structure | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      /*
       * Le dashboard est exclusivement réservé au manager.
       */

      if (
        role !== 'manager' ||
        !profile?.structure_id
      ) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const structureId = profile.structure_id;

        /*
         * ======================================================
         * 1. RÉCUPÉRER LA STRUCTURE DU MANAGER
         * ======================================================
         */

        const structureRes = await supabase
          .from('structures')
          .select('id, name')
          .eq('id', structureId)
          .single();

        if (structureRes.error) {
          throw structureRes.error;
        }

        setStructure(structureRes.data);


        /*
         * ======================================================
         * 2. RÉCUPÉRER UNIQUEMENT LES EMPLOYÉS DE LA STRUCTURE
         * ======================================================
         *
         * Le filtre structure_id est volontairement présent
         * dans la requête.
         *
         * La RLS reste la véritable sécurité côté serveur.
         */

        const employeesRes = await supabase
          .from('employees')
          .select('id')
          .eq('structure_id', structureId)
          .eq('is_active', true);

        if (employeesRes.error) {
          throw employeesRes.error;
        }

        const employees =
          employeesRes.data || [];

        const employeeIds = employees.map(
          (employee) => employee.id
        );


        /*
         * ======================================================
         * 3. AUCUN EMPLOYÉ
         * ======================================================
         */

        if (employeeIds.length === 0) {
          setStats({
            totalEmployees: 0,
            presentToday: 0,
            lateToday: 0,
            absentToday: 0,
          });

          return;
        }


        /*
         * ======================================================
         * 4. POINTAGES DU JOUR
         * ======================================================
         */

        const today = new Date().toISOString().split('T')[0];

        const attendanceRes = await supabase
          .from('attendances')
          .select('id, employee_id, check_in, validation_status')
          .eq('attendance_date', today)
          .in('employee_id', employeeIds);

        if (attendanceRes.error) {
          throw attendanceRes.error;
        }

        const attendances = attendanceRes.data || [];


        /*
         * ======================================================
         * 5. CALCUL PRÉSENTS / RETARDS
         * ======================================================
         */

        let present = 0;
        let late = 0;

        const processedEmployees = new Set<string>();

        for (const attendance of attendances) {
          if (!attendance.check_in) continue;
          if (processedEmployees.has(attendance.employee_id)) continue;
          processedEmployees.add(attendance.employee_id);
          present++;
          // La V3 calcule le retard côté serveur dans la RPC clock_in
          if (attendance.validation_status === 'late') late++;
        }


        /*
         * ======================================================
         * 6. ABSENTS
         * ======================================================
         */

        const absent =
          Math.max(
            employees.length - present,
            0
          );


        /*
         * ======================================================
         * 7. STATISTIQUES FINALES
         * ======================================================
         */

        setStats({
          totalEmployees: employees.length,
          presentToday: present,
          lateToday: late,
          absentToday: absent,
        });

      } catch (err: any) {

        console.error(
          'Erreur Dashboard Manager:',
          err
        );

        setError(
          err?.message ||
          'Impossible de charger les données du tableau de bord.'
        );

      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();

  }, [
    role,
    profile?.structure_id,
  ]);


  // ==========================================================
  // ACCÈS NON AUTORISÉ
  // ==========================================================

  //   if (role !== 'manager') {
  //     return (
  //       <DashboardLayout>

  //         <div className="
  //           flex
  //           items-center
  //           justify-center
  //           py-20
  //         ">

  //           <p className="text-muted-foreground">
  //             Cette page est réservée aux managers.
  //           </p>

  //         </div>

  //       </DashboardLayout>
  //     );
  //   }



  if (loading) {
    return (
      <DashboardLayout>

        <div className="
          flex
          items-center
          justify-center
          py-20
        ">

          <div className="
            h-8
            w-8
            rounded-full
            border-4
            border-primary/20
            border-t-primary
            animate-spin
          "/>

        </div>

      </DashboardLayout>
    );
  }

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


        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="mb-8">

          <div className="
            flex
            items-center
            gap-3
            mb-2
          ">

            <Building2 className="
              h-6
              w-6
              text-primary
            " />

            <h1 className="page-title">
              Bonjour, {profile?.first_name}{' '}
              {profile?.last_name}
            </h1>

          </div>


          <p className="text-muted-foreground mt-1">

            Tableau de bord de votre structure
            {structure?.name && (
              <>
                {' — '}
                <strong className="text-foreground">
                  {structure.name}
                </strong>
              </>
            )}

          </p>

        </div>


        {/* ====================================================
            ERROR
        ==================================================== */}

        {error && (

          <Card className="
            mb-6
            border-destructive/30
          ">

            <CardContent className="
              flex
              items-center
              gap-3
              py-4
            ">

              <AlertTriangle className="
                h-5
                w-5
                text-destructive
              " />

              <p className="
                text-sm
                text-destructive
              ">

                {error}

              </p>

            </CardContent>

          </Card>

        )}


        {/* ====================================================
            STATISTIQUES
        ==================================================== */}

        <div className="
          grid
          grid-cols-1
          sm:grid-cols-2
          lg:grid-cols-4
          gap-4
          mb-8
        ">

          {statCards.map((stat) => {

            const Icon = stat.icon;

            return (

              <Card
                key={stat.label}
                className="stat-card"
              >

                <CardHeader className="
                  flex
                  flex-row
                  items-center
                  justify-between
                  pb-2
                  space-y-0
                ">

                  <CardTitle className="
                    text-sm
                    font-medium
                    text-muted-foreground
                  ">

                    {stat.label}

                  </CardTitle>


                  <Icon className={`
                    h-5
                    w-5
                    ${stat.color}
                  `} />

                </CardHeader>


                <CardContent>

                  <div className="
                    text-3xl
                    font-bold
                    font-display
                  ">

                    {stat.value}

                  </div>

                </CardContent>

              </Card>

            );
          })}

        </div>


        {/* ====================================================
            RÉSUMÉ DE LA STRUCTURE
        ==================================================== */}

        <div className="
          grid
          grid-cols-1
          lg:grid-cols-2
          gap-6
        ">


          {/* ------------------------------------------------
              PRÉSENCE
          ------------------------------------------------ */}

          <Card>

            <CardHeader>

              <CardTitle className="
                text-lg
                flex
                items-center
                gap-2
              ">

                <CheckCircle className="
                  h-5
                  w-5
                  text-success
                " />

                Présence aujourd'hui

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div className="
                flex
                items-center
                justify-between
                mb-3
              ">

                <span className="
                  text-sm
                  text-muted-foreground
                ">

                  Taux de présence

                </span>


                <span className="
                  text-lg
                  font-bold
                ">

                  {stats.totalEmployees > 0
                    ? Math.round(
                      (stats.presentToday /
                        stats.totalEmployees) *
                      100
                    )
                    : 0}
                  %

                </span>

              </div>


              <div className="
                h-2
                w-full
                rounded-full
                bg-muted
                overflow-hidden
              ">

                <div
                  className="
                    h-full
                    bg-success
                    rounded-full
                    transition-all
                  "
                  style={{
                    width: `${stats.totalEmployees > 0
                        ? Math.min(
                          (stats.presentToday /
                            stats.totalEmployees) *
                          100,
                          100
                        )
                        : 0
                      }%`,
                  }}
                />

              </div>


              <div className="
                grid
                grid-cols-2
                gap-4
                mt-5
              ">

                <div>

                  <p className="
                    text-2xl
                    font-bold
                  ">

                    {stats.presentToday}

                  </p>

                  <p className="
                    text-sm
                    text-muted-foreground
                  ">

                    Présents

                  </p>

                </div>


                <div>

                  <p className="
                    text-2xl
                    font-bold
                    text-destructive
                  ">

                    {stats.absentToday}

                  </p>

                  <p className="
                    text-sm
                    text-muted-foreground
                  ">

                    Absents

                  </p>

                </div>

              </div>

            </CardContent>

          </Card>


          {/* ------------------------------------------------
              RETARDS
          ------------------------------------------------ */}

          <Card>

            <CardHeader>

              <CardTitle className="
                text-lg
                flex
                items-center
                gap-2
              ">

                <Clock className="
                  h-5
                  w-5
                  text-warning
                " />

                Ponctualité

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div className="
                flex
                items-center
                justify-between
              ">

                <div>

                  <p className="
                    text-3xl
                    font-bold
                  ">

                    {stats.lateToday}

                  </p>

                  <p className="
                    text-sm
                    text-muted-foreground
                  ">

                    Employé(s) en retard

                  </p>

                </div>


                <div className="
                  flex
                  h-12
                  w-12
                  items-center
                  justify-center
                  rounded-full
                  bg-warning/10
                ">

                  <Clock className="
                    h-6
                    w-6
                    text-warning
                  " />

                </div>

              </div>


              <div className="
                mt-5
                p-3
                rounded-lg
                bg-muted/50
              ">

                <p className="
                  text-sm
                  text-muted-foreground
                ">

                  Les statistiques affichées
                  concernent uniquement les employés
                  actifs de votre structure.

                </p>

              </div>

            </CardContent>

          </Card>

        </div>


        {/* ====================================================
            MESSAGE MANAGER
        ==================================================== */}

        <Card className="mt-6">

          <CardContent className="
            flex
            items-start
            gap-4
            py-5
          ">

            <div className="
              flex
              h-10
              w-10
              shrink-0
              items-center
              justify-center
              rounded-lg
              bg-primary/10
            ">

              <Building2 className="
                h-5
                w-5
                text-primary
              " />

            </div>


            <div>

              <h3 className="
                font-semibold
                mb-1
              ">

                Gestion de votre structure

              </h3>


              <p className="
                text-sm
                text-muted-foreground
              ">

                Vous avez accès uniquement aux
                informations et aux employés associés
                à votre structure. Les données des autres
                structures ne sont pas accessibles.

              </p>

            </div>

          </CardContent>

        </Card>

      </div>

    </DashboardLayout>
  );
}