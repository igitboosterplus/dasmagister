# Audit de l'Architecture — DAS-Magistere

> **Date** : 2025  
> **Statut** : Référence pour les futures modifications. Ne pas effectuer de modifications sans consulter ce document.  
> **Périmètre** : Architecture full-stack (React + Supabase/PostgreSQL), schéma de base de données, hiérarchie des rôles, RLS, et logique métier.

---

## 1. Stack Technique

| Couche | Technologie |
|---|---|
| Frontend | React + Vite + TypeScript |
| Routing | `react-router-dom` v6 |
| Server state | `@tanstack/react-query` |
| UI Components | shadcn/ui (Radix UI + Tailwind) |
| Backend | Supabase (PostgreSQL + PostgREST + Auth + Storage) |
| Auth | Supabase Auth (email/password) |
| Déploiement DB | Supabase CLI (`supabase db push`) |

---

## 2. Structure des Dossiers Frontend

```
src/
├── App.tsx                    # Routing principal (react-router-dom)
├── hooks/
│   └── useAuth.tsx            # Contexte d'authentification central
├── components/
│   ├── AppSidebar.tsx         # Navigation latérale conditionnelle par rôle
│   └── DashboardLayout.tsx    # Wrapper de mise en page commun
├── pages/
│   ├── Login.tsx              # Connexion + inscription multi-structure
│   ├── Dashboard.tsx          # Redirecteur selon le rôle
│   ├── Dasboard/
│   │   ├── admin.tsx          # Dashboard admin (tous les employés)
│   │   ├── manager.tsx        # Dashboard manager (structure filtrée)
│   │   └── employee.tsx       # Dashboard employé (pointage)
│   ├── Responsablesite.tsx    # Dashboard responsable de site
│   ├── Reports.tsx            # Interface de rapports
│   └── ...
└── integrations/
    └── supabase/
        └── client.ts          # Client Supabase initialisé
```

---

## 3. Flux d'Authentification (`useAuth.tsx`)

```
User clique "Connexion"
  → supabase.auth.signInWithPassword()
  → onAuthStateChange déclenché
     → fetchEmployeeProfile()
        → SELECT employees WHERE auth_user_id = auth.uid()
        → SELECT employee_roles WHERE employee_id = ...
     → verifyUserStructure()
        → Vérifie que employee.structure_id = selectedStructureId
        → Vérifie employee.account_status = 'active'
  → Profil stocké dans le contexte React
```

**États du compte (`account_status`) :**

| Valeur | Signification |
|---|---|
| `pending` | Inscription en attente de validation |
| `active` | Compte opérationnel |
| `rejected` | Inscription refusée |
| `suspended` | Compte suspendu par un admin |

---

## 4. Hiérarchie des Rôles

```
ADMIN
 └── Accès global à toutes les structures
 └── Crée/approuve/rejette les inscriptions
 └── Modifie les rôles de tous les employés
 └── Voit tous les pointages, rapports, logs

MANAGER
 └── Accès limité à SA structure (via current_structure_id())
 └── Voit les employés, pointages, rapports de sa structure
 └── Peut approuver/rejeter les inscriptions de sa structure
 └── Peut modifier les employés de sa structure (pas les autres managers)

SITE RESPONSIBLE (employé avec is_responsible=true dans employee_sites)
 └── Rôle applicatif sur les données, rôle DB = 'employee'
 └── Accès aux données de SON site uniquement
 └── Voit les présences, employés, anomalies de son site
 └── Dashboard dédié : Responsablesite.tsx

EMPLOYEE
 └── Accès uniquement à ses propres données
 └── Peut lire son profil, ses pointages, ses rapports
```

**Enum PostgreSQL :** `public.employee_role` = `('admin', 'manager', 'employee')`

> ⚠️ **Important :** Le rôle "Responsable de Site" N'EST PAS un rôle DB distinct. C'est un employé avec `employee_role = 'employee'` dont l'entrée `employee_sites` a `is_responsible = true`.

---

## 5. Schéma de Base de Données (V3 actuelle)

### 5.1 Tables Principales

#### `structures`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | Identifiant |
| `name` | TEXT | Nom de la structure |
| `code` | TEXT | Code court |
| `is_active` | BOOLEAN | Statut actif |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

> 📌 Lisible publiquement (sans auth) pour permettre la sélection lors de l'inscription.

