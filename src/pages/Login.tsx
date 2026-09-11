import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';

import { useToast } from '@/hooks/use-toast';

import {
  LogIn,
  UserPlus,
  Loader2,
  Building2,
  ShieldCheck,
} from 'lucide-react';

import guimsLogo from '@/assets/guims-logo.png';


// ============================================================
// TYPES
// ============================================================

interface Structure {
  id: string;
  name: string;
  code: string;
}

interface EmployeeAuthProfile {
  id: string;
  role: string;
  structure_id: string | null;
  is_active: boolean;
}


// ============================================================
// COMPONENT
// ============================================================

export default function Login() {

  const {
    user,
    loading: authLoading,
    signIn,
    signUp,
  } = useAuth();

  const { toast } = useToast();


  // ==========================================================
  // STRUCTURES
  // ==========================================================

  const [structures, setStructures] =
    useState<Structure[]>([]);

  const [loadingStructures, setLoadingStructures] =
    useState(true);


  // ==========================================================
  // AUTHENTIFICATION
  // ==========================================================

  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [fullName, setFullName] =
    useState('');

  const [submitting, setSubmitting] =
    useState(false);


  // ==========================================================
  // MODE
  // ==========================================================

  const [isSignUp, setIsSignUp] =
    useState(false);


  // ==========================================================
  // STRUCTURE
  // ==========================================================

  /*
   * IMPORTANT :
   *
   * La structure n'est plus obligatoire pour la CONNEXION.
   *
   * Elle est obligatoire uniquement pour l'INSCRIPTION.
   *
   * Pour un ADMIN :
   *      structureId = null
   *
   * Pour un MANAGER / EMPLOYEE :
   *      la structure vient du profil employee.
   */

  const [selectedStructureId, setSelectedStructureId] =
    useState<string | null>(null);


  const selectedStructure =
    structures.find(
      (structure) =>
        structure.id === selectedStructureId
    );


  // ==========================================================
  // CHARGEMENT DES STRUCTURES
  // ==========================================================

  useEffect(() => {

    const fetchStructures = async () => {

      setLoadingStructures(true);

      try {

        const {
          data,
          error,
        } = await supabase
          .from('structures')
          .select(`
            id,
            name,
            code
          `)
          .order('name');


        if (error) {

          console.error(
            'Erreur lors du chargement des structures:',
            error
          );

          setStructures([]);

          return;
        }


        setStructures(
          data ?? []
        );
        console.log('welcome to you this is your problem how can i hepl you to resolve this problem');
        console.log( data);

      } catch (error) {

        console.error(
          'Erreur inattendue:',
          error
        );

        setStructures([]);

      } finally {

        setLoadingStructures(false);

      }
    };


    fetchStructures();

  }, []);


  // ==========================================================
  // REDIRECTION SI DÉJÀ CONNECTÉ
  // ==========================================================

  if (authLoading || loadingStructures) {

    return (
      <div className="
        flex
        min-h-screen
        items-center
        justify-center
        bg-background
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
    );
  }


  if (user) {

    return (
      <Navigate
        to="/dashboard"
        replace
      />
    );
  }


  // ==========================================================
  // SÉLECTION STRUCTURE POUR INSCRIPTION
  // ==========================================================

  const handleStructureSelection = (
    structureId: string
  ) => {

    setSelectedStructureId(
      structureId
    );

  };


  // ==========================================================
  // RETOUR À LA SÉLECTION
  // ==========================================================

  const handleChangeStructure = () => {

    setSelectedStructureId(
      null
    );

  };


  // ==========================================================
  // CONNEXION
  // ==========================================================

  const handleLogin = async () => {

    setSubmitting(true);


    try {

      /*
       * IMPORTANT :
       *
       * La connexion ne reçoit PLUS de structure.
       *
       * Supabase Auth identifie l'utilisateur
       * uniquement avec :
       *
       *      email
       *      password
       */

      const {
        error,
      } = await signIn(
        email.trim(),
        password
      );


      if (error) {

        console.error(
          'Erreur connexion:',
          error
        );


        toast({
          title: 'Connexion impossible',
          description:
            error.message,
          variant:
            'destructive',
        });

        return;
      }


      /*
       * La redirection vers /dashboard
       * sera gérée par l'état d'authentification.
       */

    } catch (error) {

      console.error(
        'Erreur inattendue:',
        error
      );


      toast({
        title: 'Erreur',
        description:
          'Une erreur inattendue est survenue.',
        variant:
          'destructive',
      });

    } finally {

      setSubmitting(false);

    }
  };


  // ==========================================================
  // INSCRIPTION
  // ==========================================================

  const handleSignUp = async () => {

    if (!selectedStructureId) {

      toast({
        title: 'Structure requise',
        description:
          'Veuillez sélectionner votre structure.',
        variant:
          'destructive',
      });

      return;
    }


    const selected =
      structures.find(
        (structure) =>
          structure.id ===
          selectedStructureId
      );


    if (!selected) {

      toast({
        title: 'Structure invalide',
        description:
          'La structure sélectionnée n’existe plus.',
        variant:
          'destructive',
      });

      return;
    }


    if (!fullName.trim()) {

      toast({
        title: 'Nom requis',
        description:
          'Veuillez renseigner votre nom complet.',
        variant:
          'destructive',
      });

      return;
    }


    setSubmitting(true);


    try {

      const parts =
        fullName
          .trim()
          .split(/\s+/);


      const firstName =
        parts[0] || '';


      const lastName =
        parts
          .slice(1)
          .join(' ') || '.';


      /*
       * L'inscription reste liée à une structure.
       *
       * Le nouvel utilisateur sera créé comme
       * EMPLOYEE par défaut.
       */

      const {
        error,
      } = await signUp(
        selectedStructureId,
        email.trim(),
        password,
        firstName,
        lastName
      );


      if (error) {

        console.error(
          'Erreur inscription:',
          error
        );


        toast({
          title:
            'Erreur d’inscription',

          description:
            error.code ===
            'over_email_send_rate_limit'

              ? 'Trop de tentatives d’envoi d’e-mail. Veuillez patienter avant de réessayer.'

              : error.message,

          variant:
            'destructive',
        });

        return;
      }


      toast({
        title:
          'Compte créé',

        description:
          `Votre compte a été créé pour ${selected.name}.`,
      });


      /*
       * Retour vers la connexion
       */

      setIsSignUp(false);

      setSelectedStructureId(
        null
      );

      setFullName('');

      setPassword('');


    } catch (error) {

      console.error(
        'Erreur inattendue:',
        error
      );


      toast({
        title: 'Erreur',
        description:
          'Une erreur inattendue est survenue.',
        variant:
          'destructive',
      });

    } finally {

      setSubmitting(false);

    }
  };


  // ==========================================================
  // SUBMIT
  // ==========================================================

  const handleSubmit = async (
    e: React.FormEvent
  ) => {

    e.preventDefault();


    if (isSignUp) {

      await handleSignUp();

    } else {

      await handleLogin();

    }

  };


  // ==========================================================
  // PAGE DE SÉLECTION DE STRUCTURE
  //
  // UNIQUEMENT POUR L'INSCRIPTION
  // ==========================================================

  if (
    isSignUp &&
    !selectedStructureId
  ) {

    return (
      <div
        className="
          flex
          min-h-screen
          items-center
          justify-center
          p-6
        "
        style={{
          background:
            'var(--gradient-hero)',
        }}
      >

        <Card
          className="
            w-full
            max-w-lg
            border-0
            shadow-xl
            animate-fade-in
          "
        >

          <CardHeader
            className="
              text-center
            "
          >

            <div className="
              flex
              justify-center
              mb-5
            ">

              <img
                src={guimsLogo}
                alt="Guims Group"
                className="
                  w-24
                  h-24
                "
              />

            </div>


            <h1 className="
              font-display
              text-3xl
              font-bold
            ">

              Créer un compte

            </h1>


            <p className="
              text-muted-foreground
              mt-2
            ">

              Sélectionnez votre structure

            </p>

          </CardHeader>


          <CardContent>

            <div className="
              grid
              grid-cols-1
              sm:grid-cols-2
              gap-5
            ">

              {structures.map(
                (structure) => (

                  <button
                    key={
                      structure.id
                    }
                    type="button"
                    onClick={() =>
                      handleStructureSelection(
                        structure.id
                      )
                    }
                    className="
                      group
                      rounded-xl
                      border-2
                      border-border
                      p-6
                      text-center
                      transition-all
                      duration-300
                      hover:border-primary
                      hover:bg-primary/5
                      hover:shadow-lg
                    "
                  >

                    <div className="
                      mx-auto
                      mb-4
                      flex
                      h-16
                      w-16
                      items-center
                      justify-center
                      rounded-full
                      bg-primary/10
                      group-hover:bg-primary/20
                      transition-colors
                    ">

                      <Building2
                        className="
                          h-8
                          w-8
                          text-primary
                        "
                      />

                    </div>


                    <h2 className="
                      font-display
                      text-xl
                      font-bold
                    ">

                      {structure.name}

                    </h2>


                    <p className="
                      mt-2
                      text-sm
                      text-muted-foreground
                    ">

                      {structure.code}

                    </p>

                  </button>

                )
              )}

              {structures.length === 0 && (

                <div className="
                  col-span-full
                  text-center
                  text-muted-foreground
                ">

                  Aucune structure disponible.

                </div>

              )}

            </div>


            <button
              type="button"
              onClick={() =>
                setIsSignUp(false)
              }
              className="
                mt-6
                w-full
                text-sm
                text-muted-foreground
                hover:text-primary
                transition-colors
              "
            >

              ← Retour à la connexion

            </button>

          </CardContent>

        </Card>

      </div>
    );
  }
{{console.log(structures);}}

  // ==========================================================
  // FORMULAIRE DE CONNEXION / INSCRIPTION
  // ==========================================================

  return (
    <div
      className="
        flex
        min-h-screen
      "
      style={{
        background:
          'var(--gradient-hero)',
      }}
    >


      {/* ====================================================
          BRANDING
      ==================================================== */}

      <div className="
        hidden
        lg:flex
        lg:w-1/2
        flex-col
        items-center
        justify-center
        p-12
        text-primary-foreground
      ">

        <img
          src={guimsLogo}
          alt="Guims Group"
          className="
            w-32
            h-32
            mb-8
          "
        />


        <h1 className="
          font-display
          text-4xl
          font-bold
          mb-4
        ">
          Das-Sarl / MAGISTERE
        </h1>


        <p className="
          text-lg
          opacity-80
          text-center
          max-w-md
        ">

          Système de Gestion du Personnel —
          Suivi des présences et des rapports.

        </p>

      </div>


      {/* ====================================================
          FORMULAIRE
      ==================================================== */}

      <div className="
        flex
        w-full
        lg:w-1/2
        items-center
        justify-center
        p-6
      ">

        <Card
          className="
            w-full
            max-w-md
            animate-fade-in
            border-0
            shadow-xl
          "
        >

          <CardHeader
            className="
              text-center
              pb-2
            "
          >

            <div className="
              lg:hidden
              flex
              flex-col
              items-center
              mb-4
            ">

              <img
                src={guimsLogo}
                alt="Guims Group"
                className="
                  w-16
                  h-16
                  mb-2
                "
              />

              <span className="
                font-display
                text-xl
                font-bold
                text-primary
              ">

                Das-Sarl / MAGISTERE

              </span>

            </div>


            {/* =================================================
                INDICATEUR DU MODE
            ================================================= */}

            <div className="
              mb-4
            ">

              <span className="
                inline-flex
                items-center
                gap-2
                rounded-full
                bg-primary/10
                px-4
                py-2
                text-sm
                font-medium
                text-primary
              ">

                {isSignUp ? (

                  <Building2
                    className="
                      h-4
                      w-4
                    "
                  />

                ) : (

                  <ShieldCheck
                    className="
                      h-4
                      w-4
                    "
                  />

                )}


                {isSignUp
                  ? selectedStructure
                    ? `Structure : ${selectedStructure.code}`
                    : 'Création de compte'
                  : 'Connexion'}

              </span>

            </div>


            <h2 className="
              font-display
              text-2xl
              font-bold
            ">

              {isSignUp
                ? 'Créer un compte'
                : 'Connexion'}

            </h2>


            <p className="
              text-sm
              text-muted-foreground
            ">

              {isSignUp
                ? 'Remplissez les informations ci-dessous'
                : 'Entrez vos identifiants pour accéder à votre espace'}

            </p>

          </CardHeader>


          <CardContent>


            {/* =================================================
                CHANGEMENT DE STRUCTURE
                UNIQUEMENT INSCRIPTION
            ================================================= */}

            {isSignUp &&
              selectedStructure && (

                <button
                  type="button"
                  onClick={
                    handleChangeStructure
                  }
                  className="
                    mb-5
                    w-full
                    text-sm
                    text-muted-foreground
                    hover:text-primary
                    transition-colors
                  "
                >

                  ← Changer de structure

                </button>

              )}


            <form
              onSubmit={
                handleSubmit
              }
              className="
                space-y-4
              "
            >


              {/* =================================================
                  NOM
              ================================================= */}

              {isSignUp && (

                <div className="
                  space-y-2
                ">

                  <Label htmlFor="fullName">

                    Nom complet

                  </Label>


                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) =>
                      setFullName(
                        e.target.value
                      )
                    }
                    placeholder="Prénom Nom"
                    required
                  />


                  <p className="
                    text-[10px]
                    text-muted-foreground
                    mt-1
                  ">

                    Vous serez inscrit comme
                    Employé par défaut.

                  </p>

                </div>

              )}


              {/* =================================================
                  EMAIL
              ================================================= */}

              <div className="
                space-y-2
              ">

                <Label htmlFor="email">

                  Email

                </Label>


                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) =>
                    setEmail(
                      e.target.value
                    )
                  }
                  placeholder="nom@gmail.com"
                  required
                />

              </div>


              {/* =================================================
                  PASSWORD
              ================================================= */}

              <div className="
                space-y-2
              ">

                <Label htmlFor="password">

                  Mot de passe

                </Label>


                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                  placeholder="••••••••"
                  required
                  minLength={6}
                />

              </div>


              {/* =================================================
                  SUBMIT
              ================================================= */}

              <Button
                type="submit"
                className="
                  w-full
                "
                disabled={
                  submitting ||
                  (
                    isSignUp &&
                    !selectedStructureId
                  )
                }
              >

                {submitting ? (

                  <Loader2
                    className="
                      h-4
                      w-4
                      animate-spin
                      mr-2
                    "
                  />

                ) : isSignUp ? (

                  <UserPlus
                    className="
                      h-4
                      w-4
                      mr-2
                    "
                  />

                ) : (

                  <LogIn
                    className="
                      h-4
                      w-4
                      mr-2
                    "
                  />

                )}


                {isSignUp
                  ? 'Créer le compte'
                  : 'Se connecter'}

              </Button>

            </form>


            {/* =================================================
                SWITCH LOGIN / SIGNUP
            ================================================= */}

            <div className="
              mt-4
              text-center
            ">

              <button
                type="button"
                onClick={() => {

                  setIsSignUp(
                    !isSignUp
                  );

                  setSelectedStructureId(
                    null
                  );

                }}
                className="
                  text-sm
                  text-muted-foreground
                  hover:text-primary
                  transition-colors
                "
              >

                {isSignUp
                  ? 'Déjà un compte ? Se connecter'
                  : "Pas de compte ? Créer un compte"}

              </button>

            </div>

          </CardContent>

        </Card>

      </div>

    </div>
  );
}