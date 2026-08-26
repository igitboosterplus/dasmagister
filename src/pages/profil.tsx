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

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import {
  User,
  Mail,
  Phone,
  Building2,
  BriefcaseBusiness,
  ShieldCheck,
  Save,
  Loader2,
  Lock,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Monitor,
} from 'lucide-react';


// ============================================================
// TYPES
// ============================================================

// type EmployeeRole = 'admin' | 'manager' | 'employee';

interface Structure {
  id: string;
  name: string;
  code: string | null;
}

interface City {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  type: string | null;
  work_start: string | null;
  work_end: string | null;
  is_active: boolean;
  city: City | null;
}

interface Service {
  id: string;
  name: string;
}

interface Position {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  auth_user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  structure_id: string | null;
  service_id: string | null;
  position_id: string | null;
  site_id: string | null;
  manager_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface EmployeeRole {
  id: string;
  employee_id: string;
  role: EmployeeRole;
  created_at: string;
}


// ============================================================
// HELPERS
// ============================================================

const getRoleLabel = (
  role: string | null | undefined
): string => {
  switch (role) {
    case 'admin':
      return 'Administrateur';

    case 'manager':
      return 'Manager';

    case 'employee':
      return 'Employé';

    default:
      return 'Utilisateur';
  }
};


const getRoleBadgeClass = (
  role: string | null | undefined
): string => {
  switch (role) {
    case 'admin':
      return 'bg-primary/10 text-primary';

    case 'manager':
      return 'bg-secondary/10 text-secondary';

    case 'employee':
      return 'bg-muted text-muted-foreground';

    default:
      return 'bg-muted text-muted-foreground';
  }
};


// ============================================================
// COMPONENT
// ============================================================

export default function Profile() {

  const {
    profile,
    role: authRole,
  } = useAuth();


  // ==========================================================
  // STATES
  // ==========================================================

  const [employee, setEmployee] =
    useState<Employee | null>(null);

  const [structure, setStructure] =
    useState<Structure | null>(null);

  const [service, setService] =
    useState<Service | null>(null);

  const [position, setPosition] =
    useState<Position | null>(null);

  const [site, setSite] =
    useState<Site | null>(null);

  const [employeeRole, setEmployeeRole] =
    useState<EmployeeRole | null>(null);


  // Informations modifiables

  const [firstName, setFirstName] =
    useState('');

  const [lastName, setLastName] =
    useState('');

  const [phone, setPhone] =
    useState('');


  // États

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);


  // ==========================================================
  // ROLE EFFECTIF
  // ==========================================================

  const currentRole: EmployeeRole =
    employeeRole?.role ||
    authRole ||
    'employee';


  // ==========================================================
  // EMAIL
  // ==========================================================

  const email =
    profile?.email || '';


  // ==========================================================
  // LOAD PROFILE
  // ==========================================================