#### `employees`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `auth_user_id` | UUID | FK → `auth.users.id` |
| `first_name` | VARCHAR(100) | |
| `last_name` | VARCHAR(100) | |
| `phone` | VARCHAR(30) | |
| `structure_id` | UUID | FK → `structures.id` **(clé métier centrale)** |
| `service_id` | UUID | FK → `services.id` |
| `position_id` | UUID | FK → `positions.id` |
| `site_id` | UUID | **⚠️ CHAMP LEGACY** — à migrer vers `employee_sites` |
| `is_active` | BOOLEAN | |
| `account_status` | `account_status` ENUM | pending/active/rejected/suspended |
| `approved_by` | UUID | FK → `employees.id` |
| `approved_at` | TIMESTAMPTZ | |
| `rejection_reason` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `employee_roles`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `employee_id` | UUID UNIQUE | FK → `employees.id` |
| `role` | `employee_role` ENUM | admin/manager/employee |
| `created_at` | TIMESTAMPTZ | |

> 📌 Contrainte `UNIQUE(employee_id)` — un employé a exactement un rôle à la fois.

#### `sites`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `structure_id` | UUID | FK → `structures.id` |
| `name` | TEXT | |
| `type` | TEXT | |
| `address` | TEXT | |
| `latitude` | DOUBLE PRECISION | |
| `longitude` | DOUBLE PRECISION | |
| `location_radius_m` | INTEGER | Rayon GPS autorisé (défaut: 100m) |
| `max_gps_accuracy_m` | INTEGER | Précision GPS max (défaut: 100m) |
| `gps_required` | BOOLEAN | |
| `wifi_required` | BOOLEAN | Active la validation par IP réseau |
| `allowed_ip` | TEXT | IP/CIDR autorisée du réseau du site |
| `wifi_ssid` | TEXT | **Legacy — non utilisé** |
| `offline_attendance_enabled` | BOOLEAN | |
| `responsible_employee_id` | UUID | FK → `employees.id` (SET NULL on delete) |
| `timezone` | TEXT | (défaut: 'Africa/Douala') |
| `work_start` | TIME | |
| `work_end` | TIME | |
| `is_active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `employee_sites`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `employee_id` | UUID | FK → `employees.id` (CASCADE DELETE) |
| `site_id` | UUID | FK → `sites.id` (CASCADE DELETE) |
| `assigned_by` | UUID | FK → `employees.id` (SET NULL) |
| `assigned_at` | TIMESTAMPTZ | |
| `is_active` | BOOLEAN | |
| `is_responsible` | BOOLEAN | **Source de vérité pour le rôle responsable** |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| | `UNIQUE(employee_id, site_id)` | |

> 📌 **Source de vérité** pour l'appartenance employé/site. `employees.site_id` est legacy.

#### `attendances`
| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `employee_id` | UUID | FK → `employees.id` |
| `site_id` | UUID | FK → `sites.id` |
| `attendance_date` | DATE | |
| `check_in` | TIMESTAMPTZ | |
| `check_out` | TIMESTAMPTZ | |
| `check_in_latitude/longitude/accuracy_m` | DOUBLE PRECISION | |
| `check_out_latitude/longitude/accuracy_m` | DOUBLE PRECISION | |
| `check_in_method` | TEXT | gps_auto / network_ip / manual / system / manager |
| `check_out_method` | TEXT | idem |
| `check_in_distance_m` | DOUBLE PRECISION | Distance au site lors du pointage |
| `validation_status` | `attendance_validation_status` | voir ENUMs |
| `validation_method` | TEXT | |
| `validation_reason` | TEXT | |
| `late_minutes` | INTEGER | |
| `attendance_status` | TEXT | ex: 'present' |
| `attendance_source` | `attendance_source` | online/offline/manual |
| `is_offline` | BOOLEAN | |
| `client_event_id` | UUID UNIQUE | Idempotence (déduplication côté client) |
| `device_recorded_at` | TIMESTAMPTZ | |
| `server_received_at` | TIMESTAMPTZ | |
| `synced_at` | TIMESTAMPTZ | |
| `validated_at` | TIMESTAMPTZ | |
| `scheduled_start/end` | TIME | Horaires planifiés du site ce jour |
| `updated_at` | TIMESTAMPTZ | |

#### `attendance_events`
Log immuable de chaque événement de pointage (check_in/check_out).

#### `attendance_anomalies`
Anomalies détectées automatiquement lors du pointage. Types : `late, out_of_zone, low_accuracy, no_gps, offline, duplicate, missing_checkout, suspicious_time`.

#### `employee_absences`
Absences planifiées (congé, maladie, mission, etc.) avec workflow d'approbation.

#### `reports`
Rapports créés par les employés. Immutables après soumission (pas de policy UPDATE/DELETE).

#### `report_attachments`
Pièces jointes liées aux rapports.

#### `notifications`
Notifications internes aux employés (lecture et mise à jour uniquement pour le destinataire).

#### `audit_logs`
Log d'audit des actions admin/manager (lecture admin uniquement).

#### `site_work_schedules`
Planning hebdomadaire par site (jour de la semaine, heure de début/fin, délai de tolérance pour retard).

#### `employee_actions`
Table créée via migration corrective (`20260906120000`). Utilisée par les RLS de la migration `20260907`.

### 5.2 Tables de Référence

| Table | Description |
|---|---|
| `cities` | Villes (lisibles par tout employé actif) |
| `positions` | Postes de travail (avec `is_responsible_position`) |
| `services` | Services/Départements |
| `report_types` | Types de rapports disponibles |

---

## 6. ENUMs PostgreSQL

| ENUM | Valeurs |
|---|---|
| `employee_role` | `admin, manager, employee` |
| `account_status` | `pending, active, rejected, suspended` |
| `attendance_validation_status` | `valid, late, out_of_zone, low_accuracy, no_gps, pending_review, rejected` |
| `attendance_source` | `online, offline, manual` |
| `attendance_event_type` | `check_in, check_out` |
| `anomaly_type` | `late, out_of_zone, low_accuracy, no_gps, offline, duplicate, missing_checkout, suspicious_time` |
| `anomaly_severity` | `low, medium, high, critical` |
| `report_status` | `draft, submitted, received, forwarded, reviewed, archived, rejected` |
| `absence_type` | `leave, authorized_absence, sick, mission, training, other` |
| `absence_status` | `pending, approved, rejected, cancelled` |

---

## 7. Fonctions RPC (SECURITY DEFINER)

### 7.1 Fonctions d'identité du contexte courant

| Fonction | Retour | Description |
|---|---|---|
| `current_employee_id()` | UUID | ID de l'employé connecté |
| `current_employee_is_active()` | BOOLEAN | Employé actif ET compte actif |
| `current_structure_id()` | UUID | Structure de l'employé connecté |
| `current_employee_role()` | `employee_role` | Rôle de l'employé connecté |
| `is_admin()` | BOOLEAN | Rôle = admin ET actif |
| `is_manager()` | BOOLEAN | Rôle = manager ET actif |
| `is_employee()` | BOOLEAN | Rôle = employee |

### 7.2 Fonctions de vérification d'accès

| Fonction | Paramètre | Description |
|---|---|---|
| `is_site_responsible(p_site_id)` | UUID | Vérifie `employee_sites.is_responsible = true` |
| `is_responsible_for_employee(p_employee_id)` | UUID | Vérifie si on est responsable d'un site de cet employé |
| `employee_belongs_to_current_structure(p_employee_id)` | UUID | Vérifie que l'employé est dans la même structure |
| `employee_is_manager(p_employee_id)` | UUID | Vérifie si l'employé cible est un manager |
| `site_belongs_to_current_structure(p_site_id)` | UUID | Vérifie que le site est dans la même structure |
| `can_manage_site_schedule(p_site_id)` | UUID | Admin OU manager de la structure du site |
| `employee_can_access_site(p_site_id)` | UUID | Admin OU affecté OU manager de structure OU responsable |

### 7.3 Fonctions métier (Pointage)

| Fonction | Description |
|---|---|
| `clock_in(p_site_id, p_lat, p_lon, p_accuracy, p_occurred_at, p_client_event_id, p_device_recorded_at)` | **Version V4** — Pointage entrée avec GPS prioritaire puis IP réseau en secours |
| `clock_out(p_site_id, p_lat, p_lon, ...)` | **Version V4** — Pointage sortie |
| `find_employee_site_by_gps(p_lat, p_lon, p_accuracy)` | Trouve le site le plus proche dans le périmètre valide |
| `resolve_assigned_sites_by_ip()` | Sites assignés dont l'IP réseau correspond à la requête |
| `site_ip_matches_request(p_site_id)` | Valide l'IP du client contre `sites.allowed_ip` |
| `request_client_ip()` | Lit l'IP depuis les headers PostgREST (x-forwarded-for, cf-connecting-ip) |
| `calculate_distance_meters(lat1, lon1, lat2, lon2)` | Haversine formula |
| `sync_offline_attendance(p_event_type, ...)` | Synchronisation des pointages hors ligne |
| `approve_attendance(p_attendance_id)` | Admin/Manager approuve un pointage |
| `reject_attendance(p_attendance_id, p_reason)` | Admin/Manager rejette un pointage |

### 7.4 Fonctions métier (Administration)

| Fonction | Description |
|---|---|
| `approve_registration(p_employee_id, p_service_id, p_position_id)` | Active un compte en attente + notifie |
| `reject_registration(p_employee_id, p_reason)` | Rejette un compte + notifie |
| `assign_employee_site(p_employee_id, p_site_id)` | Affecte un employé à un site (même structure) |
| `remove_employee_site(p_employee_id, p_site_id)` | Retire l'affectation (soft delete) |
| `assign_site_responsible(p_site_id, p_employee_id)` | Désigne un responsable de site |
| `update_my_profile(p_first_name, p_last_name, p_phone)` | Employé modifie son propre profil |
| `set_employee_role(p_employee_id, p_role)` | Admin change le rôle d'un employé |

### 7.5 Triggers

| Trigger | Table | Événement | Fonction |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_employee()` |
| `trg_validate_employee_site_assignment` | `employee_sites` | BEFORE INSERT/UPDATE | `validate_employee_site_assignment()` |
| `trg_validate_site_responsible` | `sites` | BEFORE INSERT/UPDATE OF responsible_employee_id | `validate_site_responsible()` |

