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

import {
  User,
  Mail,
  Phone,
  Building2,
  BriefcaseBusiness,
  MapPin,
  ShieldCheck,
  Save,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Store,
  Users,
} from 'lucide-react';


// ============================================================
// TYPES
// ============================================================

interface EmployeeProfile {
  id: string;
  auth_user_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  structure_id: string | null;
  service_id: string | null;
  position_id: string | null;
  site_id: string | null;
  manager_id: string | null;
  is_active: boolean;
}

interface Structure {
  id: string;
  name: string;
  code: string;
}

interface Service {
  id: string;
  name: string;
}

interface Position {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  type: string;
  city_id: string;
}

interface City {
  id: string;
  name: string;
}

interface Manager {
  id: string;
  first_name: string;
  last_name: string;
}


// ============================================================
// HELPERS
// ============================================================

const getRoleLabel = (role: string | null) => {
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


const getRoleClass = (role: string | null) => {
  switch (role) {
    case 'admin':
      return 'bg-primary/10 text-primary';

    case 'manager':
      return 'bg-secondary/10 text-secondary';

    default:
      return 'bg-muted text-muted-foreground';
  }
};


// ============================================================
// COMPONENT
// ============================================================

export default function Profile() {

  const {
    role,
  } = useAuth();


  // ==========================================================
  // AUTH
  // ==========================================================

  const [authEmail, setAuthEmail] =
    useState<string>('');


  // ==========================================================
  // EMPLOYEE
  // ==========================================================

  const [employee, setEmployee] =
    useState<EmployeeProfile | null>(null);


  // ==========================================================
  // RELATED DATA
  // ==========================================================

  const [structure, setStructure] =
    useState<Structure | null>(null);

  const [service, setService] =
    useState<Service | null>(null);

  const [position, setPosition] =
    useState<Position | null>(null);

  const [site, setSite] =
    useState<Site | null>(null);

  const [city, setCity] =
    useState<City | null>(null);

  const [manager, setManager] =
    useState<Manager | null>(null);


  // ==========================================================
  // FORM
  // ==========================================================

  const [firstName, setFirstName] =
    useState('');

  const [lastName, setLastName] =
    useState('');

  const [phone, setPhone] =
    useState('');


  // ==========================================================
  // UI
  // ==========================================================

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [success, setSuccess] =
    useState('');

  const [error, setError] =
    useState('');


  // ==========================================================
  // LOAD PROFILE
  // ==========================================================

  useEffect(() => {

    const loadProfile = async () => {

      try {

        setLoading(true);
        setError('');


        // ====================================================
        // 1. RÉCUPÉRER L'UTILISATEUR SUPABASE AUTH
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


        // L'email vient de Supabase Auth
        setAuthEmail(
          user.email || ''
        );


        // ====================================================
        // 2. RÉCUPÉRER L'EMPLOYÉ
        // ====================================================

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
            is_active
          `)
          .eq(
            'auth_user_id',
            user.id
          )
          .single();


        if (employeeError) {
          throw employeeError;
        }


        if (!employeeData) {
          throw new Error(
            'Profil employé introuvable.'
          );
        }


        setEmployee(
          employeeData
        );


        // ====================================================
        // FORM
        // ====================================================

        setFirstName(
          employeeData.first_name
        );

        setLastName(
          employeeData.last_name
        );

        setPhone(
          employeeData.phone || ''
        );


        // ====================================================
        // 3. STRUCTURE
        // ====================================================

        if (employeeData.structure_id) {

          const {
            data,
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
            .single();


          if (data) {
            setStructure(data);
          }
        }


        // ====================================================
        // 4. SERVICE
        // ====================================================

        if (employeeData.service_id) {

          const {
            data,
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
            .single();


          if (data) {
            setService(data);
          }
        }


        // ====================================================
        // 5. POSTE
        // ====================================================

        if (employeeData.position_id) {

          const {
            data,
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
            .single();


          if (data) {
            setPosition(data);
          }
        }


        // ====================================================
        // 6. SITE
        // ====================================================

        if (employeeData.site_id) {

          const {
            data,
          } = await supabase
            .from('sites')
            .select(`
              id,
              name,
              type,
              city_id
            `)
            .eq(
              'id',
              employeeData.site_id
            )
            .single();


          if (data) {

            setSite(data);


            // ================================================
            // VILLE DU SITE
            // ================================================

            if (data.city_id) {

              const {
                data: cityData,
              } = await supabase
                .from('cities')
                .select(`
                  id,
                  name
                `)
                .eq(
                  'id',
                  data.city_id
                )
                .single();


              if (cityData) {
                setCity(cityData);
              }
            }
          }
        }


        // ====================================================
        // 7. MANAGER
        // ====================================================

        if (employeeData.manager_id) {

          const {
            data,
          } = await supabase
            .from('employees')
            .select(`
              id,
              first_name,
              last_name
            `)
            .eq(
              'id',
              employeeData.manager_id
            )
            .single();


          if (data) {
            setManager(data);
          }
        }


      } catch (err: any) {

        console.error(
          'Erreur chargement profil:',
          err
        );

        setError(
          err?.message ||
          'Impossible de charger votre profil.'
        );

      } finally {

        setLoading(false);

      }
    };


    loadProfile();

  }, []);


  // ==========================================================
  // SAVE PROFILE
  // ==========================================================

  const handleSave = async () => {

    setSaving(true);
    setSuccess('');
    setError('');


    try {

      if (!firstName.trim()) {
        throw new Error(
          'Le prénom est obligatoire.'
        );
      }


      if (!lastName.trim()) {
        throw new Error(
          'Le nom est obligatoire.'
        );
      }


      // ====================================================
      // UTILISATION DE LA FONCTION SQL SÉCURISÉE
      // ====================================================

      const {
        error: rpcError,
      } = await supabase.rpc(
        'update_my_profile',
        {
          p_first_name:
            firstName.trim(),

          p_last_name:
            lastName.trim(),

          p_phone:
            phone.trim(),
        }
      );


      if (rpcError) {
        throw rpcError;
      }


      // ====================================================
      // METTRE À JOUR L'ÉTAT LOCAL
      // ====================================================

      setEmployee((current) => {

        if (!current) {
          return current;
        }

        return {
          ...current,
          first_name:
            firstName.trim(),
          last_name:
            lastName.trim(),
          phone:
            phone.trim() || null,
        };

      });


      setSuccess(
        'Votre profil a été mis à jour avec succès.'
      );


    } catch (err: any) {

      console.error(
        'Erreur mise à jour profil:',
        err
      );

      setError(
        err?.message ||
        'Impossible de mettre à jour votre profil.'
      );

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

        <div className="
          flex
          items-center
          justify-center
          py-20
        ">

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
  // ERROR
  // ==========================================================

  if (!employee) {

    return (
      <DashboardLayout>

        <div className="
          max-w-3xl
          mx-auto
          py-12
        ">

          <Card>

            <CardContent className="
              flex
              flex-col
              items-center
              justify-center
              py-12
              text-center
            ">

              <AlertTriangle className="
                h-10
                w-10
                text-destructive
                mb-4
              " />

              <h2 className="
                text-lg
                font-semibold
              ">

                Profil indisponible

              </h2>

              <p className="
                mt-2
                text-sm
                text-muted-foreground
              ">

                {error ||
                  'Impossible de récupérer votre profil.'}

              </p>

            </CardContent>

          </Card>

        </div>

      </DashboardLayout>
    );
  }


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <DashboardLayout>

      <div className="
        max-w-6xl
        mx-auto
        animate-fade-in
      ">


        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="mb-8">

          <h1 className="page-title">
            Mon profil
          </h1>

          <p className="
            mt-1
            text-muted-foreground
          ">

            Consultez vos informations personnelles
            et professionnelles.

          </p>

        </div>


        {/* ====================================================
            ALERTS
        ==================================================== */}

        {success && (

          <div className="
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
          ">

            <CheckCircle className="
              h-5
              w-5
              text-success
            " />

            <span>
              {success}
            </span>

          </div>

        )}


        {error && (

          <div className="
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
          ">

            <AlertTriangle className="
              h-5
              w-5
            " />

            <span>
              {error}
            </span>

          </div>

        )}


        <div className="
          grid
          grid-cols-1
          lg:grid-cols-3
          gap-6
        ">


          {/* ==================================================
              IDENTITÉ
          ================================================== */}

          <Card>

            <CardContent className="pt-6">

              <div className="
                flex
                flex-col
                items-center
                text-center
              ">


                <div className="
                  flex
                  h-24
                  w-24
                  items-center
                  justify-center
                  rounded-full
                  bg-primary/10
                  text-primary
                  mb-4
                ">

                  <User className="
                    h-10
                    w-10
                  " />

                </div>


                <h2 className="
                  text-xl
                  font-semibold
                ">

                  {employee.first_name}{' '}
                  {employee.last_name}

                </h2>


                {/* EMAIL SUPABASE AUTH */}

                <div className="
                  flex
                  items-center
                  gap-2
                  mt-2
                  text-sm
                  text-muted-foreground
                ">

                  <Mail className="
                    h-4
                    w-4
                  " />

                  <span>
                    {authEmail || '—'}
                  </span>

                </div>


                {/* ROLE */}

                <span className={`
                  mt-4
                  inline-flex
                  items-center
                  rounded-full
                  px-3
                  py-1
                  text-xs
                  font-medium
                  ${getRoleClass(role)}
                `}>

                  <ShieldCheck className="
                    h-3.5
                    w-3.5
                    mr-1.5
                  " />

                  {getRoleLabel(role)}

                </span>


                {/* STATUT */}

                <div className="
                  mt-5
                  flex
                  items-center
                  gap-2
                  text-sm
                ">

                  <span className={`
                    h-2
                    w-2
                    rounded-full
                    ${
                      employee.is_active
                        ? 'bg-success'
                        : 'bg-destructive'
                    }
                  `} />

                  <span className="
                    text-muted-foreground
                  ">

                    {employee.is_active
                      ? 'Compte actif'
                      : 'Compte désactivé'}

                  </span>

                </div>

              </div>

            </CardContent>

          </Card>


          {/* ==================================================
              INFORMATIONS PERSONNELLES
          ================================================== */}

          <Card className="
            lg:col-span-2
          ">

            <CardHeader>

              <CardTitle className="
                flex
                items-center
                gap-2
              ">

                <User className="
                  h-5
                  w-5
                  text-primary
                " />

                Informations personnelles

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div className="
                grid
                grid-cols-1
                md:grid-cols-2
                gap-5
              ">


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
                  />

                </div>


                {/* EMAIL */}

                <div className="space-y-2">

                  <Label>
                    Adresse email
                  </Label>

                  <div className="relative">

                    <Mail className="
                      absolute
                      left-3
                      top-1/2
                      -translate-y-1/2
                      h-4
                      w-4
                      text-muted-foreground
                    " />

                    <Input
                      value={authEmail}
                      disabled
                      className="pl-9"
                    />

                  </div>

                  <p className="
                    text-xs
                    text-muted-foreground
                  ">

                    Cette adresse est gérée par
                    Supabase Authentication.

                  </p>

                </div>


                {/* TÉLÉPHONE */}

                <div className="space-y-2">

                  <Label htmlFor="phone">
                    Téléphone
                  </Label>

                  <div className="relative">

                    <Phone className="
                      absolute
                      left-3
                      top-1/2
                      -translate-y-1/2
                      h-4
                      w-4
                      text-muted-foreground
                    " />

                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) =>
                        setPhone(
                          e.target.value
                        )
                      }
                      className="pl-9"
                    />

                  </div>

                </div>

              </div>


              <div className="
                flex
                justify-end
                mt-6
              ">

                <Button
                  onClick={handleSave}
                  disabled={saving}
                >

                  {saving ? (

                    <Loader2 className="
                      mr-2
                      h-4
                      w-4
                      animate-spin
                    " />

                  ) : (

                    <Save className="
                      mr-2
                      h-4
                      w-4
                    " />

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

          <Card className="
            lg:col-span-3
          ">

            <CardHeader>

              <CardTitle className="
                flex
                items-center
                gap-2
              ">

                <BriefcaseBusiness className="
                  h-5
                  w-5
                  text-primary
                " />

                Informations professionnelles

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div className="
                grid
                grid-cols-1
                sm:grid-cols-2
                lg:grid-cols-4
                gap-4
              ">


                {/* STRUCTURE */}

                <InfoCard
                  icon={<Building2 className="h-5 w-5" />}
                  label="Structure"
                  value={
                    structure
                      ? structure.name
                      : 'Aucune structure'
                  }
                />


                {/* SERVICE */}

                <InfoCard
                  icon={<Users className="h-5 w-5" />}
                  label="Service"
                  value={
                    service?.name ||
                    'Non affecté'
                  }
                />


                {/* POSTE */}

                <InfoCard
                  icon={
                    <BriefcaseBusiness className="h-5 w-5" />
                  }
                  label="Poste"
                  value={
                    position?.name ||
                    'Non affecté'
                  }
                />


                {/* SITE */}

                <InfoCard
                  icon={<Store className="h-5 w-5" />}
                  label="Site"
                  value={
                    site?.name ||
                    'Non affecté'
                  }
                />

              </div>


              {/* =================================================
                  VILLE + MANAGER
              ================================================= */}

              <div className="
                grid
                grid-cols-1
                md:grid-cols-2
                gap-4
                mt-4
              ">


                {/* VILLE */}

                <div className="
                  rounded-lg
                  border
                  p-4
                ">

                  <div className="
                    flex
                    items-center
                    gap-2
                    mb-2
                  ">

                    <MapPin className="
                      h-4
                      w-4
                      text-primary
                    " />

                    <span className="
                      text-sm
                      text-muted-foreground
                    ">

                      Ville du site

                    </span>

                  </div>

                  <p className="
                    font-medium
                  ">

                    {city?.name ||
                      'Non affectée'}

                  </p>

                </div>


                {/* MANAGER */}

                <div className="
                  rounded-lg
                  border
                  p-4
                ">

                  <div className="
                    flex
                    items-center
                    gap-2
                    mb-2
                  ">

                    <User className="
                      h-4
                      w-4
                      text-primary
                    " />

                    <span className="
                      text-sm
                      text-muted-foreground
                    ">

                      Responsable

                    </span>

                  </div>

                  <p className="
                    font-medium
                  ">

                    {manager
                      ? `${manager.first_name} ${manager.last_name}`
                      : role === 'admin'
                        ? 'Administration'
                        : 'Non affecté'}

                  </p>

                </div>

              </div>


              {/* =================================================
                  MESSAGE SELON ROLE
              ================================================= */}

              <div className="
                mt-6
                rounded-lg
                bg-muted/50
                p-4
              ">

                <p className="
                  text-sm
                  text-muted-foreground
                ">

                  {role === 'admin'
                    ? 'Les informations professionnelles sont gérées par l’administration.'
                    : role === 'manager'
                      ? 'Votre structure et vos affectations sont gérées par l’administration.'
                      : 'Votre structure, votre service, votre poste et votre site sont gérés par votre responsable.'}

                </p>

              </div>

            </CardContent>

          </Card>


          {/* ==================================================
              SÉCURITÉ
          ================================================== */}

          <Card className="
            lg:col-span-3
          ">

            <CardHeader>

              <CardTitle className="
                flex
                items-center
                gap-2
              ">

                <ShieldCheck className="
                  h-5
                  w-5
                  text-primary
                " />

                Sécurité du compte

              </CardTitle>

            </CardHeader>


            <CardContent>

              <div className="
                grid
                grid-cols-1
                md:grid-cols-3
                gap-4
              ">


                <InfoCard
                  icon={<Mail className="h-5 w-5" />}
                  label="Email de connexion"
                  value={authEmail || '—'}
                />


                <InfoCard
                  icon={<ShieldCheck className="h-5 w-5" />}
                  label="Rôle"
                  value={getRoleLabel(role)}
                />


                <InfoCard
                  icon={<CheckCircle className="h-5 w-5" />}
                  label="État du compte"
                  value={
                    employee.is_active
                      ? 'Actif'
                      : 'Désactivé'
                  }
                />

              </div>


              <div className="
                mt-5
                rounded-lg
                border
                border-primary/20
                bg-primary/5
                p-4
              ">

                <p className="
                  text-sm
                  text-muted-foreground
                ">

                  Votre adresse email est gérée par
                  Supabase Authentication. Votre rôle,
                  votre structure, votre service, votre
                  poste, votre site et votre responsable
                  sont des informations administratives
                  qui ne peuvent pas être modifiées depuis
                  cette page.

                </p>

              </div>

            </CardContent>

          </Card>

        </div>

      </div>

    </DashboardLayout>
  );
}


// ============================================================
// INFO CARD
// ============================================================

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoCard({
  icon,
  label,
  value,
}: InfoCardProps) {

  return (
    <div className="
      rounded-lg
      border
      p-4
    ">

      <div className="
        flex
        items-center
        gap-2
        mb-2
      ">

        <span className="
          text-primary
        ">

          {icon}

        </span>

        <span className="
          text-sm
          text-muted-foreground
        ">

          {label}

        </span>

      </div>

      <p className="
        font-medium
        truncate
      ">

        {value}

      </p>

    </div>
  );
}