  useEffect(() => {

    let mounted = true;


    const fetchProfileData = async () => {

      try {

        setLoading(true);
        setError(null);


        // ====================================================
        // UTILISATEUR AUTHENTIFIÉ
        // ====================================================

        const {
          data: {
            user,
          },
          error: authError,
        } = await supabase.auth.getUser();


        if (authError) {
          throw authError;
        }


        if (!user) {

          throw new Error(
            'Utilisateur non authentifié.'
          );

        }


        // ====================================================
        // EMPLOYEE
        // ====================================================

        /*
         * La liaison correcte avec Supabase Auth est :
         *
         * employees.auth_user_id = auth.uid()
         *
         * On ne dépend donc plus de profile.id.
         */

        const {
          data: employeeData,
          error: employeeError,
        } = await supabase
          .from('employees')
          .select(`
            id,
            auth_user_id,
            first_name,
            last_name,
            phone,
            structure_id,
            service_id,
            position_id,
            site_id,
            manager_id,
            is_active,
            created_at
          `)
          .eq(
            'auth_user_id',
            user.id
          )
          .maybeSingle();


        if (employeeError) {
          throw employeeError;
        }


        if (!employeeData) {

          throw new Error(
            'Aucun profil employé associé à votre compte.'
          );

        }


        if (!employeeData.is_active) {

          throw new Error(
            'Votre compte employé est actuellement désactivé.'
          );

        }


        if (!mounted) {
          return;
        }


        setEmployee(employeeData);


        // ====================================================
        // INFORMATIONS MODIFIABLES
        // ====================================================

        setFirstName(
          employeeData.first_name || ''
        );

        setLastName(
          employeeData.last_name || ''
        );

        setPhone(
          employeeData.phone || ''
        );


        // ====================================================
        // STRUCTURE
        // ====================================================

        if (employeeData.structure_id) {

          const {
            data: structureData,
            error: structureError,
          } = await supabase
            .from('structures')
            .select(`
              id,
              name,
              code
            `)
            .eq(
              'id',
              employeeData.structure_id
            )
            .maybeSingle();


          if (structureError) {

            console.error(
              'Erreur récupération structure:',
              structureError
            );

          } else if (mounted) {

            setStructure(
              structureData
            );

          }
        }


        // ====================================================
        // SERVICE
        // ====================================================

        if (employeeData.service_id) {

          const {
            data: serviceData,
            error: serviceError,
          } = await supabase
            .from('services')
            .select(`
              id,
              name
            `)
            .eq(
              'id',
              employeeData.service_id
            )
            .maybeSingle();


          if (serviceError) {

            console.error(
              'Erreur récupération service:',
              serviceError
            );

          } else if (mounted) {

            setService(
              serviceData
            );

          }
        }


        // ====================================================
        // POSITION
        // ====================================================

        if (employeeData.position_id) {

          const {
            data: positionData,
            error: positionError,
          } = await supabase
            .from('positions')
            .select(`
              id,
              name
            `)
            .eq(
              'id',
              employeeData.position_id
            )
            .maybeSingle();


          if (positionError) {

            console.error(
              'Erreur récupération poste:',
              positionError
            );

          } else if (mounted) {

            setPosition(
              positionData
            );

          }
        }


        // ====================================================
        // SITE + VILLE
        // ====================================================

        if (employeeData.site_id) {

          const {
            data: siteData,
            error: siteError,
          } = await supabase
            .from('sites')
            .select(`
              id,
              name,
              type,
              work_start,
              work_end,
              is_active,
              city_id
            `)
            .eq(
              'id',
              employeeData.site_id
            )
            .maybeSingle();


          if (siteError) {

            console.error(
              'Erreur récupération site:',
              siteError
            );

          } else if (siteData) {

            let cityData: City | null = null;


            // ==============================================
            // CITY
            // ==============================================

            if (siteData.city_id) {

              const {
                data,
                error: cityError,
              } = await supabase
                .from('cities')
                .select(`
                  id,
                  name
                `)
                .eq(
                  'id',
                  siteData.city_id
                )
                .maybeSingle();


              if (cityError) {

                console.error(
                  'Erreur récupération ville:',
                  cityError
                );

              } else {

                cityData = data;

              }
            }


            if (mounted) {

              setSite({
                id: siteData.id,
                name: siteData.name,
                type: siteData.type,
                work_start:
                  siteData.work_start,
                work_end:
                  siteData.work_end,
                is_active:
                  siteData.is_active,
                city: cityData,
              });

            }
          }
        }


        // ====================================================
        // ROLE
        // ====================================================

        const {
          data: roleData,
          error: roleError,
        } = await supabase
          .from('employee_roles')
          .select(`
            id,
            employee_id,
            role,
            created_at
          `)
          .eq(
            'employee_id',
            employeeData.id
          )
          .maybeSingle();


        if (roleError) {

          console.error(
            'Erreur récupération rôle:',
            roleError
          );

        } else if (mounted) {

          setEmployeeRole(
            roleData as EmployeeRole | null
          );

        }

      } catch (err: any) {

        console.error(
          'Erreur chargement profil:',
          err
        );


        if (mounted) {

          setError(
            err?.message ||
            'Impossible de charger les informations du profil.'
          );

        }

      } finally {

        if (mounted) {
          setLoading(false);
        }

      }
    };


    fetchProfileData();


    return () => {

      mounted = false;

    };

  }, [profile?.id]);


  // ==========================================================
  // UPDATE PROFILE
  // ==========================================================