**`handle_new_employee()`** : Lors d'une inscription, crée automatiquement l'entrée `employees` ET l'entrée `employee_roles` (rôle = 'employee' par défaut). Les métadonnées (prénom, nom, téléphone, structure_id) sont lues depuis `auth.users.raw_user_meta_data`.

---

## 8. Politiques RLS

### Principe général

- **RLS activé** sur toutes les tables de données.
- Toutes les RLS s'appuient sur les **fonctions SECURITY DEFINER** pour éviter les requêtes récursives sur `employees`.
- `structures` est lisible **sans authentification** (`TO public USING (true)`) pour permettre une inscription sans compte.

### Matrice des accès par table

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `structures` | `public` (tout le monde) | ✗ | ✗ | ✗ |
| `employees` | Own / Admin / Manager (structure) / Site Resp. (son site) | Admin | Admin + Manager (structure) + Self | ✗ |
| `employee_roles` | Own / Admin / Manager (structure) | Admin + Manager (→ 'employee' seulement) | Admin + Manager (structure, pas autre manager) | ✗ |
| `sites` | Admin / Structure / Site Resp. | Admin + Manager (structure) | Admin + Manager (structure) | ✗ |
| `employee_sites` | Own / Admin / Manager / Site Resp. | Admin + Manager (même structure) | Admin + Manager (même structure) | Admin + Manager (même structure) |
| `attendances` | Own / Admin / Manager (structure) / Site Resp. | Own (employee_id = current) | Own | ✗ |
| `attendance_events` | Own / Admin / Manager / Site Resp. | ✗ | ✗ | ✗ |
| `attendance_anomalies` | Own / Admin / Manager / Site Resp. | ✗ | ✗ | ✗ |
| `employee_absences` | Own / Admin / Manager (structure) | ✗ | ✗ | ✗ |
| `employee_actions` | Admin + Manager (structure) | ✗ | ✗ | ✗ |
| `reports` | Own / Admin / Manager (structure) / Site Resp. | Own (employee_id + author_employee_id = current) | ✗ | ✗ |
| `report_attachments` | Rapport accessible | Own report | ✗ | ✗ |
| `notifications` | Own | ✗ | Own | ✗ |
| `audit_logs` | Admin seulement | ✗ | ✗ | ✗ |
| `site_work_schedules` | `can_manage_site_schedule()` | idem | idem | idem |
| `cities, positions, services, report_types` | Employé actif | ✗ | ✗ | ✗ |

