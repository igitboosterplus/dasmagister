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
  ShieldAlert,
} from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

type EmployeeRole = 'employee' | 'manager';

interface StructureItem {
  id: string;
  name: string;
}

interface SiteItem {
  id: string;
  name: string;
  structure_id: string;
}

interface EmployeeSiteItem {
  id: string;
  name: string;
  is_responsible: boolean;
}

interface EmployeeItem {
  id: string;

  first_name: string;
  last_name: string;

  phone: string | null;

  role: string;

  position_id: string | null;
  position: string;

  service: string;

  structure_id: string | null;
  structure_name: string;

  sites: EmployeeSiteItem[];

  responsible_site_id: string | null;

  is_active: boolean;
  deactivated_at: string | null;
}

interface PositionItem {
  id: string;
  name: string;
}

// ============================================================
// COMPONENT
// ============================================================

export default function Employees() {
  const { role, profile } = useAuth();

  // ==========================================================
  // DATA
  // ==========================================================

  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [structures, setStructures] = useState<StructureItem[]>([]);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);

  // ==========================================================
  // EDITION
  // ==========================================================

  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const [cannotEditDialogOpen, setCannotEditDialogOpen] =
    useState(false);

  const [editingEmployee, setEditingEmployee] =
    useState<EmployeeItem | null>(null);

  const [selectedRole, setSelectedRole] =
    useState<EmployeeRole>('employee');

  const [selectedPositionId, setSelectedPositionId] =
    useState<string>('');

  const [selectedSiteIds, setSelectedSiteIds] =
    useState<string[]>([]);

  const [selectedResponsibleSiteId, setSelectedResponsibleSiteId] =
    useState<string | null>(null);

  const [editLoading, setEditLoading] =
    useState(false);

  // ==========================================================
  // UI
  // ==========================================================

  const [search, setSearch] = useState('');

  const [loading, setLoading] =
    useState(true);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [showInactive, setShowInactive] =
    useState(false);

  // ==========================================================
  // ACTION DIALOG
  // ==========================================================

  const [selectedEmployee, setSelectedEmployee] =
    useState<EmployeeItem | null>(null);

  const [dialogAction, setDialogAction] =
    useState<'deactivate' | 'activate' | null>(null);

  const [dialogOpen, setDialogOpen] =
    useState(false);

  // ==========================================================
  // ERROR
  // ==========================================================

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ==========================================================
  // HELPERS
  // ==========================================================

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error) {
      return error.message;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error
    ) {
      return String(
        (error as { message?: unknown }).message || fallback
      );
    }

    return fallback;
  };

  // ==========================================================
  // ACCESS CONTROL
  // ==========================================================

  const canManageEmployee = (
    employee: EmployeeItem
  ) => {
    if (role === 'admin') {
      return employee.role !== 'admin';
    }

    if (role === 'manager') {
      return (
        employee.role === 'employee' &&
        employee.structure_id === profile?.structure_id
      );
    }

    return false;
  };

  // ==========================================================
  // FETCH POSITIONS
  // ==========================================================

  const fetchPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select(`
          id,
          name
        `)
        .order('name');

      if (error) {
        throw error;
      }

      setPositions(data || []);
    } catch (error) {
      console.error(
        'Erreur lors du chargement des postes:',
        error
      );

      setErrorMessage(
        getErrorMessage(
          error,
          'Impossible de charger les postes.'
        )
      );
    }
  };

  // ==========================================================
  // MAPPING
  // ==========================================================

  const mapEmployees = (
    data: any[]
  ): EmployeeItem[] => {
    return data
      .filter((employee: any) => {
        const employeeRole =
          Array.isArray(employee.employee_roles)
            ? employee.employee_roles[0]
            : employee.employee_roles;

        // Le compte admin / PDG n'apparaît jamais
        return employeeRole?.role !== 'admin';
      })
      .map((employee: any) => {
        const structure =
          Array.isArray(employee.structures)
            ? employee.structures[0]
            : employee.structures;

        const employeeRole =
          Array.isArray(employee.employee_roles)
            ? employee.employee_roles[0]
            : employee.employee_roles;

        const position =
          Array.isArray(employee.positions)
            ? employee.positions[0]
            : employee.positions;

        const service =
          Array.isArray(employee.services)
            ? employee.services[0]
            : employee.services;

        // ------------------------------------------------------
        // SITES
        // ------------------------------------------------------

        const employeeSites: EmployeeSiteItem[] =
          (
            Array.isArray(employee.employee_sites)
              ? employee.employee_sites
              : []
          )
            .filter(
              (employeeSite: any) =>
                employeeSite?.is_active !== false
            )
            .map((employeeSite: any) => {
              const site =
                Array.isArray(employeeSite.sites)
                  ? employeeSite.sites[0]
                  : employeeSite.sites;

              if (!site) {
                return null;
              }

              return {
                id: site.id,
                name: site.name,
                is_responsible:
                  employeeSite.is_responsible === true,
              };
            })
            .filter(
              (
                site: EmployeeSiteItem | null
              ): site is EmployeeSiteItem =>
                site !== null
            );

        const responsibleSite =
          employeeSites.find(
            (site) => site.is_responsible
          );

        return {
          id: employee.id,

          first_name:
            employee.first_name,

          last_name:
            employee.last_name,

          phone:
            employee.phone,

          role:
            employeeRole?.role || 'employee',

          position_id:
            position?.id || null,

          position:
            position?.name || '—',

          service:
            service?.name || '—',

          structure_id:
            employee.structure_id || null,

          structure_name:
            structure?.name || 'Structure inconnue',

          sites:
            employeeSites,

          responsible_site_id:
            responsibleSite?.id || null,

          is_active:
            employee.is_active,

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
      if (
        !employee.structure_id ||
        !employee.structure_name
      ) {
        return;
      }

      if (
        !structureMap.has(employee.structure_id)
      ) {
        structureMap.set(
          employee.structure_id,
          {
            id: employee.structure_id,
            name: employee.structure_name,
          }
        );
      }
    });

    setStructures(
      Array.from(structureMap.values())
    );
  };

  // ==========================================================
  // FETCH EMPLOYEES
  // ==========================================================

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      // ======================================================
      // EMPLOYÉS ACTIFS
      // ======================================================

      if (!showInactive) {
        let query = supabase
          .from('employees')
          .select(`
            id,
            first_name,
            last_name,
            phone,
            structure_id,
            is_active,
            deactivated_at,

            employee_roles (
              role
            ),

            positions (
              id,
              name
            ),

            services (
              name
            ),

            structures (
              id,
              name
            ),

            employee_sites!employee_sites_employee_id_fkey (
              id,
              site_id,
              is_active,
              is_responsible,
              sites (
                id,
                name
              )
            )
          `)
          .eq('is_active', true)
          .eq('employee_sites.is_active', true)
          .order('first_name');

        // ----------------------------------------------------
        // SÉCURITÉ SUPPLÉMENTAIRE MANAGER
        // ----------------------------------------------------

        if (
          role === 'manager' &&
          profile?.structure_id
        ) {
          query = query.eq(
            'structure_id',
            profile.structure_id
          );
        }

        const {
          data,
          error,
        } = await query;

        if (error) {
          throw error;
        }

        const mappedEmployees =
          mapEmployees(data || []);

        setEmployees(mappedEmployees);

        buildStructures(mappedEmployees);

        return;
      }

      // ======================================================
      // EMPLOYÉS DÉSACTIVÉS
      // ======================================================

      if (role !== 'admin') {
        setEmployees([]);
        setStructures([]);
        return;
      }

      const {
        data: inactiveData,
        error: inactiveError,
      } = await supabase.rpc(
        'get_inactive_employees'
      );

      if (inactiveError) {
        throw inactiveError;
      }

      const inactiveEmployees =
        inactiveData || [];

      if (
        inactiveEmployees.length === 0
      ) {
        setEmployees([]);
        setStructures([]);
        return;
      }

      const employeeIds =
        inactiveEmployees
          .map(
            (employee: any) => employee.id
          )
          .filter(Boolean);

      if (employeeIds.length === 0) {
        setEmployees([]);
        setStructures([]);
        return;
      }

      const {
        data: relationData,
        error: relationError,
      } = await supabase
        .from('employees')
        .select(`
          id,
          first_name,
          last_name,
          phone,
          structure_id,
          is_active,
          deactivated_at,

          employee_roles (
            role
          ),

          positions (
            id,
            name
          ),

          services (
            name
          ),

          structures (
            id,
            name
          ),

          employee_sites!employee_sites_employee_id_fkey (
            id,
            site_id,
            is_active,
            is_responsible,
            sites (
              id,
              name
            )
          )
        `)
        .in('id', employeeIds)
        .order('first_name');

      if (relationError) {
        throw relationError;
      }

      const mappedEmployees =
        mapEmployees(relationData || []);

      setEmployees(mappedEmployees);

      buildStructures(mappedEmployees);

    } catch (error) {
      console.error(
        'Erreur lors du chargement des employés:',
        error
      );

      setErrorMessage(
        getErrorMessage(
          error,
          'Impossible de charger les employés.'
        )
      );

      setEmployees([]);
      setStructures([]);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================================
  // FETCH SITES
  // ==========================================================

  const fetchSites = async () => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from('sites')
        .select(`
          id,
          name,
          structure_id
        `)
        .eq('is_active', true)
        .order('name');

      if (error) {
        throw error;
      }

      const filteredSites =
        role === 'manager' &&
        profile?.structure_id
          ? (data || []).filter(
              (site) =>
                site.structure_id ===
                profile.structure_id
            )
          : data || [];

      setSites(filteredSites);
    } catch (error) {
      console.error(
        'Erreur lors du chargement des sites:',
        error
      );

      setErrorMessage(
        getErrorMessage(
          error,
          'Impossible de charger les sites.'
        )
      );
    }
  };

  // ==========================================================
  // INITIAL FETCH
  // ==========================================================

  useEffect(() => {
    if (
      role !== 'admin' &&
      role !== 'manager'
    ) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      await Promise.all([
        fetchEmployees(),
        fetchSites(),
        fetchPositions(),
      ]);
    };

    void loadData();
  }, [
    role,
    profile?.structure_id,
    showInactive,
  ]);

  // ==========================================================
  // SEARCH
  // ==========================================================

  const filteredEmployees =
    useMemo(() => {
      const normalizedSearch =
        search
          .toLowerCase()
          .trim();

      let result = employees;

      // Sécurité UI supplémentaire
      if (
        role === 'manager' &&
        profile?.structure_id
      ) {
        result =
          result.filter(
            (employee) =>
              employee.structure_id ===
              profile.structure_id &&
              employee.role === 'employee'
          );
      }

      if (!normalizedSearch) {
        return result;
      }

      return result.filter(
        (employee) => {
          const fullName =
            `${employee.first_name} ${employee.last_name}`
              .toLowerCase();

          const sitesText =
            employee.sites
              .map(
                (site) => site.name
              )
              .join(' ')
              .toLowerCase();

          return (
            fullName.includes(
              normalizedSearch
            ) ||
            (employee.phone || '')
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            employee.service
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            employee.position
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            employee.role
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            employee.structure_name
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            sitesText.includes(
              normalizedSearch
            )
          );
        }
      );
    }, [
      employees,
      search,
      role,
      profile?.structure_id,
    ]);

  // ==========================================================
  // GROUP BY STRUCTURE
  // ==========================================================

  const employeesByStructure =
    useMemo(() => {
      const grouped:
        Record<string, EmployeeItem[]> = {};

      filteredEmployees.forEach(
        (employee) => {
          if (!employee.structure_id) {
            return;
          }

          if (
            !grouped[employee.structure_id]
          ) {
            grouped[employee.structure_id] = [];
          }

          grouped[
            employee.structure_id
          ].push(employee);
        }
      );

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
    action:
      | 'deactivate'
      | 'activate'
  ) => {
    if (
      action === 'deactivate' &&
      !canManageEmployee(employee)
    ) {
      if (
        role === 'manager' &&
        employee.role === 'manager'
      ) {
        setEditingEmployee(employee);
        setCannotEditDialogOpen(true);
      }

      return;
    }

    if (
      action === 'activate' &&
      role !== 'admin'
    ) {
      return;
    }

    setSelectedEmployee(employee);
    setDialogAction(action);
    setDialogOpen(true);
  };

  // ==========================================================
  // OPEN EDIT DIALOG
  // ==========================================================

  const openEditDialog = (
    employee: EmployeeItem
  ) => {
    if (
      role === 'manager' &&
      employee.role === 'manager'
    ) {
      setEditingEmployee(employee);
      setCannotEditDialogOpen(true);
      return;
    }

    if (!canManageEmployee(employee)) {
      return;
    }

    setEditingEmployee(employee);

    setSelectedRole(
      employee.role === 'manager'
        ? 'manager'
        : 'employee'
    );

    setSelectedPositionId(
      employee.position_id || ''
    );

    setSelectedSiteIds(
      employee.sites.map(
        (site) => site.id
      )
    );

    setSelectedResponsibleSiteId(
      employee.responsible_site_id
    );

    setEditDialogOpen(true);
  };

  // ==========================================================
  // CLOSE EDIT DIALOG
  // ==========================================================

  const closeEditDialog = () => {
    if (editLoading) {
      return;
    }

    setEditDialogOpen(false);
    setEditingEmployee(null);
    setSelectedRole('employee');
    setSelectedPositionId('');
    setSelectedSiteIds([]);
    setSelectedResponsibleSiteId(null);
  };

  // ==========================================================
  // CLOSE ACTION DIALOG
  // ==========================================================

  const closeActionDialog = () => {
    if (actionLoading) {
      return;
    }

    setDialogOpen(false);
    setSelectedEmployee(null);
    setDialogAction(null);
  };

  // ==========================================================
  // DEACTIVATE
  // ==========================================================

  const handleDeactivate = async () => {
    if (!selectedEmployee) {
      return;
    }

    if (
      !canManageEmployee(selectedEmployee)
    ) {
      setErrorMessage(
        'Vous n’êtes pas autorisé à désactiver cet employé.'
      );

      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage(null);

      const {
        error,
      } = await supabase.rpc(
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

      setEmployees(
        (current) =>
          current.filter(
            (employee) =>
              employee.id !==
              selectedEmployee.id
          )
      );

      // Fermeture directe : actionLoading est encore true
      setDialogOpen(false);
      setSelectedEmployee(null);
      setDialogAction(null);

    } catch (error) {
      console.error(
        'Erreur lors de la désactivation:',
        error
      );

      setErrorMessage(
        getErrorMessage(
          error,
          'Impossible de désactiver cet employé.'
        )
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ==========================================================
  // ACTIVATE
  // ==========================================================

  const handleActivate = async () => {
    if (!selectedEmployee) {
      return;
    }

    if (role !== 'admin') {
      setErrorMessage(
        'Seul un administrateur peut réactiver un employé.'
      );

      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage(null);

      const {
        error,
      } = await supabase.rpc(
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

      setEmployees(
        (current) =>
          current.filter(
            (employee) =>
              employee.id !==
              selectedEmployee.id
          )
      );

      setDialogOpen(false);
      setSelectedEmployee(null);
      setDialogAction(null);

    } catch (error) {
      console.error(
        'Erreur lors de la réactivation:',
        error
      );

      setErrorMessage(
        getErrorMessage(
          error,
          'Impossible de réactiver cet employé.'
        )
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ==========================================================
  // CONFIRM ACTION
  // ==========================================================

  const handleConfirmAction =
    async () => {
      if (
        dialogAction ===
        'deactivate'
      ) {
        await handleDeactivate();
        return;
      }

      if (
        dialogAction ===
        'activate'
      ) {
        await handleActivate();
      }
    };

  // ==========================================================
  // UPDATE EMPLOYEE
  // ==========================================================

  const handleUpdateEmployee =
    async () => {
      if (!editingEmployee) {
        return;
      }

      try {
        setEditLoading(true);
        setErrorMessage(null);

        // ====================================================
        // 1. AUTORISATION
        // ====================================================

        if (
          !canManageEmployee(editingEmployee)
        ) {
          if (
            role === 'manager' &&
            editingEmployee.role === 'manager'
          ) {
            closeEditDialog();
            setEditingEmployee(
              editingEmployee
            );
            setCannotEditDialogOpen(true);
            return;
          }

          throw new Error(
            'Vous n’êtes pas autorisé à modifier cet employé.'
          );
        }

        // ====================================================
        // 2. VALIDATION DU RÔLE
        // ====================================================

        if (
          selectedRole !== 'employee' &&
          selectedRole !== 'manager'
        ) {
          throw new Error(
            'Le rôle sélectionné est invalide.'
          );
        }

        // Un manager ne peut attribuer que employee
        if (
          role === 'manager' &&
          selectedRole !== 'employee'
        ) {
          throw new Error(
            'Un manager ne peut attribuer que le rôle Employé.'
          );
        }

        // ====================================================
        // 3. VALIDATION DU POSTE
        // ====================================================

        if (!selectedPositionId) {
          throw new Error(
            'Veuillez sélectionner un poste.'
          );
        }

        const selectedPosition =
          positions.find(
            (position) =>
              position.id ===
              selectedPositionId
          );

        if (!selectedPosition) {
          throw new Error(
            'Le poste sélectionné est invalide.'
          );
        }

        const isResponsiblePosition =
          selectedPosition.name
            .toLowerCase()
            .trim() === 'responsable';

        // ====================================================
        // 4. VALIDATION DES SITES
        // ====================================================

        const selectedSites =
          sites.filter(
            (site) =>
              selectedSiteIds.includes(
                site.id
              )
          );

        if (
          selectedSites.length !==
          selectedSiteIds.length
        ) {
          throw new Error(
            'Un ou plusieurs sites sélectionnés sont invalides.'
          );
        }

        // ----------------------------------------------------
        // Ici on impose au moins un site.
        // Si ton métier autorise réellement zéro site,
        // supprime cette validation.
        // ----------------------------------------------------

        if (
          selectedSiteIds.length === 0
        ) {
          throw new Error(
            'Un employé doit être affecté à au moins un site.'
          );
        }

        // ====================================================
        // 5. VALIDATION RESPONSABLE
        // ====================================================

        if (isResponsiblePosition) {
          if (
            !selectedResponsibleSiteId
          ) {
            throw new Error(
              'Un employé occupant le poste Responsable doit avoir un site responsable.'
            );
          }

          if (
            !selectedSiteIds.includes(
              selectedResponsibleSiteId
            )
          ) {
            throw new Error(
              'Le site responsable doit faire partie des sites sélectionnés.'
            );
          }
        } else {
          setSelectedResponsibleSiteId(
            null
          );
        }

        // ====================================================
        // 6. MANAGER → MÊME STRUCTURE
        // ====================================================

        if (role === 'manager') {
          if (
            !profile?.structure_id
          ) {
            throw new Error(
              'Votre structure est introuvable.'
            );
          }

          if (
            editingEmployee.structure_id !==
            profile.structure_id
          ) {
            throw new Error(
              'Vous ne pouvez modifier qu’un employé de votre structure.'
            );
          }

          const invalidStructureSite =
            selectedSites.some(
              (site) =>
                site.structure_id !==
                profile.structure_id
            );

          if (
            invalidStructureSite
          ) {
            throw new Error(
              'Vous ne pouvez affecter un employé qu’à des sites de votre structure.'
            );
          }
        }

        // ====================================================
        // 7. MISE À JOUR DU POSTE
        // ====================================================

        const {
          error: positionError,
        } = await supabase
          .from('employees')
          .update({
            position_id:
              selectedPositionId,
            updated_at:
              new Date().toISOString(),
          })
          .eq(
            'id',
            editingEmployee.id
          );

        if (positionError) {
          throw new Error(
            `Impossible de modifier le poste : ${positionError.message}`
          );
        }

        // ====================================================
        // 8. DÉSACTIVER LES ANCIENNES AFFECTATIONS
        // ====================================================

        const {
          error:
            deactivateSitesError,
        } = await supabase
          .from('employee_sites')
          .update({
            is_active: false,
            is_responsible: false,
            updated_at:
              new Date().toISOString(),
          })
          .eq(
            'employee_id',
            editingEmployee.id
          )
          .eq(
            'is_active',
            true
          );

        if (
          deactivateSitesError
        ) {
          throw new Error(
            `Impossible de désactiver les anciennes affectations : ${deactivateSitesError.message}`
          );
        }

        // ====================================================
        // 9. RÉACTIVER / CRÉER LES SITES
        // ====================================================

        const now =
          new Date().toISOString();

        for (
          const siteId of selectedSiteIds
        ) {
          const isResponsible =
            isResponsiblePosition &&
            selectedResponsibleSiteId ===
              siteId;

          const {
            error: upsertError,
          } = await supabase
            .from('employee_sites')
            .upsert(
              {
                employee_id:
                  editingEmployee.id,

                site_id:
                  siteId,

                is_active:
                  true,

                is_responsible:
                  isResponsible,

                assigned_by:
                  profile?.id || null,

                assigned_at:
                  now,

                updated_at:
                  now,
              },
              {
                onConflict:
                  'employee_id,site_id',
              }
            );

          if (
            upsertError
          ) {
            throw new Error(
              `Impossible d'affecter le site : ${upsertError.message}`
            );
          }
        }

        // ====================================================
        // 10. RÉCUPÉRER LE RÔLE
        // ====================================================

        const {
          data: existingRole,
          error:
            roleFetchError,
        } = await supabase
          .from('employee_roles')
          .select(`
            id,
            employee_id,
            role
          `)
          .eq(
            'employee_id',
            editingEmployee.id
          )
          .maybeSingle();

        if (
          roleFetchError
        ) {
          throw new Error(
            `Impossible de récupérer le rôle actuel : ${roleFetchError.message}`
          );
        }

        // ====================================================
        // 11. METTRE À JOUR / CRÉER LE RÔLE
        // ====================================================

        if (existingRole) {
          const {
            error:
              roleUpdateError,
          } = await supabase
            .from('employee_roles')
            .update({
              role:
                selectedRole,
            })
            .eq(
              'employee_id',
              editingEmployee.id
            );

          if (
            roleUpdateError
          ) {
            throw new Error(
              `Impossible de modifier le rôle : ${roleUpdateError.message}`
            );
          }
        } else {
          const {
            error:
              roleInsertError,
          } = await supabase
            .from('employee_roles')
            .insert({
              employee_id:
                editingEmployee.id,

              role:
                selectedRole,
            });

          if (
            roleInsertError
          ) {
            throw new Error(
              `Impossible d'attribuer le rôle : ${roleInsertError.message}`
            );
          }
        }

        // ====================================================
        // 12. FERMETURE
        // ====================================================

        setEditDialogOpen(false);
        setEditingEmployee(null);
        setSelectedRole('employee');
        setSelectedPositionId('');
        setSelectedSiteIds([]);
        setSelectedResponsibleSiteId(null);

        // ====================================================
        // 13. RECHARGEMENT
        // ====================================================

        await fetchEmployees();

      } catch (error) {
        console.error(
          'Erreur lors de la modification de l’employé :',
          error
        );

        setErrorMessage(
          getErrorMessage(
            error,
            'Impossible de modifier cet employé.'
          )
        );
      } finally {
        setEditLoading(false);
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

        {/* ==================================================
            HEADER
        ================================================== */}

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

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />

            <span>
              {filteredEmployees.length}{' '}
              employé(s)
            </span>
          </div>

        </div>

        {/* ==================================================
            ERROR
        ================================================== */}

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

        {/* ==================================================
            TOOLBAR
        ================================================== */}

        <div className="flex flex-col md:flex-row gap-3 mb-8">

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
              placeholder="Rechercher un employé, service, poste ou site..."
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              className="pl-9"
            />

          </div>

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

          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              void fetchEmployees();
              void fetchSites();
              void fetchPositions();
            }}
            disabled={loading}
            title="Actualiser"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

        </div>

        {/* ==================================================
            STRUCTURES
        ================================================== */}

        <div className="space-y-8">

          {structures.map(
            (structure) => {

              const structureEmployees =
                employeesByStructure[
                  structure.id
                ] || [];

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

                    <CardHeader className="border-b bg-muted/30">

                      <div className="flex items-center gap-3">

                        <div
                          className="
                            flex
                            h-10
                            w-10
                            items-center
                            justify-center
                            rounded-lg
                            bg-primary/10
                          "
                        >
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>

                        <div>

                          <CardTitle className="text-lg">
                            {structure.name}
                          </CardTitle>

                          <p className="text-sm text-muted-foreground mt-1">
                            {structureEmployees.length}{' '}
                            employé(s)
                          </p>

                        </div>

                      </div>

                    </CardHeader>

                    <CardContent className="p-0">

                      <div className="overflow-x-auto">

                        <table className="w-full">

                          <thead>

                            <tr className="border-b bg-muted/20">

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
                                Sites
                              </th>

                              <th className="table-header px-4 py-3 text-right">
                                Actions
                              </th>

                            </tr>

                          </thead>

                          <tbody>

                            {structureEmployees.map(
                              (employee) => {

                                const canManage =
                                  canManageEmployee(
                                    employee
                                  );

                                return (
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

                                        <div
                                          className="
                                            flex
                                            h-8
                                            w-8
                                            items-center
                                            justify-center
                                            rounded-full
                                            bg-primary/10
                                          "
                                        >
                                          <span className="text-xs font-semibold text-primary">
                                            {employee.first_name?.[0]}
                                            {employee.last_name?.[0]}
                                          </span>
                                        </div>

                                        <div>

                                          <span className="text-sm font-medium">
                                            {employee.first_name}{' '}
                                            {employee.last_name}
                                          </span>

                                          {!employee.is_active && (
                                            <div className="text-xs text-destructive mt-0.5">
                                              Compte désactivé
                                            </div>
                                          )}

                                        </div>

                                      </div>

                                    </td>

                                    {/* TELEPHONE */}

                                    <td className="px-4 py-3 text-sm text-muted-foreground">

                                      <div className="flex items-center gap-2">

                                        <Phone className="h-3.5 w-3.5" />

                                        {employee.phone ||
                                          '—'}

                                      </div>

                                    </td>

                                    {/* SERVICE */}

                                    <td className="px-4 py-3 text-sm">

                                      <div className="flex items-center gap-2">

                                        <UserCog className="h-3.5 w-3.5 text-muted-foreground" />

                                        {employee.service}

                                      </div>

                                    </td>

                                    {/* POSTE */}

                                    <td className="px-4 py-3 text-sm">

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

                                    {/* SITES */}

                                    <td className="px-4 py-3">

                                      {employee.sites.length >
                                      0 ? (
                                        <div className="flex flex-wrap gap-1.5">

                                          {employee.sites.map(
                                            (site) => (
                                              <span
                                                key={site.id}
                                                className="
                                                  inline-flex
                                                  items-center
                                                  gap-1
                                                  rounded-md
                                                  bg-muted
                                                  px-2
                                                  py-1
                                                  text-xs
                                                "
                                              >

                                                <Building2 className="h-3 w-3" />

                                                {site.name}

                                                {site.is_responsible && (
                                                  <span className="ml-1 font-medium">
                                                    • Responsable
                                                  </span>
                                                )}

                                              </span>
                                            )
                                          )}

                                        </div>
                                      ) : (
                                        <span className="text-sm text-muted-foreground italic">
                                          Aucun site
                                        </span>
                                      )}

                                    </td>

                                    {/* ACTIONS */}

                                    <td className="px-4 py-3 text-right">

                                      {canManage ? (
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

                                          <DropdownMenuContent align="end">

                                            <DropdownMenuItem
                                              onClick={() =>
                                                openEditDialog(
                                                  employee
                                                )
                                              }
                                            >
                                              <Pencil className="h-4 w-4 mr-2" />
                                              Modifier
                                            </DropdownMenuItem>

                                            {!showInactive &&
                                              employee.is_active && (
                                                <>
                                                  <DropdownMenuSeparator />

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
                                                </>
                                              )}

                                            {showInactive &&
                                              !employee.is_active &&
                                              role === 'admin' && (
                                                <>
                                                  <DropdownMenuSeparator />

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
                                                </>
                                              )}

                                          </DropdownMenuContent>

                                        </DropdownMenu>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">
                                          Non modifiable
                                        </span>
                                      )}

                                    </td>

                                  </tr>
                                );
                              }
                            )}

                            {structureEmployees.length === 0 && (
                              <tr>

                                <td
                                  colSpan={7}
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
            }
          )}

        </div>

        {/* ==================================================
            NO RESULT
        ================================================== */}

        {filteredEmployees.length === 0 && (

          <Card>

            <CardContent
              className="
                flex
                flex-col
                items-center
                justify-center
                py-16
                text-center
              "
            >

              <div
                className="
                  flex
                  h-12
                  w-12
                  items-center
                  justify-center
                  rounded-full
                  bg-muted
                  mb-4
                "
              >

                {showInactive ? (
                  <UserX className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <Users className="h-6 w-6 text-muted-foreground" />
                )}

              </div>

              <h3 className="font-semibold text-lg">

                {showInactive
                  ? 'Aucun employé désactivé'
                  : 'Aucun employé trouvé'}

              </h3>

              <p className="text-sm text-muted-foreground mt-1">

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

      {/* ====================================================
          MANAGER → MANAGER IMPOSSIBLE
      ==================================================== */}

      <Dialog
        open={cannotEditDialogOpen}
        onOpenChange={
          setCannotEditDialogOpen
        }
      >

        <DialogContent className="sm:max-w-md">

          <DialogHeader>

            <div className="flex items-center gap-3 mb-2">

              <div
                className="
                  flex
                  h-10
                  w-10
                  items-center
                  justify-center
                  rounded-full
                  bg-destructive/10
                "
              >
                <ShieldAlert className="h-5 w-5 text-destructive" />
              </div>

              <DialogTitle>
                Modification impossible
              </DialogTitle>

            </div>

            <DialogDescription>

              {editingEmployee && (
                <>
                  Vous ne pouvez pas modifier le rôle
                  ou l'affectation du manager{' '}

                  <strong>
                    {editingEmployee.first_name}{' '}
                    {editingEmployee.last_name}
                  </strong>.

                  <br />
                  <br />

                  Seul un administrateur peut effectuer
                  cette opération.
                </>
              )}

            </DialogDescription>

          </DialogHeader>

          <DialogFooter>

            <Button
              onClick={() => {
                setCannotEditDialogOpen(false);
                setEditingEmployee(null);
              }}
            >
              Compris
            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

      {/* ====================================================
          EDIT EMPLOYEE
      ==================================================== */}

      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeEditDialog();
          }
        }}
      >

        <DialogContent className="sm:max-w-lg">

          <DialogHeader>

            <DialogTitle>
              Modifier l'employé
            </DialogTitle>

            <DialogDescription>

              {editingEmployee && (
                <>
                  Modification de{' '}

                  <strong>
                    {editingEmployee.first_name}{' '}
                    {editingEmployee.last_name}
                  </strong>.
                </>
              )}

            </DialogDescription>

          </DialogHeader>

          {editingEmployee && (

            <div className="space-y-6 py-4">

              {/* ==========================================
                  INFORMATIONS
              ========================================== */}

              <div
                className="
                  rounded-lg
                  border
                  bg-muted/30
                  p-4
                "
              >

                <div className="flex items-center gap-3">

                  <div
                    className="
                      flex
                      h-10
                      w-10
                      items-center
                      justify-center
                      rounded-full
                      bg-primary/10
                    "
                  >
                    <span
                      className="
                        text-sm
                        font-semibold
                        text-primary
                      "
                    >
                      {editingEmployee.first_name?.[0]}
                      {editingEmployee.last_name?.[0]}
                    </span>
                  </div>

                  <div>

                    <p className="font-medium">
                      {editingEmployee.first_name}{' '}
                      {editingEmployee.last_name}
                    </p>

                    <p className="text-sm text-muted-foreground">
                      {editingEmployee.position}
                    </p>

                  </div>

                </div>

              </div>

              {/* ==========================================
                  ROLE
              ========================================== */}

              <div className="space-y-2">

                <label className="text-sm font-medium">
                  Rôle
                </label>

                <Select
                  value={selectedRole}
                  onValueChange={(value) =>
                    setSelectedRole(
                      value as EmployeeRole
                    )
                  }
                  disabled={
                    role === 'manager'
                  }
                >

                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un rôle" />
                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="employee">
                      Employé
                    </SelectItem>

                    {role === 'admin' && (
                      <SelectItem value="manager">
                        Manager
                      </SelectItem>
                    )}

                  </SelectContent>

                </Select>

                {role === 'manager' && (
                  <p className="text-xs text-muted-foreground">
                    En tant que manager, vous pouvez
                    uniquement attribuer le rôle Employé.
                  </p>
                )}

              </div>

              {/* ==========================================
                  POSTE
              ========================================== */}

              <div className="space-y-2">

                <label className="text-sm font-medium">
                  Poste
                </label>

                <Select
                  value={selectedPositionId}
                  onValueChange={(value) => {

                    setSelectedPositionId(value);

                    const position =
                      positions.find(
                        (item) =>
                          item.id === value
                      );

                    const isResponsible =
                      position?.name
                        .toLowerCase()
                        .trim() ===
                      'responsable';

                    if (!isResponsible) {
                      setSelectedResponsibleSiteId(
                        null
                      );
                    }

                  }}
                  disabled={editLoading}
                >

                  <SelectTrigger>
                    <SelectValue
                      placeholder="Sélectionner un poste"
                    />
                  </SelectTrigger>

                  <SelectContent>

                    {positions.map(
                      (position) => (
                        <SelectItem
                          key={position.id}
                          value={position.id}
                        >
                          {position.name}
                        </SelectItem>
                      )
                    )}

                  </SelectContent>

                </Select>

              </div>

              {/* ==========================================
                  SITES
              ========================================== */}

              <div className="space-y-2">

                <div className="flex items-center justify-between">

                  <label className="text-sm font-medium">
                    Sites assignés
                  </label>

                  <span className="text-xs text-muted-foreground">
                    {selectedSiteIds.length}{' '}
                    sélectionné(s)
                  </span>

                </div>

                <div
                  className="
                    rounded-md
                    border
                    p-3
                    space-y-2
                    max-h-48
                    overflow-y-auto
                  "
                >

                  {sites.length > 0 ? (

                    sites.map((site) => {

                      const checked =
                        selectedSiteIds.includes(
                          site.id
                        );

                      return (
                        <label
                          key={site.id}
                          className="
                            flex
                            items-center
                            gap-3
                            cursor-pointer
                            text-sm
                            rounded-md
                            p-2
                            hover:bg-muted/50
                          "
                        >

                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={editLoading}
                            onChange={() => {

                              setSelectedSiteIds(
                                (previous) => {

                                  if (
                                    previous.includes(
                                      site.id
                                    )
                                  ) {

                                    if (
                                      selectedResponsibleSiteId ===
                                      site.id
                                    ) {
                                      setSelectedResponsibleSiteId(
                                        null
                                      );
                                    }

                                    return previous.filter(
                                      (id) =>
                                        id !==
                                        site.id
                                    );
                                  }

                                  return [
                                    ...previous,
                                    site.id,
                                  ];
                                }
                              );

                            }}
                            className="h-4 w-4"
                          />

                          <Building2 className="h-4 w-4 text-muted-foreground" />

                          <span>
                            {site.name}
                          </span>

                        </label>
                      );
                    })

                  ) : (

                    <p className="text-xs text-muted-foreground text-center py-3">
                      Aucun site disponible.
                    </p>

                  )}

                </div>

                <p className="text-xs text-muted-foreground">
                  Un employé peut travailler sur plusieurs
                  sites. Au moins un site doit être sélectionné.
                </p>

              </div>

              {/* ==========================================
                  SITE RESPONSABLE
              ========================================== */}

              {(() => {

                const selectedPosition =
                  positions.find(
                    (position) =>
                      position.id ===
                      selectedPositionId
                  );

                const isResponsiblePosition =
                  selectedPosition?.name
                    .toLowerCase()
                    .trim() ===
                  'responsable';

                if (
                  !isResponsiblePosition
                ) {
                  return null;
                }

                const selectedSites =
                  sites.filter(
                    (site) =>
                      selectedSiteIds.includes(
                        site.id
                      )
                  );

                return (
                  <div className="space-y-2">

                    <label className="text-sm font-medium">
                      Site responsable
                    </label>

                    <Select
                      value={
                        selectedResponsibleSiteId ||
                        ''
                      }
                      onValueChange={
                        setSelectedResponsibleSiteId
                      }
                      disabled={
                        editLoading ||
                        selectedSites.length === 0
                      }
                    >

                      <SelectTrigger>
                        <SelectValue
                          placeholder="Sélectionner le site responsable"
                        />
                      </SelectTrigger>

                      <SelectContent>

                        {selectedSites.map(
                          (site) => (
                            <SelectItem
                              key={site.id}
                              value={site.id}
                            >
                              {site.name}
                            </SelectItem>
                          )
                        )}

                      </SelectContent>

                    </Select>

                    <p className="text-xs text-muted-foreground">
                      Le site responsable doit faire
                      partie des sites de travail sélectionnés.
                    </p>

                  </div>
                );

              })()}

            </div>

          )}

          <DialogFooter>

            <Button
              variant="outline"
              onClick={closeEditDialog}
              disabled={editLoading}
            >
              Annuler
            </Button>

            <Button
              onClick={
                handleUpdateEmployee
              }
              disabled={
                editLoading ||
                !editingEmployee ||
                selectedSiteIds.length === 0
              }
            >

              {editLoading && (
                <Loader2
                  className="
                    h-4
                    w-4
                    mr-2
                    animate-spin
                  "
                />
              )}

              Enregistrer

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

      {/* ====================================================
          DEACTIVATE / ACTIVATE
      ==================================================== */}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeActionDialog();
          }
        }}
      >

        <DialogContent>

          <DialogHeader>

            <DialogTitle>

              {dialogAction ===
                'deactivate'
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

                  {dialogAction ===
                    'deactivate'
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
              onClick={closeActionDialog}
              disabled={actionLoading}
            >
              Annuler
            </Button>

            <Button
              variant={
                dialogAction ===
                  'deactivate'
                  ? 'destructive'
                  : 'default'
              }
              onClick={
                handleConfirmAction
              }
              disabled={actionLoading}
            >

              {actionLoading && (
                <Loader2
                  className="
                    h-4
                    w-4
                    mr-2
                    animate-spin
                  "
                />
              )}

              {dialogAction ===
                'deactivate'
                ? 'Désactiver'
                : 'Réactiver'}

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

    </DashboardLayout>
  );
}