  const handleSave = async () => {

    if (!employee?.id) {

      setError(
        'Impossible de déterminer votre profil employé.'
      );

      return;

    }


    // ========================================================
    // VALIDATION
    // ========================================================

    const cleanFirstName =
      firstName.trim();

    const cleanLastName =
      lastName.trim();

    const cleanPhone =
      phone.trim();


    if (!cleanFirstName) {

      setError(
        'Le prénom est obligatoire.'
      );

      return;

    }


    if (!cleanLastName) {

      setError(
        'Le nom est obligatoire.'
      );

      return;

    }


    // ========================================================
    // SAVE
    // ========================================================

    try {

      setSaving(true);
      setSuccess(null);
      setError(null);


      /*
       * IMPORTANT :
       *
       * On utilise employee.id.
       *
       * employee.id est la clé primaire de employees.
       *
       * On ne fait PAS :
       *
       * .eq('id', profile.id)
       *
       * car profile.id peut représenter autre chose
       * selon la structure de useAuth.
       */

      const {
        data: updatedEmployee,
        error: updateError,
      } = await supabase
        .from('employees')
        .update({
          first_name:
            cleanFirstName,

          last_name:
            cleanLastName,

          phone:
            cleanPhone || null,
        })
        .eq(
          'id',
          employee.id
        )
        .select(`
          id,
          auth_user_id,
          first_name,
          last_name,
          phone,
          structure_id,
          service_id,
          position_id,
          site_id,
          manager_id,
          is_active,
          created_at
        `)
        .single();


      if (updateError) {
        throw updateError;
      }


      // ======================================================
      // UPDATE LOCAL STATE
      // ======================================================

      if (updatedEmployee) {

        setEmployee(
          updatedEmployee
        );

        setFirstName(
          updatedEmployee.first_name || ''
        );

        setLastName(
          updatedEmployee.last_name || ''
        );

        setPhone(
          updatedEmployee.phone || ''
        );

      }


      setSuccess(
        'Votre profil a été mis à jour avec succès.'
      );


      // Masquer automatiquement le message
      // après quelques secondes

      setTimeout(() => {

        setSuccess(null);

      }, 5000);


    } catch (err: any) {

      console.error(
        'Erreur mise à jour profil:',
        err
      );


      /*
       * Gestion spécifique des erreurs RLS.
       */

      if (
        err?.code === '42501' ||
        err?.code === 'PGRST301'
      ) {

        setError(
          'Vous n’avez pas l’autorisation de modifier ce profil. Vérifiez les policies RLS de la table employees.'
        );

      } else {

        setError(
          err?.message ||
          'Impossible de mettre à jour votre profil.'
        );

      }

    } finally {

      setSaving(false);

    }

  };


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {

    return (

      <DashboardLayout>

        <div
          className="
            flex
            items-center
            justify-center
            py-20
          "
        >

          <Loader2
            className="
              h-8
              w-8
              animate-spin
              text-primary
            "
          />

        </div>

      </DashboardLayout>

    );

  }


  // ==========================================================
  // NO PROFILE
  // ==========================================================

  if (!employee) {

    return (

      <DashboardLayout>

        <div
          className="
            flex
            flex-col
            items-center
            justify-center
            py-20
            text-center
          "
        >

          <AlertTriangle
            className="
              h-10
              w-10
              text-destructive
              mb-4
            "
          />

          <p
            className="
              text-muted-foreground
            "
          >

            {error ||
              'Impossible de récupérer votre profil.'}

          </p>

        </div>

      </DashboardLayout>

    );

  }


  // ==========================================================
  // RENDER
  // ==========================================================

