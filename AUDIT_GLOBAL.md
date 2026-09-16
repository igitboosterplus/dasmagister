# AUDIT GLOBAL DU PROJET

## 1. Résumé exécutif
L'application est une plateforme métier de gestion des employés, orientée vers le suivi strict du temps de présence avec géolocalisation et fonctionnement multi-sites. Le projet est construit sur une stack moderne (React, TypeScript, Vite, TailwindCSS) et un backend Supabase (PostgreSQL). Actuellement, la base de données est extrêmement robuste avec des règles strictes, des modèles transactionnels solides et une architecture de RLS (Row Level Security) très évoluée. Toutefois, le frontend souffre de nombreux décalages avec le backend : le mode "offline" n'est pas un vrai mode PWA (absence de service worker et manifest), la gestion des files d'attente (queue) pour la synchronisation présente des failles de boucle infinie, des requêtes sont à risque (utilisation de `.single()` hasardeuse dans les rapports), et certaines optimisations de performance sont à revoir sur la gestion du volume de données (récupération de grosses grappes sans pagination).

## 2. Architecture actuelle
- **Frontend** : React (v18), Vite, TypeScript, React Router, TailwindCSS + Shadcn/ui (Radix), Tanstack Query. Le routage est sécurisé et conditionné par le rôle auth.
- **Backend** : Supabase (PostgreSQL 15), authentification via `auth.users`, gestion de la logique d'insertions et géofencing côté serveur (via RPC `clock_in`, etc.).
- **Couplage** : Forte adhésion entre le Frontend React et les bases de données. L'architecture respecte majoritairement les patterns MV, avec néanmoins des `any` persistants côté TS. 

## 3. Cartographie fonctionnelle
A. **AUTHENTIFICATION** : Gérée via Supabase Auth + Trigger/Logique RLS imposant qu'un compte possède une `structure_id`. Un cycle de validation existe en arrière-plan (`pending`, `active`, `suspended`, `rejected`).
B. **UTILISATEURS / EMPLOYÉS** : Gestion des employés avec des profils centralisés et des logs d'actions (`employee_actions`).
C. **RÔLES ET PERMISSIONS** : Base de données-centric (admin, manager, employee), déterminés par RPC (`current_employee_role()`).
D. **STRUCTURES** : Conteneurs de base permettant l'étanchéité des données mutuelles via RLS (un manager ne pilote que `current_structure_id`).
E. **SITES** : Système multi-site (employé affecté à > 1 site via `employee_sites`), gestion GPS embarquée (`location_radius_m`).
F. **HORAIRES** : `site_work_schedules`, un gestion jour/jour avec gestion `work_start` et `work_end`. Validation des pointes et pauses (`break_start`, etc.).
G. **PRÉSENCES** : Implémentation lourde et tracée (`attendances` + `attendance_events` journalisés : CLOCK_IN, SITE_EXIT, CLOCK_OUT, etc.), qui relève les anomalies (`attendance_anomalies`).
H. **RAPPORTS** : Système rudimentaire dans le Front avec UI, posant des questions structurelles pour choisir le destinataire (Manager vs Admin).
I. **PWA / OFFLINE** : Simulation de offline via une file locale (`OFFLINE_QUEUE_KEY`). Pas de vrai support PWA déployé.

