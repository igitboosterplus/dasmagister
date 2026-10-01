const fs = require('fs');

const path = 'src/pages/Dasboard/manager.tsx';
let manager = fs.readFileSync(path, 'utf8');

// 1. imports
manager = manager.replace(
    "import { useAuth } from '@/hooks/useAuth';",
    "import { useAuth } from '@/hooks/useAuth';\nimport { useToast } from '@/hooks/use-toast';\nimport { Button } from '@/components/ui/button';"
);

// 2. add interface for Employee
manager = manager.replace(
    "interface Structure {",
    "interface PendingEmployee {\n  id: string;\n  first_name: string;\n  last_name: string;\n  created_at: string;\n}\n\ninterface Structure {"
);

// 3. inside DashboardManager
manager = manager.replace(
    "const { role, profile } = useAuth();",
    "const { role, profile } = useAuth();\n  const { toast } = useToast();\n  const [pendingEmployees, setPendingEmployees] = useState<PendingEmployee[]>([]);\n  const [actionLoading, setActionLoading] = useState<string | null>(null);"
);

// 4. fetch pending employees
const fetchStr = `
        /*
         * ======================================================
         * 7. STATISTIQUES FINALES
         * ======================================================
         */
`;
const replaceFetchStr = `
        /*
         * ======================================================
         * 6.5. FETCH PENDING EMPLOYEES
         * ======================================================
         */
        const pendingRes = await supabase
          .from('employees')
          .select('id, first_name, last_name, created_at')
          .eq('structure_id', structureId)
          .eq('account_status', 'pending')
          .order('created_at', { ascending: false });

        if (!pendingRes.error && pendingRes.data) {
          setPendingEmployees(pendingRes.data);
        }

        /*
         * ======================================================
         * 7. STATISTIQUES FINALES
         * ======================================================
         */
`;
manager = manager.replace(fetchStr, replaceFetchStr);

// 5. approve method
const approveMethod = `
  // ==========================================================
  // APPROVE EMPLOYEE
  // ==========================================================
  const handleApprove = async (employeeId: string) => {
    try {
      setActionLoading(employeeId);
      const { error } = await supabase.rpc('approve_registration', {
        p_employee_id: employeeId
      });

      if (error) throw error;

      toast({
        title: 'Inscription validée',
        description: 'Le compte a été activé avec succès.',
      });

      setPendingEmployees((current) => current.filter((e) => e.id !== employeeId));
      
      // Update statistics
      setStats((prev) => ({
        ...prev,
        totalEmployees: prev.totalEmployees + 1,
        absentToday: prev.absentToday + 1,
      }));

    } catch (err: any) {
      console.error('Erreur validation:', err);
      toast({
        title: 'Erreur',
        description: err.message || 'Impossible de valider l\\'inscription',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const statCards = [
`;
manager = manager.replace("  const statCards = [", approveMethod);

// 6. UI for Pending employees
const pendingUI = `
        {/* ====================================================
            INSCRIPTIONS EN ATTENTE
        ==================================================== */}
        
        {pendingEmployees.length > 0 && (
          <Card className="mb-8 border-warning/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-warning">
                <AlertTriangle className="h-5 w-5" />
                Inscriptions en attente ({pendingEmployees.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingEmployees.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-muted">
                    <div>
                      <div className="font-semibold">{emp.first_name} {emp.last_name}</div>
                      <div className="text-xs text-muted-foreground">Inscrit le {new Date(emp.created_at).toLocaleDateString()}</div>
                      <div className="text-xs font-medium text-warning mt-1">Statut: En attente</div>
                    </div>
                    <div>
                      <Button 
                        onClick={() => handleApprove(emp.id)} 
                        disabled={actionLoading === emp.id}
                        size="sm"
                      >
                        {actionLoading === emp.id ? 'Validation...' : 'Valider'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ====================================================
            ERROR
        ==================================================== */}
`;
manager = manager.replace("        {/* ====================================================\n            ERROR\n        ==================================================== */}", pendingUI);

fs.writeFileSync(path, manager, 'utf8');
console.log('Modification completed successfully.');