---

## 9. Logique de Pointage (V4)

### Algorithme `clock_in()`

```
1. Vérifier employé actif + compte actif
2. Vérifier que le site appartient à la même structure
3. Vérifier l'affectation active dans employee_sites
4. Idempotence via client_event_id (retourne existant si déjà traité)
5. GPS prioritaire :
   - Si coords fournies ET site a des coords :
     - Calcul distance Haversine
     - Si précision GPS > seuil → GPS_ACCURACY_TOO_LOW
     - Si distance > rayon → GPS_OUTSIDE_SITE
     - Sinon → GPS VALIDE
6. Réseau IP en secours (si GPS invalide et wifi_required=true) :
   - Lit l'IP via headers PostgREST
   - Compare à sites.allowed_ip (IPv4, IPv6, ou CIDR)
   - Si IP ne correspond pas → NETWORK_IP_NOT_ALLOWED
7. Si aucune validation → exception métier (GPS_REQUIRED, etc.)
8. Calcul du retard (site_work_schedules)
9. INSERT attendances + INSERT attendance_events
10. INSERT attendance_anomalies si late/out_of_zone/low_accuracy/no_gps
```

### Algorithme `clock_out()`
- Même validations de base (employé actif, structure, affectation)
- Trouve l'attendance ouverte (check_out IS NULL) du jour
- UPDATE avec les coordonnées de sortie

