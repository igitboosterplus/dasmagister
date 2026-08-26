import { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Input } from '@/components/ui/input';

import { Button } from '@/components/ui/button';

import {
  Search,
  Loader2,
  Building2,
  Users,
  Phone,
  Briefcase,
  UserCog,
  Pencil,
  UserX,
  UserCheck,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';


// ============================================================
// TYPES
// ============================================================

interface StructureItem {
  id: string;
  name: string;
}

interface EmployeeItem {
  id: string;

  first_name: string;
  last_name: string;

  phone: string | null;

  role: string;

  position: string;
  service: string;

  structure_id: string;
  structure_name: string;

  site_id: string | null;
  site_name: string;

  is_active: boolean;
  deactivated_at: string | null;
}


// ============================================================
// COMPONENT
// ============================================================

export default function Employees() {
  const { role, profile } = useAuth();

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [structures, setStructures] = useState<StructureItem[]>([]);

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);

  const [actionLoading, setActionLoading] = useState(false);

  const [showInactive, setShowInactive] = useState(false);

  // ----------------------------------------------------------
  // DIALOG
  // ----------------------------------------------------------

  const [selectedEmployee, setSelectedEmployee] =
    useState<EmployeeItem | null>(null);

  const [dialogAction, setDialogAction] =
    useState<'deactivate' | 'activate' | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);

  // ----------------------------------------------------------
  // ERROR
  // ----------------------------------------------------------

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);


  // ==========================================================
  // FETCH EMPLOYEES
  // ==========================================================

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      /*
       * --------------------------------------------------------
       * Employés actifs
       *
       * Pour la liste principale, on ne récupère que les
       * employés actifs.
       *
       * La RLS Supabase applique également cette restriction.
       * --------------------------------------------------------
       */

      if (!showInactive) {
        const { data, error } = await supabase
          .from('employees')
          .select(`
              id,
              first_name,
              last_name,
              phone,
              structure_id,
              site_id,
              is_active,
              deactivated_at,

              employee_roles (
                role
              ),

              positions (
                name
              ),

              services (
                name
              ),

              structures (
                id,
                name
              ),

              sites (
                id,
                name
              )
            `)
          .eq('is_active', true)
          .order('first_name');

        if (error) {
          throw error;
        }

        const mappedEmployees = mapEmployees(data || []);

        setEmployees(mappedEmployees);

        buildStructures(mappedEmployees);

        return;
      }


      /*
       * --------------------------------------------------------
       * Employés désactivés
       *
       * Cette partie utilise la RPC réservée à l'admin.
       * --------------------------------------------------------
       */

      if (role !== 'admin') {
        setEmployees([]);
        setStructures([]);
        return;
      }

      const { data: inactiveData, error: inactiveError } =
        await supabase.rpc('get_inactive_employees');

      if (inactiveError) {
        throw inactiveError;
      }

      /*
       * La RPC retourne les employés mais pas nécessairement
       * toutes les relations utilisées dans l'affichage.
       *
       * On récupère donc leurs IDs puis leurs relations.
       */

      const inactiveEmployees = inactiveData || [];

      if (inactiveEmployees.length === 0) {
        setEmployees([]);
        setStructures([]);
        return;
      }

      const employeeIds = inactiveEmployees.map(
        (employee: any) => employee.id
      );

  const { data: relationData, error: relationError } =
  await supabase
    .from('employees')
    .select(`
      id,
      first_name,
      last_name,
      phone,
      structure_id,
      site_id,
      is_active,
      deactivated_at,

      employee_roles (
        role
      ),

      positions (
        name
      ),

      services (
        name
      ),

      structures (
        id,
        name
      ),

      sites (
        id,
        name
      )
    `)
    .in('id', employeeIds)
    .order('first_name');

      if (relationError) {
        throw relationError;
      }

      const mappedEmployees = mapEmployees(relationData || []);

      setEmployees(mappedEmployees);

      buildStructures(mappedEmployees);

    } catch (error: any) {
      console.error(
        'Erreur lors du chargement des employés:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de charger les employés.'
      );

      setEmployees([]);
      setStructures([]);

    } finally {
      setLoading(false);
    }
  };


  // ==========================================================
  // MAPPING
  // ==========================================================

