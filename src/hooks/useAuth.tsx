
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';

import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

export type AppRole =
  Database['public']['Enums']['employee_role'];

export interface Employee {
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
  account_status: string;
  is_active: boolean;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Employee | null;
  role: AppRole | null;
  loading: boolean;

  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: Error | null }>;

  signUp: (
    structureId: string,
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => Promise<{ error: Error | null }>;

  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

/**
 * Nettoyage et normalisation d'un email.
 *
 * Supprime :
 * - espaces au début et à la fin
 * - espaces insécables
 * - retours à la ligne
 * - tabulations
 * - caractères Unicode invisibles
 *
 * Puis convertit l'adresse en minuscules.
 */
function normalizeEmail(email: string): string {
  return email
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Validation locale de l'email.
 *
 * Cette validation ne remplace pas celle de Supabase.
 * Elle permet simplement d'éviter d'envoyer une valeur
 * manifestement incorrecte à Supabase.
 */
function isValidEmail(email: string): boolean {
  if (!email) {
    return false;
  }

  if (email.length > 254) {
    return false;
  }

  /**
   * Format volontairement simple et compatible
   * avec les emails classiques utilisés par Supabase.
   */
  const emailRegex =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  return emailRegex.test(email);
}

/**
 * Transforme les erreurs Supabase en messages lisibles.
 */
function getAuthErrorMessage(
  error: unknown,
  defaultMessage: string
): string {
  if (!error) {
    return defaultMessage;
  }

  const authError = error as {
    message?: string;
    code?: string;
    status?: number;
  };

  const message = authError.message ?? '';

  if (
    message.toLowerCase().includes('invalid') &&
    message.toLowerCase().includes('email')
  ) {
    return 'L’adresse email saisie est considérée comme invalide. Vérifiez qu’elle ne contient pas d’espace ou de caractère invisible.';
  }

  if (
    message.toLowerCase().includes('already registered') ||
    message.toLowerCase().includes('already been registered') ||
    message.toLowerCase().includes('user already registered')
  ) {
    return 'Cette adresse email est déjà utilisée.';
  }

  if (
    message.toLowerCase().includes('password') &&
    message.toLowerCase().includes('weak')
  ) {
    return 'Le mot de passe est trop faible.';
  }

  if (
    message.toLowerCase().includes('email not confirmed')
  ) {
    return 'Votre adresse email n’a pas encore été confirmée.';
  }

  return message || defaultMessage;
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Employee | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Récupère l'employé connecté et son rôle.
   */
  const fetchProfileAndRole = async (userId: string) => {
    try {
      const [employeeRes, roleRes] = await Promise.all([
        supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', userId)
          .single(),

        supabase.rpc('current_employee_role'),
      ]);

      if (employeeRes.error) {
        console.error(
          'Erreur récupération employé:',
          employeeRes.error
        );
      } else if (employeeRes.data) {
        setProfile(employeeRes.data as Employee);
      }

      if (roleRes.error) {
        console.error(
          'Erreur récupération rôle:',
          roleRes.error
        );
      } else if (roleRes.data) {
        setRole(roleRes.data as AppRole);
      }
    } catch (error) {
      console.error(
        'Erreur lors de la récupération du profil et du rôle:',
        error
      );
    }
  };

  /**
   * Vérifie que l'utilisateur appartient bien
   * à la structure sélectionnée.
   */
  const verifyUserStructure = async (
    userId: string,
    selectedStructureId: string
  ): Promise<{
    valid: boolean;
    error: Error | null;
  }> => {
    const { data: employee, error } = await supabase
      .from('employees')
      .select('structure_id, is_active, account_status')
      .eq('auth_user_id', userId)
      .single();

    if (error) {
      console.error(
        'Erreur vérification structure:',
        error
      );

      return {
        valid: false,
        error: new Error(
          'Impossible de vérifier la structure de votre compte.'
        ),
      };
    }

    if (!employee) {
      return {
        valid: false,
        error: new Error(
          'Aucun profil employé associé à ce compte.'
        ),
      };
    }

    if (employee.account_status === 'pending') {
      return {
        valid: false,
        error: new Error(
          'Votre compte est en attente de validation.'
        ),
      };
    }

    if (employee.account_status === 'rejected') {
      return {
        valid: false,
        error: new Error(
          'Votre inscription a été refusée.'
        ),
      };
    }

    if (employee.account_status === 'suspended') {
      return {
        valid: false,
        error: new Error(
          'Votre compte a été suspendu.'
        ),
      };
    }

    if (!employee.is_active) {
      return {
        valid: false,
        error: new Error(
          'Votre compte est actuellement désactivé.'
        ),
      };
    }

    if (employee.structure_id !== selectedStructureId) {
      return {
        valid: false,
        error: new Error(
          'Ce compte appartient à une autre structure.'
        ),
      };
    }

    return {
      valid: true,
      error: null,
    };
  };

  /**
   * Gestion de la session Supabase.
   */
  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, currentSession) => {
        if (!mounted) {
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          setTimeout(() => {
            if (mounted) {
              fetchProfileAndRole(currentSession.user.id);
            }
          }, 0);
        } else {
          setProfile(null);
          setRole(null);
        }

        setLoading(false);
      }
    );

    supabase.auth.getSession().then(
      async ({ data: { session: currentSession } }) => {
        if (!mounted) {
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          await fetchProfileAndRole(
            currentSession.user.id
          );
        }

        if (mounted) {
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * CONNEXION
   */
  const signIn = async (
    email: string,
    password: string
  ): Promise<{ error: Error | null }> => {
    try {
      const cleanEmail = normalizeEmail(email);

      if (!cleanEmail) {
        return {
          error: new Error(
            'Veuillez saisir votre adresse email.'
          ),
        };
      }

      if (!isValidEmail(cleanEmail)) {
        return {
          error: new Error(
            'Veuillez saisir une adresse email valide.'
          ),
        };
      }

      if (!password) {
        return {
          error: new Error(
            'Veuillez saisir votre mot de passe.'
          ),
        };
      }

      console.log(
        '[AUTH] Email de connexion:',
        JSON.stringify(cleanEmail)
      );

      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (error) {
        console.error(
          'Erreur Supabase Auth:',
          error
        );

        return {
          error: new Error(
            getAuthErrorMessage(
              error,
              'Impossible de vous connecter.'
            )
          ),
        };
      }

      if (!data.user) {
        return {
          error: new Error(
            'Utilisateur introuvable après authentification.'
          ),
        };
      }

      await fetchProfileAndRole(data.user.id);

      return {
        error: null,
      };
    } catch (error) {
      console.error(
        'Erreur inattendue lors de la connexion:',
        error
      );

      return {
        error:
          error instanceof Error
            ? error
            : new Error(
              'Une erreur inattendue est survenue.'
            ),
      };
    }
  };

  /**
   * INSCRIPTION
   */
  const signUp = async (
    structureId: string,
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ): Promise<{ error: Error | null }> => {
    try {
      /**
       * =====================================================
       * 1. NORMALISATION DES DONNÉES
       * =====================================================
       */

      const cleanEmail = normalizeEmail(email);
      const cleanFirstName = firstName.trim();
      const cleanLastName = lastName.trim();
      const cleanStructureId = structureId?.trim();

      /**
       * =====================================================
       * 2. VALIDATION
       * =====================================================
       */

      if (!cleanEmail) {
        return {
          error: new Error(
            'Veuillez saisir votre adresse email.'
          ),
        };
      }

      if (!isValidEmail(cleanEmail)) {
        console.error(
          '[AUTH SIGNUP] Email invalide avant Supabase:',
          JSON.stringify(cleanEmail)
        );

        return {
          error: new Error(
            'Veuillez saisir une adresse email valide.'
          ),
        };
      }

      if (!password) {
        return {
          error: new Error(
            'Veuillez saisir un mot de passe.'
          ),
        };
      }

      if (password.length < 6) {
        return {
          error: new Error(
            'Le mot de passe doit contenir au moins 6 caractères.'
          ),
        };
      }

      if (!cleanFirstName) {
        return {
          error: new Error(
            'Veuillez saisir votre prénom.'
          ),
        };
      }

      if (!cleanLastName) {
        return {
          error: new Error(
            'Veuillez saisir votre nom.'
          ),
        };
      }

      if (!cleanStructureId) {
        return {
          error: new Error(
            'Une structure doit être sélectionnée.'
          ),
        };
      }

      /**
       * =====================================================
       * 3. DEBUG
       * =====================================================
       *
       * JSON.stringify permet de détecter les caractères
       * invisibles ou les espaces inattendus.
       */

      console.log(
        '[AUTH SIGNUP] Données envoyées:',
        {
          email: JSON.stringify(cleanEmail),
          firstName: JSON.stringify(cleanFirstName),
          lastName: JSON.stringify(cleanLastName),
          structureId: JSON.stringify(cleanStructureId),
          passwordPresent: Boolean(password),
        }
      );

      /**
       * =====================================================
       * 4. CRÉATION DU COMPTE SUPABASE AUTH
       * =====================================================
       */

      const { data, error } =
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              first_name: cleanFirstName,
              last_name: cleanLastName,
              structure_id: cleanStructureId,
            },
          },
        });

      /**
       * =====================================================
       * 5. GESTION DE L'ERREUR SUPABASE
       * =====================================================
       */

      if (error) {
        console.error(
          '[AUTH SIGNUP] Erreur Supabase:',
          {
            message: error.message,
            status: error.status,
            name: error.name,
          }
        );

        if (
          error.status === 429 ||
          error.message
            ?.toLowerCase()
            .includes('rate limit')
        ) {
          return {
            error: new Error(
              'Trop de tentatives d’inscription. Veuillez patienter quelques minutes avant de réessayer.'
            ),
          };
        }

        return {
          error: new Error(
            getAuthErrorMessage(
              error,
              'Impossible de créer votre compte.'
            )
          ),
        };
      }
      /**
       * =====================================================
       * 6. VÉRIFICATION DU USER
       * =====================================================
       */

      if (!data.user) {
        return {
          error: new Error(
            'Le compte n’a pas pu être créé.'
          ),
        };
      }

      console.log(
        '[AUTH SIGNUP] Utilisateur créé:',
        data.user.id
      );

      /**
       * =====================================================
       * 7. CAS CONFIRMATION EMAIL
       * =====================================================
       *
       * Supabase peut créer le user sans session si la
       * confirmation email est obligatoire.
       */

      if (!data.session) {
        console.log(
          '[AUTH SIGNUP] Compte créé. Confirmation email nécessaire.'
        );
      }

      return {
        error: null,
      };
    } catch (error) {
      console.error(
        '[AUTH SIGNUP] Erreur inattendue:',
        error
      );

      return {
        error:
          error instanceof Error
            ? error
            : new Error(
              'Une erreur inattendue est survenue lors de l’inscription.'
            ),
      };
    }
  };

  /**
   * DÉCONNEXION
   */
  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setUser(null);
      setSession(null);
      setProfile(null);
      setRole(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role,
        loading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return context;
}