---

## 10. Routing Frontend (`App.tsx`)

```
/                → redirect vers /dashboard
/login           → Login.tsx (public)
/dashboard       → Dashboard.tsx (redirecteur par rôle)
/dashboard/admin → admin.tsx (rôle: admin)
/dashboard/manager → manager.tsx (rôle: manager)
/dashboard/employee → employee.tsx (rôle: employee)
/responsable-site → Responsablesite.tsx (employee + is_responsible)
/reports         → Reports.tsx
/settings        → ...
```

> ⚠️ **Absence de ProtectedRoute** : Il n'existe pas de composant `<ProtectedRoute>` dans `App.tsx`. La protection des routes est effectuée de manière **ad hoc** dans chaque page (ex: `if (role !== 'admin') return <Redirect>`). Cela est une dette technique à corriger.

---

## 11. Problèmes Identifiés (Dette Technique)

### 🔴 Critiques

| # | Problème | Fichier | Impact |
|---|---|---|---|
| 1 | `console.log` exposant les données de structures | `Login.tsx:169-170` | Fuite de données en prod |
| 2 | Absence de ProtectedRoute centralisé | `App.tsx` | Accès non autorisé possible si protection ad-hoc manquée |

### 🟠 Importants

| # | Problème | Fichier | Impact |
|---|---|---|---|
| 3 | `employees.site_id` est legacy mais toujours présent dans les SELECT | `Responsablesite.tsx:334` | Confusion sur la source de vérité |
| 4 | `console.log` de debug dans Responsablesite.tsx | `Responsablesite.tsx:298, 374, 497` | Bruit en prod |
| 5 | Deux versions de `clock_in/clock_out` coexistent | Migrations bdv3 + pointage | La version de `pointage.sql` (V4) écrase `bdv3`, mais la bdv3 est toujours dans les migrations |

### 🟡 Mineurs

| # | Problème | Fichier | Impact |
|---|---|---|---|
| 6 | PWA : icônes manquantes dans `public/` | `manifest.json` | Installabilité dégradée |
| 7 | Pas de job `pg_cron` pour auto-checkout à minuit | DB | Attendances potentiellement ouvertes le lendemain |
| 8 | `reports.recipient_id` et `reports.recipient_employee_id` tous les deux référencés | `20260917` | Champ dupliqué potentiellement |

---

## 12. Contraintes Métier Critiques

### ⚙️ Invariants à respecter impérativement

1. **Un employé appartient à UNE seule structure** (`employees.structure_id`). Cette colonne est la clé de toute la logique RLS.
2. **Un site appartient à UNE seule structure** (`sites.structure_id`). La contrainte de cohérence est garantie par le trigger `trg_validate_employee_site_assignment`.
3. **Un employé ne peut être affecté qu'à un site de sa propre structure.** Enforced par trigger.
4. **Le responsable d'un site doit avoir un poste avec `is_responsible_position = true`.** Enforced par trigger.
5. **Le responsable d'un site doit d'abord être affecté au site avant d'être nommé responsable.**
6. **Un responsable de site ne peut pas être retiré d'un site sans changer d'abord le responsable** (RPC `remove_employee_site`).
7. **Les rapports sont immuables après soumission** (pas de RLS UPDATE/DELETE sur `reports`).
8. **`is_responsible` dans `employee_sites` est la source de vérité** pour le rôle de responsable de site. `sites.responsible_employee_id` est redondant (mais géré par trigger).

---

## 13. Recommandations pour les Modifications Futures

Avant toute modification de la logique liée aux structures :

1. **Identifier tous les endroits qui utilisent `current_structure_id()`** dans les RPC et les RLS.
2. **Vérifier la cohérence des triggers** : tout changement de `structure_id` sur un employé ou un site doit tenir compte de `trg_validate_employee_site_assignment`.
3. **Ne jamais bypasser les RPC** pour les opérations critiques (pointage, approbation). Les fonctions SECURITY DEFINER encapsulent les règles métier.
4. **Tester avec les 4 rôles** : admin, manager, employee (sans responsabilité), employee (responsable de site).