const mapEmployees = (data: any[]): EmployeeItem[] => {
  return data
    .filter((employee: any) => {
      const employeeRole = Array.isArray(employee.employee_roles)
        ? employee.employee_roles[0]
        : employee.employee_roles;

      // Le PDG/admin ne doit pas apparaître dans la liste des employés
      return employeeRole?.role !== 'admin';
    })
    .map((employee: any) => {
      const structure = Array.isArray(employee.structures)
        ? employee.structures[0]
        : employee.structures;

      const employeeRole = Array.isArray(employee.employee_roles)
        ? employee.employee_roles[0]
        : employee.employee_roles;

      const position = Array.isArray(employee.positions)
        ? employee.positions[0]
        : employee.positions;

      const service = Array.isArray(employee.services)
        ? employee.services[0]
        : employee.services;

      const site = Array.isArray(employee.sites)
        ? employee.sites[0]
        : employee.sites;

      return {
        id: employee.id,

        first_name: employee.first_name,
        last_name: employee.last_name,

        phone: employee.phone,

        role: employeeRole?.role || 'employee',

        position: position?.name || '—',

        service: service?.name || '—',

        // Structure à laquelle appartient l'employé
        structure_id: employee.structure_id || null,

        structure_name:
          structure?.name || 'Structure inconnue',

        // Site sur lequel travaille l'employé
        site_id: employee.site_id || null,

        site_name:
          site?.name || 'Site non attribué',

        is_active: employee.is_active,

        deactivated_at:
          employee.deactivated_at || null,
      };
    });
};


  // ==========================================================
  // STRUCTURES
  // ==========================================================

  const buildStructures = (
    employeeList: EmployeeItem[]
  ) => {
    const structureMap =
      new Map<string, StructureItem>();

    employeeList.forEach((employee) => {
      if (!structureMap.has(employee.structure_id)) {
        structureMap.set(employee.structure_id, {
          id: employee.structure_id,
          name: employee.structure_name,
        });
      }
    });

    setStructures(
      Array.from(structureMap.values())
    );
  };


  // ==========================================================
  // INITIAL FETCH
  // ==========================================================

  useEffect(() => {
    if (role !== 'admin' && role !== 'manager') {
      setLoading(false);
      return;
    }

    fetchEmployees();

  }, [
    role,
    profile?.structure_id,
    showInactive,
  ]);


  // ==========================================================
  // SEARCH
  // ==========================================================

  const filteredEmployees = useMemo(() => {
    const normalizedSearch =
      search.toLowerCase().trim();

    let result = employees;


    /*
     * --------------------------------------------------------
     * Sécurité supplémentaire pour le manager
     *
     * La vraie sécurité vient de RLS.
     * Ce filtre protège également l'interface.
     * --------------------------------------------------------
     */

    if (
      role === 'manager' &&
      profile?.structure_id
    ) {
      result = result.filter(
        (employee) =>
          employee.structure_id ===
          profile.structure_id
      );
    }


    if (!normalizedSearch) {
      return result;
    }


    return result.filter((employee) => {
      const fullName =
        `${employee.first_name} ${employee.last_name}`
          .toLowerCase();

      return (
        fullName.includes(normalizedSearch) ||

        (employee.phone || '')
          .toLowerCase()
          .includes(normalizedSearch) ||

        employee.service
          .toLowerCase()
          .includes(normalizedSearch) ||

        employee.position
          .toLowerCase()
          .includes(normalizedSearch) ||

        employee.role
          .toLowerCase()
          .includes(normalizedSearch) ||

        employee.structure_name
          .toLowerCase()
          .includes(normalizedSearch) ||

        employee.site_name
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });

  }, [
    employees,
    search,
    role,
    profile?.structure_id,
  ]);


  // ==========================================================
  // GROUP BY STRUCTURE
  // ==========================================================

  const employeesByStructure = useMemo(() => {
    const grouped: Record<
      string,
      EmployeeItem[]
    > = {};

    filteredEmployees.forEach((employee) => {
      if (!grouped[employee.structure_id]) {
        grouped[employee.structure_id] = [];
      }

      grouped[employee.structure_id].push(employee);
    });

    return grouped;

  }, [filteredEmployees]);


  // ==========================================================
  // ROLE BADGE
  // ==========================================================

  const roleBadgeVariant = (
    employeeRole: string
  ) => {
    const map: Record<string, string> = {
      admin:
        'bg-primary/10 text-primary',

      manager:
        'bg-secondary/10 text-secondary',

      employee:
        'bg-muted text-muted-foreground',
    };

    return (
      map[employeeRole] ||
      'bg-muted text-muted-foreground'
    );
  };


  const getRoleLabel = (
    employeeRole: string
  ) => {
    const labels: Record<string, string> = {
      admin: 'Admin',
      manager: 'Manager',
      employee: 'Employé',
    };

    return (
      labels[employeeRole] ||
      employeeRole
    );
  };


  // ==========================================================
  // OPEN ACTION DIALOG
  // ==========================================================

  const openActionDialog = (
    employee: EmployeeItem,
    action: 'deactivate' | 'activate'
  ) => {
    setSelectedEmployee(employee);
    setDialogAction(action);
    setDialogOpen(true);
  };


  // ==========================================================
  // CLOSE DIALOG
  // ==========================================================

  const closeDialog = () => {
    if (actionLoading) return;

    setDialogOpen(false);
    setSelectedEmployee(null);
    setDialogAction(null);
  };


  // ==========================================================
  // DEACTIVATE
  // ==========================================================

  const handleDeactivate = async () => {
    if (!selectedEmployee) return;

    try {
      setActionLoading(true);
      setErrorMessage(null);

      const { error } = await supabase.rpc(
        'deactivate_employee',
        {
          p_employee_id:
            selectedEmployee.id,

          p_reason:
            'Désactivation effectuée depuis le module de gestion des employés.',
        }
      );

      if (error) {
        throw error;
      }

      /*
       * Retirer immédiatement l'employé de la vue.
       */

      setEmployees((current) =>
        current.filter(
          (employee) =>
            employee.id !== selectedEmployee.id
        )
      );

      closeDialog();

    } catch (error: any) {
      console.error(
        'Erreur lors de la désactivation:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de désactiver cet employé.'
      );

    } finally {
      setActionLoading(false);
    }
  };


  // ==========================================================
  // ACTIVATE
  // ==========================================================

  const handleActivate = async () => {
    if (!selectedEmployee) return;

    try {
      setActionLoading(true);
      setErrorMessage(null);

      const { error } = await supabase.rpc(
        'activate_employee',
        {
          p_employee_id:
            selectedEmployee.id,

          p_reason:
            'Réactivation effectuée depuis le module de gestion des employés.',
        }
      );

      if (error) {
        throw error;
      }

      /*
       * Retirer l'employé de la liste des comptes inactifs.
       */

      setEmployees((current) =>
        current.filter(
          (employee) =>
            employee.id !== selectedEmployee.id
        )
      );

      closeDialog();

    } catch (error: any) {
      console.error(
        'Erreur lors de la réactivation:',
        error
      );

      setErrorMessage(
        error?.message ||
        'Impossible de réactiver cet employé.'
      );

    } finally {
      setActionLoading(false);
    }
  };


  // ==========================================================
  // CONFIRM ACTION
  // ==========================================================

  const handleConfirmAction = async () => {
    if (dialogAction === 'deactivate') {
      await handleDeactivate();
      return;
    }

    if (dialogAction === 'activate') {
      await handleActivate();
    }
  };


  // ==========================================================
  // ACCESS CONTROL
  // ==========================================================

  if (
    role !== 'admin' &&
    role !== 'manager'
  ) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">
            Vous n'avez pas accès à cette page.
          </p>
        </div>
      </DashboardLayout>
    );
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <DashboardLayout>

      <div className="animate-fade-in">

        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">

          <div>

            <h1 className="page-title">
              Employés
            </h1>

            <p className="text-muted-foreground mt-1">
              {role === 'admin'
                ? showInactive
                  ? 'Gérez les employés désactivés.'
                  : 'Gérez les employés de toutes les structures.'
                : 'Gérez les employés de votre structure.'}
            </p>

          </div>


          <div className="flex items-center gap-3">

            <div className="flex items-center gap-2 text-sm text-muted-foreground">

              <Users className="h-4 w-4" />

              <span>
                {filteredEmployees.length} employé(s)
              </span>

            </div>

          </div>

        </div>


        {/* ====================================================
            ERROR
        ==================================================== */}

        {errorMessage && (
          <Alert
            variant="destructive"
            className="mb-6"
          >
            <AlertTitle>
              Une erreur est survenue
            </AlertTitle>

            <AlertDescription>
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}


        {/* ====================================================
            TOOLBAR
        ==================================================== */}

        <div className="flex flex-col md:flex-row gap-3 mb-8">

          {/* SEARCH */}

          <div className="relative max-w-md flex-1">

            <Search
              className="
                absolute
                left-3
                top-1/2
                -translate-y-1/2
                h-4
                w-4
                text-muted-foreground
              "
            />

            <Input
              placeholder="Rechercher un employé..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              className="pl-9"
            />

          </div>


          {/* ADMIN : ACTIVE / INACTIVE */}

          {role === 'admin' && (
            <Button
              variant="outline"
              onClick={() =>
                setShowInactive(
                  (current) => !current
                )
              }
              className="gap-2"
            >

              {showInactive ? (
                <>
                  <Users className="h-4 w-4" />
                  Employés actifs
                </>
              ) : (
                <>
                  <UserX className="h-4 w-4" />
                  Employés désactivés
                </>
              )}

            </Button>
          )}


          {/* REFRESH */}

          <Button
            variant="outline"
            size="icon"
            onClick={fetchEmployees}
            disabled={loading}
            title="Actualiser"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

        </div>


        {/* ====================================================
            STRUCTURES
        ==================================================== */}

        <div className="space-y-8">

          {structures.map((structure) => {

            const structureEmployees =
              employeesByStructure[
              structure.id
              ] || [];


            /*
             * Si une recherche est active et qu'aucun
             * employé de cette structure ne correspond.
             */

            if (
              search.trim() &&
              structureEmployees.length === 0
            ) {
              return null;
            }


            return (
              <section
                key={structure.id}
              >

                <Card className="overflow-hidden">

                  {/* ==========================================
                      STRUCTURE HEADER
                  ========================================== */}

                  <CardHeader className="border-b bg-muted/30">

                    <div className="flex items-center justify-between gap-4">

                      <div className="flex items-center gap-3">

                        <div className="
                          flex
                          h-10
                          w-10
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

                          <CardTitle className="text-lg">
                            {structure.name}
                          </CardTitle>

                          <p className="
                            text-sm
                            text-muted-foreground
                            mt-1
                          ">

                            {structureEmployees.length}{' '}
                            employé(s)

                          </p>

                        </div>

                      </div>

                    </div>

                  </CardHeader>


                  {/* ==========================================
                      EMPLOYEES
                  ========================================== */}

                  <CardContent className="p-0">

                    <div className="overflow-x-auto">

                      <table className="w-full">

                        <thead>

                          <tr className="
                            border-b
                            bg-muted/20
                          ">

                            <th className="table-header px-4 py-3 text-left">
                              Nom complet
                            </th>

                            <th className="table-header px-4 py-3 text-left">
                              Téléphone
                            </th>

                            <th className="table-header px-4 py-3 text-left">
                              Service
                            </th>

                            <th className="table-header px-4 py-3 text-left">
                              Poste
                            </th>

                            <th className="table-header px-4 py-3 text-left">
                              Rôle
                            </th>

                            <th className="table-header px-4 py-3 text-left">
                              Site
                            </th>

                            <th className="table-header px-4 py-3 text-right">
                              Actions
                            </th>

                          </tr>

                        </thead>


                        <tbody>

                          {structureEmployees.map(
                            (employee) => (

                              <tr
                                key={employee.id}
                                className="
                                  border-b
                                  last:border-0
                                  hover:bg-muted/30
                                  transition-colors
                                "
                              >

                                {/* NOM */}

                                <td className="px-4 py-3">

                                  <div className="flex items-center gap-3">

                                    <div className="
                                      flex
                                      h-8
                                      w-8
                                      items-center
                                      justify-center
                                      rounded-full
                                      bg-primary/10
                                    ">

                                      <span className="
                                        text-xs
                                        font-semibold
                                        text-primary
                                      ">

                                        {employee.first_name?.[0]}
                                        {employee.last_name?.[0]}

                                      </span>

                                    </div>


                                    <div>

                                      <span className="
                                        text-sm
                                        font-medium
                                      ">

                                        {employee.first_name}{' '}
                                        {employee.last_name}

                                      </span>

                                      {!employee.is_active && (
                                        <div className="
                                          text-xs
                                          text-destructive
                                          mt-0.5
                                        ">
                                          Compte désactivé
                                        </div>
                                      )}

                                    </div>

                                  </div>

                                </td>


                                {/* TELEPHONE */}

                                <td className="
                                  px-4
                                  py-3
                                  text-sm
                                  text-muted-foreground
                                ">

                                  <div className="flex items-center gap-2">

                                    <Phone className="h-3.5 w-3.5" />

                                    {employee.phone || '—'}

                                  </div>

                                </td>


                                {/* SERVICE */}

                                <td className="
                                  px-4
                                  py-3
                                  text-sm
                                ">

                                  <div className="flex items-center gap-2">

                                    <UserCog className="h-3.5 w-3.5 text-muted-foreground" />

                                    {employee.service}

                                  </div>

                                </td>


                                {/* POSTE */}

                                <td className="
                                  px-4
                                  py-3
                                  text-sm
                                ">

                                  <div className="flex items-center gap-2">

                                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />

                                    {employee.position}

                                  </div>

                                </td>


                                {/* ROLE */}

                                <td className="px-4 py-3">

                                  <span
                                    className={`
                                      badge-status
                                      ${roleBadgeVariant(
                                      employee.role
                                    )}
                                    `}
                                  >

                                    {getRoleLabel(
                                      employee.role
                                    )}

                                  </span>

                                </td>

                                {/* SITE */}
                                <td className="px-4 py-3 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />

                                    <span
                                      className={
                                        employee.site_id
                                          ? ''
                                          : 'text-muted-foreground italic'
                                      }
                                    >
                                      {employee.site_name}
                                    </span>
                                  </div>
                                </td>


                                {/* ACTIONS */}

                                <td className="px-4 py-3 text-right">

                                  <DropdownMenu>

                                    <DropdownMenuTrigger
                                      asChild
                                    >

                                      <Button
                                        variant="ghost"
                                        size="icon"
                                      >

                                        <MoreHorizontal className="h-4 w-4" />

                                      </Button>

                                    </DropdownMenuTrigger>


                                    <DropdownMenuContent
                                      align="end"
                                    >

                                      {/* ==================================
                                          MODIFIER
                                      ================================== */}

                                      <DropdownMenuItem
                                        onClick={() => {
                                          /*
                                           * Cette action sera reliée au
                                           * EmployeeForm dans l'étape suivante.
                                           */
                                          console.log(
                                            'Modifier employé:',
                                            employee.id
                                          );
                                        }}
                                      >

                                        <Pencil className="h-4 w-4 mr-2" />

                                        Modifier

                                      </DropdownMenuItem>


                                      <DropdownMenuSeparator />


                                      {/* ==================================
                                          DESACTIVER
                                      ================================== */}

                                      {!showInactive &&
                                        employee.is_active && (

                                          <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() =>
                                              openActionDialog(
                                                employee,
                                                'deactivate'
                                              )
                                            }
                                          >

                                            <UserX className="h-4 w-4 mr-2" />

                                            Désactiver

                                          </DropdownMenuItem>

                                        )}


                                      {/* ==================================
                                          REACTIVER
                                      ================================== */}

                                      {showInactive &&
                                        !employee.is_active &&
                                        role === 'admin' && (

                                          <DropdownMenuItem
                                            onClick={() =>
                                              openActionDialog(
                                                employee,
                                                'activate'
                                              )
                                            }
                                          >

                                            <UserCheck className="h-4 w-4 mr-2" />

                                            Réactiver

                                          </DropdownMenuItem>

                                        )}

                                    </DropdownMenuContent>

                                  </DropdownMenu>

                                </td>

                              </tr>

                            )
                          )}


                          {/* EMPTY */}

                          {structureEmployees.length === 0 && (

                            <tr>

                              <td
                                colSpan={6}
                                className="
                                  px-4
                                  py-8
                                  text-center
                                  text-muted-foreground
                                "
                              >

                                Aucun employé trouvé.

                              </td>

                            </tr>

                          )}

                        </tbody>

                      </table>

                    </div>

                  </CardContent>

                </Card>

              </section>
            );

          })}

        </div>


        {/* ====================================================
            NO RESULT
        ==================================================== */}

        {filteredEmployees.length === 0 && (

          <Card>

            <CardContent className="
              flex
              flex-col
              items-center
              justify-center
              py-16
              text-center
            ">

              <div className="
                flex
                h-12
                w-12
                items-center
                justify-center
                rounded-full
                bg-muted
                mb-4
              ">

                {showInactive ? (
                  <UserX className="
                    h-6
                    w-6
                    text-muted-foreground
                  " />
                ) : (
                  <Users className="
                    h-6
                    w-6
                    text-muted-foreground
                  " />
                )}

              </div>


              <h3 className="font-semibold text-lg">

                {showInactive
                  ? 'Aucun employé désactivé'
                  : 'Aucun employé trouvé'}

              </h3>


              <p className="
                text-sm
                text-muted-foreground
                mt-1
              ">

                {search
                  ? 'Aucun employé ne correspond à votre recherche.'
                  : showInactive
                    ? 'Il n’y a actuellement aucun employé désactivé.'
                    : 'Aucun employé n’est actuellement associé à cette structure.'}

              </p>

            </CardContent>

          </Card>

        )}

      </div>


      {/* ======================================================
          CONFIRMATION ACTION
      ====================================================== */}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
      >

        <DialogContent>

          <DialogHeader>

            <DialogTitle>

              {dialogAction === 'deactivate'
                ? 'Désactiver cet employé ?'
                : 'Réactiver cet employé ?'}

            </DialogTitle>


            <DialogDescription>

              {selectedEmployee && (
                <>
                  <strong>
                    {selectedEmployee.first_name}{' '}
                    {selectedEmployee.last_name}
                  </strong>

                  {dialogAction === 'deactivate'
                    ? (
                      <>
                        {' '}ne pourra plus être considéré
                        comme un employé actif et son compte
                        sera désactivé.
                        <br />
                        <br />
                        Ses données historiques seront
                        conservées.
                      </>
                    )
                    : (
                      <>
                        {' '}sera de nouveau considéré comme
                        un employé actif.
                      </>
                    )}

                </>
              )}

            </DialogDescription>

          </DialogHeader>


          <DialogFooter>

            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={actionLoading}
            >
              Annuler
            </Button>


            <Button
              variant={
                dialogAction === 'deactivate'
                  ? 'destructive'
                  : 'default'
              }
              onClick={handleConfirmAction}
              disabled={actionLoading}
            >

              {actionLoading && (
                <Loader2 className="
                  h-4
                  w-4
                  mr-2
                  animate-spin
                " />
              )}


              {dialogAction === 'deactivate'
                ? 'Désactiver'
                : 'Réactiver'}

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

    </DashboardLayout>
  );
}