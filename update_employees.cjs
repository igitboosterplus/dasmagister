const fs = require('fs');
let code = fs.readFileSync('src/pages/Employees.tsx', 'utf8');

// Remplacement 1 : interface EmployeeItem - supprimer site_id singulier, ajouter sites (tableau)
const oldInterface = `interface EmployeeItem {
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
}`;

const newInterface = `interface EmployeeItem {
  id: string;

  first_name: string;
  last_name: string;

  phone: string | null;

  role: string;

  position: string;
  service: string;

  structure_id: string;
  structure_name: string;

  sites: { id: string; name: string }[];

  is_active: boolean;
  deactivated_at: string | null;
}`;

code = code.replace(oldInterface, newInterface);

// Remplacement 2 : state selectedSiteId -> selectedSiteIds (string[])
code = code.replace(
    `const [selectedSiteId, setSelectedSiteId] =
  useState<string>('none');`,
    `const [selectedSiteIds, setSelectedSiteIds] =
  useState<string[]>([]);`
);

// Remplacement 3 : requête active - ajouter employee_sites, supprimer sites directe
const oldActiveQuery = `          .select(\`
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
            \`)
          .eq('is_active', true)`;

const newActiveQuery = `          .select(\`
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
                name
              ),

              services (
                name
              ),

              structures (
                id,
                name
              ),

              employee_sites!inner (
                is_active,
                sites (
                  id,
                  name
                )
              )
            \`)
          .eq('is_active', true)
          .eq('employee_sites.is_active', true)`;

code = code.replace(oldActiveQuery, newActiveQuery);

// Remplacement 4 : requête inactifs - même ajustement
const oldInactiveQuery = `  await supabase
    .from('employees')
    .select(\`
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
    \`)
    .in('id', employeeIds)`;

const newInactiveQuery = `  await supabase
    .from('employees')
    .select(\`
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
        name
      ),

      services (
        name
      ),

      structures (
        id,
        name
      ),

      employee_sites (
        is_active,
        sites (
          id,
          name
        )
      )
    \`)
    .in('id', employeeIds)`;

code = code.replace(oldInactiveQuery, newInactiveQuery);

// Remplacement 5 : mapEmployees - supprimer site, ajouter sites[]
const oldMap = `      const site = Array.isArray(employee.sites)
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
      };`;

const newMap = `      const employeeSites: { id: string; name: string }[] = (
        Array.isArray(employee.employee_sites) ? employee.employee_sites : []
      )
        .filter((es: any) => es.is_active !== false)
        .map((es: any) => {
          const s = Array.isArray(es.sites) ? es.sites[0] : es.sites;
          return s ? { id: s.id, name: s.name } : null;
        })
        .filter(Boolean);

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

        sites: employeeSites,

        is_active: employee.is_active,

        deactivated_at:
          employee.deactivated_at || null,
      };`;

code = code.replace(oldMap, newMap);

// Remplacement 6 : openEditDialog - site_id -> sites
const oldOpenEdit = `  setSelectedRole(employee.role);

  setSelectedSiteId(
    employee.site_id || 'none'
  );

  setEditDialogOpen(true);`;

const newOpenEdit = `  setSelectedRole(employee.role);

  setSelectedSiteIds(
    employee.sites.map((s) => s.id)
  );

  setEditDialogOpen(true);`;

code = code.replace(oldOpenEdit, newOpenEdit);

// Remplacement 7 : handleUpdateEmployee - remplacer l'update site_id par employee_sites
const oldSiteUpdate = `    // ========================================================
    // 5. MISE À JOUR DU SITE
    // ========================================================

    const { error: siteError } = await supabase
      .from('employees')
      .update({
        site_id: newSiteId,
      })
      .eq('id', editingEmployee.id);

    if (siteError) {
      throw new Error(
        \`Impossible de modifier le site : \${siteError.message}\`
      );
    }`;

const newSiteUpdate = `    // ========================================================
    // 5. MISE À JOUR DES SITES (employee_sites)
    // ========================================================

    // Désactiver tous les sites actuels
    const { error: deactivateSitesError } = await supabase
      .from('employee_sites')
      .update({ is_active: false })
      .eq('employee_id', editingEmployee.id);

    if (deactivateSitesError) {
      throw new Error(
        \`Impossible de réinitialiser les sites : \${deactivateSitesError.message}\`
      );
    }

    // Activer (ou créer) chaque site sélectionné
    for (const siteId of selectedSiteIds) {
      // Tenter un upsert sur la clé (employee_id, site_id)
      const { error: upsertError } = await supabase
        .from('employee_sites')
        .upsert(
          {
            employee_id: editingEmployee.id,
            site_id: siteId,
            is_active: true,
          },
          { onConflict: 'employee_id,site_id', ignoreDuplicates: false }
        );

      if (upsertError) {
        throw new Error(
          \`Impossible d'affecter le site \${siteId} : \${upsertError.message}\`
        );
      }
    }`;

code = code.replace(oldSiteUpdate, newSiteUpdate);