  return (

    <DashboardLayout>

      <div
        className="
          max-w-5xl
          mx-auto
          animate-fade-in
        "
      >

        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="mb-8">

          <h1 className="page-title">
            Mon profil
          </h1>

          <p
            className="
              text-muted-foreground
              mt-1
            "
          >

            Consultez et gérez vos informations personnelles.

          </p>

        </div>


        {/* ====================================================
            SUCCESS
        ==================================================== */}

        {success && (

          <div
            className="
              mb-6
              flex
              items-center
              gap-3
              rounded-lg
              border
              border-success/20
              bg-success/5
              p-4
              text-sm
            "
          >

            <CheckCircle
              className="
                h-5
                w-5
                text-success
              "
            />

            <span>
              {success}
            </span>

          </div>

        )}


        {/* ====================================================
            ERROR
        ==================================================== */}

        {error && (

          <div
            className="
              mb-6
              flex
              items-center
              gap-3
              rounded-lg
              border
              border-destructive/20
              bg-destructive/5
              p-4
              text-sm
              text-destructive
            "
          >

            <AlertTriangle
              className="
                h-5
                w-5
              "
            />

            <span>
              {error}
            </span>

          </div>

        )}


        <div
          className="
            grid
            grid-cols-1
            lg:grid-cols-3
            gap-6
          "
        >


          {/* ==================================================
              CARD IDENTITÉ
          ================================================== */}

          <Card
            className="
              lg:col-span-1
            "
          >

            <CardContent className="pt-6">

              <div
                className="
                  flex
                  flex-col
                  items-center
                  text-center
                "
              >

                {/* AVATAR */}

                <div
                  className="
                    flex
                    h-24
                    w-24
                    items-center
                    justify-center
                    rounded-full
                    bg-primary/10
                    text-primary
                    mb-4
                  "
                >

                  <User
                    className="
                      h-10
                      w-10
                    "
                  />

                </div>


                {/* NOM */}

                <h2
                  className="
                    text-xl
                    font-semibold
                  "
                >

                  {employee.first_name || ''}
                  {' '}
                  {employee.last_name || ''}

                </h2>


                {/* EMAIL */}

                <p
                  className="
                    mt-1
                    text-sm
                    text-muted-foreground
                  "
                >

                  {email || '—'}

                </p>


                {/* ROLE */}

                <Badge
                  className={`
                    mt-4
                    ${getRoleBadgeClass(
                      currentRole
                    )}
                  `}
                >

                  {getRoleLabel(
                    currentRole
                  )}

                </Badge>


                {/* STRUCTURE */}

                <div
                  className="
                    mt-6
                    w-full
                    rounded-lg
                    bg-muted/40
                    p-4
                    text-left
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      mb-2
                    "
                  >

                    <Building2
                      className="
                        h-4
                        w-4
                        text-primary
                      "
                    />

                    <span
                      className="
                        text-sm
                        font-medium
                      "
                    >

                      Structure

                    </span>

                  </div>


                  <p
                    className="
                      text-sm
                      text-muted-foreground
                    "
                  >

                    {structure?.name || 'Aucune structure'}

                  </p>


                  {structure?.code && (

                    <p
                      className="
                        mt-1
                        text-xs
                        text-muted-foreground
                      "
                    >

                      Code : {structure.code}

                    </p>

                  )}

                </div>

              </div>

            </CardContent>

          </Card>


          {/* ==================================================
              INFORMATIONS PERSONNELLES
          ================================================== */}

          <Card
            className="
              lg:col-span-2
            "
          >

            <CardHeader>

              <CardTitle
                className="
                  flex
                  items-center
                  gap-2
                "
              >

                <User
                  className="
                    h-5
                    w-5
                    text-primary
                  "
                />

                Informations personnelles

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div
                className="
                  grid
                  grid-cols-1
                  md:grid-cols-2
                  gap-5
                "
              >

                {/* PRÉNOM */}

                <div className="space-y-2">

                  <Label htmlFor="first_name">
                    Prénom
                  </Label>

                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) =>
                      setFirstName(
                        e.target.value
                      )
                    }
                    disabled={saving}
                  />

                </div>


                {/* NOM */}

                <div className="space-y-2">

                  <Label htmlFor="last_name">
                    Nom
                  </Label>

                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) =>
                      setLastName(
                        e.target.value
                      )
                    }
                    disabled={saving}
                  />

                </div>


                {/* EMAIL */}

                <div className="space-y-2">

                  <Label>
                    Adresse email
                  </Label>

                  <div className="relative">

                    <Mail
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
                      value={email}
                      disabled
                      className="pl-9"
                    />

                  </div>

                  <p
                    className="
                      text-xs
                      text-muted-foreground
                    "
                  >

                    L'adresse email est gérée par
                    le système d'authentification.

                  </p>

                </div>


                {/* TÉLÉPHONE */}

                <div className="space-y-2">

                  <Label htmlFor="phone">
                    Téléphone
                  </Label>

                  <div className="relative">

                    <Phone
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
                      id="phone"
                      value={phone}
                      onChange={(e) =>
                        setPhone(
                          e.target.value
                        )
                      }
                      className="pl-9"
                      disabled={saving}
                    />

                  </div>

                </div>

              </div>


              {/* SAVE */}

              <div
                className="
                  flex
                  justify-end
                  mt-6
                "
              >

                <Button
                  onClick={handleSave}
                  disabled={saving}
                >

                  {saving ? (

                    <Loader2
                      className="
                        mr-2
                        h-4
                        w-4
                        animate-spin
                      "
                    />

                  ) : (

                    <Save
                      className="
                        mr-2
                        h-4
                        w-4
                      "
                    />

                  )}


                  {saving
                    ? 'Enregistrement...'
                    : 'Enregistrer'}

                </Button>

              </div>

            </CardContent>

          </Card>


          {/* ==================================================
              INFORMATIONS PROFESSIONNELLES
          ================================================== */}

          <Card
            className="
              lg:col-span-3
            "
          >

            <CardHeader>

              <CardTitle
                className="
                  flex
                  items-center
                  gap-2
                "
              >

                <BriefcaseBusiness
                  className="
                    h-5
                    w-5
                    text-primary
                  "
                />

                Informations professionnelles

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div
                className="
                  grid
                  grid-cols-1
                  md:grid-cols-2
                  lg:grid-cols-4
                  gap-4
                "
              >

                {/* STRUCTURE */}

                <div
                  className="
                    rounded-lg
                    border
                    p-4
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      mb-2
                    "
                  >

                    <Building2
                      className="
                        h-4
                        w-4
                        text-primary
                      "
                    />

                    <span
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      Structure

                    </span>

                  </div>

                  <p className="font-medium">

                    {structure?.name || '—'}

                  </p>

                </div>


                {/* SERVICE */}

                <div
                  className="
                    rounded-lg
                    border
                    p-4
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      mb-2
                    "
                  >

                    <BriefcaseBusiness
                      className="
                        h-4
                        w-4
                        text-primary
                      "
                    />

                    <span
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      Service

                    </span>

                  </div>

                  <p className="font-medium">

                    {service?.name || '—'}

                  </p>

                </div>


                {/* POSTE */}

                <div
                  className="
                    rounded-lg
                    border
                    p-4
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      mb-2
                    "
                  >

                    <User
                      className="
                        h-4
                        w-4
                        text-primary
                      "
                    />

                    <span
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      Poste

                    </span>

                  </div>

                  <p className="font-medium">

                    {position?.name || '—'}

                  </p>

                </div>


                {/* SITE */}

                <div
                  className="
                    rounded-lg
                    border
                    p-4
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      mb-2
                    "
                  >

                    <Monitor
                      className="
                        h-4
                        w-4
                        text-primary
                      "
                    />

                    <span
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      Site

                    </span>

                  </div>

                  <p className="font-medium">

                    {site?.name || '—'}

                  </p>

                </div>

              </div>


              {/* ==================================================
                  LOCALISATION
              ================================================== */}

              {site && (

                <div
                  className="
                    mt-5
                    grid
                    grid-cols-1
                    md:grid-cols-2
                    gap-4
                  "
                >

                  {/* VILLE */}

                  <div
                    className="
                      flex
                      items-center
                      gap-3
                      rounded-lg
                      border
                      p-4
                    "
                  >

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

                      <MapPin
                        className="
                          h-5
                          w-5
                          text-primary
                        "
                      />

                    </div>


                    <div>

                      <p
                        className="
                          text-sm
                          font-medium
                        "
                      >

                        Ville

                      </p>

                      <p
                        className="
                          text-xs
                          text-muted-foreground
                        "
                      >

                        {site.city?.name || '—'}

                      </p>

                    </div>

                  </div>


                  {/* TYPE DE SITE */}

                  <div
                    className="
                      flex
                      items-center
                      gap-3
                      rounded-lg
                      border
                      p-4
                    "
                  >

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

                      <Building2
                        className="
                          h-5
                          w-5
                          text-primary
                        "
                      />

                    </div>


                    <div>

                      <p
                        className="
                          text-sm
                          font-medium
                        "
                      >

                        Type de site

                      </p>

                      <p
                        className="
                          text-xs
                          text-muted-foreground
                        "
                      >

                        {site.type || '—'}

                      </p>

                    </div>

                  </div>

                </div>

              )}


              {/* ==================================================
                  HORAIRES DU SITE
              ================================================== */}

              {site &&
                (site.work_start ||
                  site.work_end) && (

                  <div
                    className="
                      mt-5
                      rounded-lg
                      border
                      bg-muted/30
                      p-4
                    "
                  >

                    <div
                      className="
                        flex
                        items-center
                        gap-2
                        mb-2
                      "
                    >

                      <BriefcaseBusiness
                        className="
                          h-4
                          w-4
                          text-primary
                        "
                      />

                      <span
                        className="
                          text-sm
                          font-medium
                        "
                      >

                        Horaires du site

                      </span>

                    </div>


                    <p
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      {site.work_start || '—'}
                      {' → '}
                      {site.work_end || '—'}

                    </p>

                  </div>

                )}


              {/* ==================================================
                  MANAGER
              ================================================== */}

              {currentRole === 'manager' && (

                <div
                  className="
                    mt-5
                    rounded-lg
                    border
                    border-primary/20
                    bg-primary/5
                    p-4
                  "
                >

                  <div
                    className="
                      flex
                      items-start
                      gap-3
                    "
                  >

                    <Building2
                      className="
                        h-5
                        w-5
                        text-primary
                        mt-0.5
                      "
                    />

                    <div>

                      <p className="font-medium">

                        Responsable de structure

                      </p>

                      <p
                        className="
                          text-sm
                          text-muted-foreground
                          mt-1
                        "
                      >

                        Vous êtes responsable de la
                        gestion de votre structure et
                        avez accès aux données associées
                        à celle-ci selon vos permissions.

                      </p>

                    </div>

                  </div>

                </div>

              )}

            </CardContent>

          </Card>


          {/* ==================================================
              SÉCURITÉ
          ================================================== */}

          <Card
            className="
              lg:col-span-3
            "
          >

            <CardHeader>

              <CardTitle
                className="
                  flex
                  items-center
                  gap-2
                "
              >

                <ShieldCheck
                  className="
                    h-5
                    w-5
                    text-primary
                  "
                />

                Sécurité du compte

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div
                className="
                  grid
                  grid-cols-1
                  md:grid-cols-3
                  gap-4
                "
              >

                {/* EMAIL */}

                <div
                  className="
                    flex
                    items-center
                    gap-3
                    rounded-lg
                    border
                    p-4
                  "
                >

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

                    <Mail
                      className="
                        h-5
                        w-5
                        text-primary
                      "
                    />

                  </div>


                  <div>

                    <p
                      className="
                        text-sm
                        font-medium
                      "
                    >

                      Adresse de connexion

                    </p>

                    <p
                      className="
                        text-xs
                        text-muted-foreground
                      "
                    >

                      {email || '—'}

                    </p>

                  </div>

                </div>


                {/* ROLE */}

                <div
                  className="
                    flex
                    items-center
                    gap-3
                    rounded-lg
                    border
                    p-4
                  "
                >

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

                    <Lock
                      className="
                        h-5
                        w-5
                        text-primary
                      "
                    />

                  </div>


                  <div>

                    <p
                      className="
                        text-sm
                        font-medium
                      "
                    >

                      Niveau d'accès

                    </p>

                    <p
                      className="
                        text-xs
                        text-muted-foreground
                      "
                    >

                      {getRoleLabel(
                        currentRole
                      )}

                    </p>

                  </div>

                </div>


                {/* STATUT */}

                <div
                  className="
                    flex
                    items-center
                    gap-3
                    rounded-lg
                    border
                    p-4
                  "
                >

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

                    <ShieldCheck
                      className="
                        h-5
                        w-5
                        text-primary
                      "
                    />

                  </div>


                  <div>

                    <p
                      className="
                        text-sm
                        font-medium
                      "
                    >

                      Statut du compte

                    </p>

                    <p
                      className="
                        text-xs
                        text-muted-foreground
                      "
                    >

                      {employee.is_active
                        ? 'Actif'
                        : 'Désactivé'}

                    </p>

                  </div>

                </div>

              </div>


              {/* INFORMATION */}

              <div
                className="
                  mt-5
                  rounded-lg
                  bg-muted/50
                  p-4
                "
              >

                <p
                  className="
                    text-sm
                    text-muted-foreground
                  "
                >

                  Vous pouvez modifier votre prénom,
                  votre nom et votre numéro de téléphone.
                  Votre rôle, votre structure, votre
                  service, votre poste, votre site et vos
                  permissions sont gérés par
                  l'administration.

                </p>

              </div>

            </CardContent>

          </Card>

        </div>

      </div>

    </DashboardLayout>

  );

}