## 4. Cartographie de la base de données
- **auth.users** : Authentification globale (système).
- **employees** : Métadonnées des utilisateurs (`account_status`, `structure_id`, l'ancien `site_id` existant encore).
- **employee_roles** : Permissions fonctionnelles (`employee_id`, `role`).
- **structures**, **sites**, **employee_sites** : Hiérarchie spatiale et d'affectation. `sites` possède aussi `responsible_employee_id`. 
- **site_work_schedules** : Définit les horaires standard (avec jour férié/travaillé).
- **attendances** : Représente une session quotidienne d'un employé. 
- **attendance_events** : L'historique microscopique transactionnel (track gps en continu, events horodatés).
- **attendance_anomalies** : Lignes créées pour non-respect (late, out_of_zone).
- **employee_absences** : Table de congés.
- **reports** / **report_types** : Rapports.  
- **notifications**, **audit_logs**, **employee_actions** : Suivi des logs des responsables et messages temps-réel.

## 5. Relations entre les entités
```text
structures
    ↓ (1:N)
sites ← (1:N) → site_work_schedules
    ↑ (1:1 resp)
employees 

structures
    ↓ (1:N)
employees ← (1:1) → employee_roles
    ↓ (1:N)
employee_sites
    ↓ (N:1)
sites

employees
    ↓ (1:N)
attendances ← (1:N) → attendance_events
    ↓ (1:N)
attendance_anomalies
```

## 6. Audit RLS
La conception RLS est remarquable. 
- Les policies de Supabase interrogent des fonctions sécurisées (SECURITY DEFINER) comme `is_manager_of_site(site_id)` ou `employee_belongs_to_current_structure()`.
- L'utilisation de ces wrappers évite les récursions fréquentes (deadlocks) inhérents à PostgreSQL lors des requêtes inter-tables directes.
- **Vigilance** : Par nature, des fonctions comme `get_my_attendance_site` et `clock_in` contournent la RLS via "SECURITY DEFINER", mais elles imposent très rigoureusement des assertions logiques avant les mutations (`IF v_distance > v_radius THEN RAISE EXCEPTION`). Un code très sécurisé.

## 7. Audit authentification et permissions
L'UI bloque adéquatement l'utilisateur (ex: `useAuth` qui vérifie activement la désactivation/suspension de l'employé). Il y a tout de même un risque dans la récupération des droits Rôles via `.single()` : si pour une raison quelconque la BD autorise 2 rôles ou retourne array sur le JWT, cela peut bloquer. Néanmoins, l'inscription force un statut `pending` protégeant bien le périmètre non vérifié de la structure.

## 8. Audit employés et membres
Dans le Frontend (`Employees.tsx`), le traitement de l'affichage manque un peu de discernement et mélange la requête Data `is_active` de DB, la jointure de structure et le filtrage manuel JS en fin de parcours. Historiquement, le projet utilisait `employees.site_id` ; la tentative de coexistence avec `employee_sites` alourdit les requêtes. 

## 9. Audit structures
Dans l'usage, chaque manager et employé ne cible et ne connait qu'une et qu'une seule structure (son `structure_id`). Le décloisonnement inter-structures est interdit par DB. C'est strict et respecté.

## 10. Audit sites
Le module sites est correctement couplé aux horaires. Par contre, dans l'utilisation par le Frontend pour le pointage, aucune gestion de choix du site de travail n'apparaît. La RPC `get_my_attendance_site` fait un `SELECT LIMIT 1`. Pire, la nouvelle RPC crashe volontairement via un `RAISE EXCEPTION 'Multiple active sites assigned.'` s'il y a 2 affectations, forçant la refonte du UI client pour choisir. 

## 11. Audit horaires
La contrainte `work_start < work_end` et les pauses (`break_inside_work_check`) de la table `site_work_schedules` garantissent l'absence de données absurdes, mais ne traitent pas intrinsèquement les horaires de nuit traversant Minuit. Pour des agents de nuit, s'il y en a, la contrainte PostgreSQL et l'algorithmie frontend actuelle devront être adaptées.

## 12. Audit présence
1. *Que se passe-t-il si un employé oublie son départ ?* L'événement reste en `present`. Aucun script global cron/pg_bash n'existe dans les migrations pour venir forcer un Check-out "Missing" à minuit.
2. *Peut-il avoir 2 présences simultanées ?* Non, c'est vérifié `FOR UPDATE` dans la RPC.
3. *Vérification Outil Offline ?* La file d'attente (dans `Attendance.tsx`) garde les events en `localStorage: attendance_event_queue_v2` lors de perte internet. Cependant, lors de la reconnexion (`syncQueue()`), si une entrée fail par conflit métier (ex: "Déjà checké"), la promesse `try/catch` pousse ce log dans la variable locale de "Remaining", ne l'effacant jamais. La file va envoyer indéfiniment ce vieux log buggé.

## 13. Audit rapports
**Problème Majeur Identifié**. Le Frontend dans `Reports.tsx` `handleSubmit()` cherche activement à déterminer le destinataire en questionnant `.eq('structure_id', profile.structure_id).eq('is_active', true).single()`. Si la structure a *plus d'un* employé actif (ce qui est toujours le cas), PostgreSQL renverra l'erreur "`Multiple rows returned`", le `.single()` explosera bloquant l'envoi de rapports. L'interface doit chercher spécifiquement qui est le manager (ou utiliser un dropdown list).

## 14. Audit PWA / Offline
**OFFLINE PARTIEL (et imparfait).**
L'application ne dispose d'aucune configuration Web App Manifest légale (`manifest.json` manquant), et aucun Service Worker n'est compilé dans les bundles. Le support hors-ligne se limite à l'événement local JS `offline` interceptant l'UI, ce qui n'évitera pas une page blanche intégrale si le tracker recharge/relance l'URL en pleine forêt sans data-mobile. Une PWA exige que les assets soient installables (`CacheStorage`).

## 15. Audit frontend
L'UI avec Radix & Shadcn est excellente et s'incruste bien. 
Attention au design multi-rendus dans `Employees.tsx` (des listes complètes combinées à des mappings TS avec map-filter), ce qui peut saturer la RAM sur tel pour +500 employés.
La logique Loading via Supabase Auth `useAuth` protège extrêmement bien le refresh intempestif des vues (pas de sautes visuelles).

## 16. Audit frontend ↔ Supabase
L'application Front souffre de quelques vieilles conventions héritées (V1). Notamment l'appel pour les anomalies/managers. Supabase V3 est beaucoup plus structurant (RPC `clock_in` paramétrables à l'extrême). L'UI ne se sert parfois pas assez du moteur natif pgSql pour le traitement des datas complexes (les jointures Rôles/Employés).

## 17. Audit TypeScript
Un contrôle strict a été effectué (`npm run lint` & `npx tsc --noEmit`) : **0 Erreurs retournées**, le build passe parfaitement ! 
Néanmoins, de nombreux cast as `any` ou bypass TypeScript subsistent (surtout dans `Employees.tsx` l.278 sur `mapEmployees`). Les interfaces n'étant pas systématiquement alimentées par le générateur de Types TypeScript Supabase (`supabase gen types`), le risque de typage est constant mais le compilateur tolère la flexibilité acutelle.

## 18. Audit sécurité
- *IDOR* impossible (RLS très stricte via `current_structure_id`).
- *SECURITY DEFINER* maîtrisés (Les verrous inter-fonctions de RLS n'exposent pas le bypass métier car tous valident `is_active` avant exécution).
- Le risque d'usurper une latitude GPS est toujours présent côté Dev-Tools JS Navigateur, la solution serait un checksum ou un framework anti-spoofing natif.

## 19. Audit intégrité des données
Même si forte en DB, la persistance d'anciens champs (`employees.site_id`) malgré la création de l'excellente sous-table (`employee_sites`) génère de potentielles bifurcations de vérités. Les migrations V3 sont proactives mais le code source doit nettoyer le support de l'ancien modèle unique.

## 20. Fonctionnalités manquantes
A. **Totalement absentes** : Configuration PWA (ServiceWorker pour assets, IndexedDB pour requêtes) ; CRON/Job planifié Supabase pour nettoyer de minuit les pointages abandonnés par le salarié.
B. **Partiellement implémentées** : UI multi-sites de sélection du pointage pour l'employé libre de bouger.
C. **Implémentées mais incorrectes** : L'implémentation algorithmique de récupération du destinataire pour l'envoi de rapports (Crash du `.single()`). 

## 21. Bugs identifiés
- **File d'attente hors-ligne perpétuelle** : `syncQueue()` tente de réinsérer jusqu'à l'infini les requêtes en conflit.
- **Rapports inutilisables** : Erreur FATAL PostgreSQL Multiple Rows sur `Reports.tsx` `line 484` s'il y a plus d'un employé dans une structure (absence de filtre manager dans la recherche manager).
- **Routage multi-sites exceptionnel** : `get_my_attendance_site()` bloque intentionnellement l'assignation multiple sans UI front adaptée.

## 22. Matrice des problèmes

| ID | Domaine | Problème | Gravité | Impact | Fichier/Table | Solution |
|----|---------|----------|---------|--------|--------------|----------|
| 1  | RAPPORTS| Appel `single()` sur employees sans cible unique | 🔴 CRITIQUE | Envoi de report qui crashe systématiquement | `Reports.tsx` | Modifier la requête pour utiliser une table jointure sur role = 'manager' (ou liste dropdown). |
| 2  | PRÉSENCE| File d'attente offline non gérée à l'échec | ✅ RÉSOLU | Boucle infinie JS / Fausses données | `Attendance.tsx` | Le filtrage des erreurs rejette définitivement les anomalies (ex: 409). |
| 3  | PRÉSENCE| "Multiple active sites" lève Exception (RPC) | 🟠 IMPORTANT| Impossible de pointer | `get_my_attendance_site()` | Implémenter le choix modal de site avant le Clock-in dans le Frontend. |
| 4  | OFFLINE | Vraie structure PWA manquante (Manifest/SW) | 🟠 IMPORTANT| Mode hors-ligne non fonctionnel au reload | `index.html` / `public/` | Utiliser `@vite-pwa/plugin` et une vraie gestion de cache SW. |
| 5  | DB      | Redondance `site_id` / `employee_sites` | 🟡 MOYEN | Dette Technique | Table `Employees` | Retirer la colonne `site_id` devenue obsolète. |
| 6  | FRONTEND| Récupération excessive de Datas en RAM sur client | 🟡 MOYEN | RAM Bloat (Phone) | `Employees.tsx` | Gérer la pagination Supabase / lazyloading et filtres côté BD. |
| 7  | TYPES   | Laxisme TypeScript (`any`) | 🟢 MINEUR   | Fragilité bugs runtime | Tous `.tsx` | Générer et implémenter `Database` strict. |

## 23. Scénarios métier à tester
- SCÉNARIO 1 : Employé actif → arrivée → départ. *(Le GPS fonctionne, transaction atomique validée)*
- SCÉNARIO 2 : Employé → arrivée → oubli du départ. *(Échoue partiellement. Reste bloqué à "present" à Minuit)*
- SCÉNARIO 3 : Employé → double arrivée. *(Fonctionne, erreur traitée par DB mais le frontend l'accepte et bloque indéfiniment le `syncQueue`)*
- SCÉNARIO 5 : Employé → absence. *(Fonctionne, entités créées)*
- SCÉNARIO 6 : Employé → retard. *(Fonctionne, le check calcule le dépassement work_start)*
- SCÉNARIO 7 : Employé → mauvais site. *(GPS le bloque, vérification rigoureuse dans la DB V3, fonctionnel)*
- SCÉNARIO 8 : Employé → perte Internet (Reload Navigateur). *(Échoue radicalement (Dino Chrome) sans manifest + SW)*
- SCÉNARIO 13: Accès d'une structure A à structure B. *(Fonctionne, RLS parfaite ferme la DB)*

## 24. État d'avancement par fonctionnalité
- Authentification : **95%** 
- Employés : **85%** (Filtres efficaces, mais dette technique Front à nettoyer)
- Structures : **100%** (Gérée finement par la RLS)
- Sites : **75%** (Manque la gestion multi-site Front de la nouvelle DB V3)
- Horaires : **85%**
- Présences : **70%** (L'anomalie de caching PWA pénalise gravement ce métier prioritaire)
- Rapports : **60%** (Bug logiciel Frontend empêchant l'usage réel)
- RLS / Sécurité BD : **98%** (Travail majeur réalisé)
- Vraie PWA : **20%** 

## 25. Priorité des corrections
L'objectif est d'avoir un outil solide et professionnel au quotidien.

1. **PHASE 1 — SÉCURITÉ ET BUGS (Rapports)**
   Résoudre urgemment l'impossibilité d'émettre des rapports dus au parse DB trop permissif de `Reports.tsx` `.single()`.
2. **PHASE 3 — PRÉSENCE (Gestion des conflits)**
   Corriger la file d'attente (OfflineQueue) qui bloque indéfiniment en localstorage les pointages rejetés (comme "Déjà checké"). Créer une UI Front demandant "Sur quel site pointer aujourd'hui" pour les Multi-Sites au lieu de déclencher le `RAISE EXCEPTION` de DB `get_my_attendance_site`.
3. **PHASE 7 — OFFLINE / VRAIE PWA**
   Le grand enjeu de l'app. Installation en manifeste, ajout d'un plugin vite pour PWA (sw.js), mise en cache du shell HTML. Passer la file d'attente "Queue" du "localStorage" (trop instable) vers IndexedDb ("localforage" ou équivalent).
4. **PHASE 2 — NETTOYAGE BASE DE DONNÉES**
   Abandonner toute référence à `employees.site_id` pour que tout passe par le moderne et robuste `employee_sites`.
5. **PHASE 9 — OPTIMISATION**
   Mise en place de pagination (DataGrid) + Types stricts TS.

## 26. Feuille de route recommandée
- **Sprint 1 (Fondations immédiales - 1sem)** : Corriger le dysfonctionnement d'émission de rapports, gérer l'interface multi-site des checkins pour pallier aux nouvelles restrictions DB (V3), et corriger les plantages de queueing local.
- **Sprint 2 (PWA Core - 1sem)** : Déployer et configurer `@vite-pwa/plugin` pour isoler les bundles locaux. Améliorer la rétention IndexedDB de la queue. Gérer l'écran de Offline Reloading sans internet pour ouvrir quand même l'App.
- **Sprint 3 (Dette & Améliorations - 1sem)** : Nettoyer massivement le Javascript Frontend des résidus V1 (comme `employees.site_id` et le filtrage abusif), forcer les types Supabase, instancier un Job Supabase Cron pour purger les pointages non clôturés la nuit.

## 27. Conclusion
Le Projet est techniquement extrêmement impressionnant (côté Supabase Backend, avec une ingénierie de schémas, fonctions GPS mathématiques integrées et RLS qui frôle la perfection). 
Néanmoins, les modifications colossales de la V3 de Supabase n'ont pas encore été bien digérées par le Frontend. Certains ponts (comme l'appel du destinataire des rapports, ou le traitement strict des multi-sites par les requêtes React) ont laissé le code client instable. 
Dans l'immédiat, l'auditeur conseille un gel de l'ajout de nouvelles fonctionnalités Backend pour se concentrer à 100% sur le raffinement du Frontend, la mise en cache de vrais workers PWA, et la fluidité des requêtes, ce qui parachèvera une solution métier incontestablement haut-de-gamme.