// Remplacement 8 : Supprimer la logique newSiteId inutilisée
const oldSiteLogic = `    // ========================================================
    // 2. DÉTERMINATION DU SITE
    // ========================================================

    const newSiteId =
      selectedSiteId === 'none'
        ? null
        : selectedSiteId;

    // ========================================================
    // 3. VÉRIFICATION DU SITE
    // ========================================================

    if (role === 'manager' && newSiteId) {
      const selectedSite = sites.find(
        (site) => site.id === newSiteId
      );

      if (!selectedSite) {
        throw new Error(
          'Le site sélectionné est introuvable.'
        );
      }

      if (
        selectedSite.structure_id !==
        profile?.structure_id
      ) {
        throw new Error(
          'Vous ne pouvez affecter un employé qu\\'à un site de votre structure.'
        );
      }
    }`;

const newSiteLogic = `    // ========================================================
    // 2 & 3. VÉRIFICATION DES SITES
    // ========================================================

    if (role === 'manager' && selectedSiteIds.length > 0) {
      for (const siteId of selectedSiteIds) {
        const selectedSite = sites.find((site) => site.id === siteId);

        if (!selectedSite) {
          throw new Error('Un site sélectionné est introuvable.');
        }

        if (selectedSite.structure_id !== profile?.structure_id) {
          throw new Error(
            'Vous ne pouvez affecter un employé qu\\'à des sites de votre structure.'
          );
        }
      }
    }`;

code = code.replace(oldSiteLogic, newSiteLogic);

// Remplacement 9 : Colonne "Site" dans le tableau -> afficher les sites
const oldSiteCell = `                                 {/* SITE */}
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
                                 </td>`;

const newSiteCell = `                                 {/* SITES */}
                                 <td className="px-4 py-3 text-sm">
                                   {employee.sites.length === 0 ? (
                                     <span className="text-muted-foreground italic">
                                       Site non attribué
                                     </span>
                                   ) : (
                                     <div className="flex flex-wrap gap-1">
                                       {employee.sites.map((s) => (
                                         <span
                                           key={s.id}
                                           className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                                         >
                                           <Building2 className="h-3 w-3 text-muted-foreground" />
                                           {s.name}
                                         </span>
                                       ))}
                                     </div>
                                   )}
                                 </td>`;

code = code.replace(oldSiteCell, newSiteCell);

// Remplacement 10 : Select mono-site -> cases à cocher multi-sites dans le dialogue
const oldSiteSelect = `        {/* ==============================================
            SITE
        ============================================== */}

        <div className="space-y-2">

          <label className="text-sm font-medium">
            Site
          </label>

          <Select
            value={selectedSiteId}
            onValueChange={setSelectedSiteId}
          >

            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un site" />
            </SelectTrigger>

            <SelectContent>

              <SelectItem value="none">
                Aucun site
              </SelectItem>

              {sites
                .filter((site) => {
                  /*
                   * Pour un manager :
                   * uniquement les sites de sa structure.
                   */
                  if (
                    role === 'manager' &&
                    profile?.structure_id
                  ) {
                    return (
                      site.structure_id ===
                      profile.structure_id
                    );
                  }

                  return true;
                })
                .map((site) => (

                  <SelectItem
                    key={site.id}
                    value={site.id}
                  >
                    {site.name}
                  </SelectItem>

                ))}

            </SelectContent>

          </Select>

          <p className="
            text-xs
            text-muted-foreground
          ">
            Le site correspond au lieu d'affectation
            de l'employé.
          </p>

        </div>`;

const newSiteSelect = `        {/* ==============================================
            SITES (MULTI)
        ============================================== */}

        <div className="space-y-2">

          <label className="text-sm font-medium">
            Sites assignés
          </label>

          <div className="rounded-md border p-3 space-y-2 max-h-40 overflow-y-auto">
            {sites
              .filter((site) => {
                if (role === 'manager' && profile?.structure_id) {
                  return site.structure_id === profile.structure_id;
                }
                return true;
              })
              .map((site) => {
                const checked = selectedSiteIds.includes(site.id);
                return (
                  <label
                    key={site.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedSiteIds((prev) =>
                          checked
                            ? prev.filter((id) => id !== site.id)
                            : [...prev, site.id]
                        );
                      }}
                      className="h-4 w-4"
                    />
                    {site.name}
                  </label>
                );
              })}
            {sites.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucun site disponible.</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Un employé peut être assigné à plusieurs sites.
          </p>

        </div>`;

code = code.replace(oldSiteSelect, newSiteSelect);

// Remplacement 11 : filteredEmployees - supprimer le filtre sur site_name qui n'existe plus
code = code.replace(
    `        employee.site_name
          .toLowerCase()
          .includes(normalizedSearch)`,
    `        employee.sites.some((s) =>
          s.name.toLowerCase().includes(normalizedSearch)
        )`
);

fs.writeFileSync('src/pages/Employees.tsx', code);
console.log('Done');
