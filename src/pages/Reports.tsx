import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useToast } from '@/hooks/use-toast';

import {
  Loader2,
  Plus,
  FileText,
  Paperclip,
  Send,
  Forward,
  Download,
  User,
  Building2,
  Clock,
  CheckCircle2,
} from 'lucide-react';

import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ReportType {
  id: string;
  name: string;
}

interface ReportEmployee {
  id: string;
  first_name: string;
  last_name: string;
  structure_id: string | null;
  manager_id: string | null;
}

interface ReportTypeRelation {
  name: string;
}

interface Report {
  id: string;
  employee_id: string;
  report_type_id: string;
  title: string;
  description: string | null;
  file_url: string | null;
  submitted_at: string;
  validated_at: string | null;

  recipient_id: string | null;
  forwarded_by: string | null;
  forwarded_at: string | null;

  employees: ReportEmployee | null;
  report_types: ReportTypeRelation | null;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  structure_id: string | null;
  manager_id: string | null;
}

interface NewReport {
  title: string;
  description: string;
  typeId: string;
  file: File | null;
}

type ReportTab = 'received' | 'mine' | 'all';

export default function Reports() {
  const { profile, role } = useAuth();
  const { toast } = useToast();

  const [reports, setReports] = useState<Report[]>([]);
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  const [isCreating, setIsCreating] = useState(false);

  const [selectedReport, setSelectedReport] =
    useState<Report | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isForwardOpen, setIsForwardOpen] = useState(false);

  const [adminId, setAdminId] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);

  const [activeTab, setActiveTab] =
    useState<ReportTab>('received');

  const [newReport, setNewReport] = useState<NewReport>({
    title: '',
    description: '',
    typeId: '',
    file: null,
  });

  /**
   * ============================================================
   * HELPERS
   * ============================================================
   */

  const getCurrentEmployeeId = () => {
    return profile?.id || null;
  };

  const getFileName = (fileUrl: string | null) => {
    if (!fileUrl) return null;

    const parts = fileUrl.split('/');
    return parts[parts.length - 1] || 'Pièce jointe';
  };

  const formatDate = (date: string) => {
    return format(
      new Date(date),
      'dd MMM yyyy à HH:mm',
      {
        locale: fr,
      }
    );
  };

  /**
   * ============================================================
   * LOAD REPORT TYPES
   * ============================================================
   */

  const loadReportTypes = async () => {
    const { data, error } = await supabase
      .from('report_types')
      .select('id, name')
      .order('name');

    if (error) {
      console.error(
        'Erreur chargement types rapports:',
        error
      );

      toast({
        title: 'Erreur',
        description:
          'Impossible de charger les types de rapports.',
        variant: 'destructive',
      });

      return;
    }

    setReportTypes(data || []);
  };

  /**
   * ============================================================
   * LOAD ADMIN
   * ============================================================
   */

  const loadAdmin = async () => {
    const { data, error } = await supabase
      .from('employee_roles')
      .select(`
        employee_id,
        role
      `)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        'Erreur récupération admin:',
        error
      );

      return;
    }

    setAdminId(data?.employee_id || null);
  };

  /**
   * ============================================================
   * LOAD EMPLOYEES
   *
   * Utilisé principalement par le manager pour connaître
   * les employés dont il est responsable.
   * ============================================================
   */

  const loadEmployees = async () => {
    if (!profile) return;

    const { data, error } = await supabase
      .from('employees')
      .select(`
        id,
        first_name,
        last_name,
        structure_id,
        manager_id
      `)
      .eq('is_active', true);

    if (error) {
      console.error(
        'Erreur chargement employés:',
        error
      );

      return;
    }

    setEmployees(data || []);
  };

  /**
   * ============================================================
   * LOAD REPORTS
   * ============================================================
   */

  const loadReports = async () => {
    if (!profile) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('reports')
      .select(`
        id,
        employee_id,
        report_type_id,
        title,
        description,
        file_url,
        submitted_at,
        validated_at,
        recipient_id,
        forwarded_by,
        forwarded_at,

       employees:employees!reports_employee_id_fkey (
          id,
          first_name,
          last_name,
          structure_id,
          manager_id
        ),

         report_types:report_types!reports_report_type_id_fkey (
          name
        )
      `)
      .order('submitted_at', {
        ascending: false,
      });

    if (error) {
      console.error(
        'Erreur récupération rapports:',
        error
      );

      toast({
        title: 'Erreur',
        description:
          'Impossible de charger les rapports.',
        variant: 'destructive',
      });

      setReports([]);
      setLoading(false);

      return;
    }

    setReports((data || []) as Report[]);
    setLoading(false);
  };

  /**
   * ============================================================
   * INITIAL LOAD
   * ============================================================
   */

  useEffect(() => {
    if (!profile) return;

    const initialize = async () => {
      await Promise.all([
        loadReportTypes(),
        loadReports(),
        loadAdmin(),
        loadEmployees(),
      ]);
    };

    initialize();
  }, [profile]);

  /**
   * ============================================================
   * CREATE REPORT
   * ============================================================
   */

  const handleSubmit = async (
    e: React.FormEvent
  ) => {
    e.preventDefault();

    if (!profile) return;

    if (!newReport.typeId) {
      toast({
        title: 'Type requis',
        description:
          'Veuillez sélectionner un type de rapport.',
        variant: 'destructive',
      });

      return;
    }

    if (!newReport.title.trim()) {
      toast({
        title: 'Titre requis',
        description:
          'Veuillez saisir le titre du rapport.',
        variant: 'destructive',
      });

      return;
    }

    setSubmitting(true);

    try {
      /**
       * --------------------------------------------------------
       * 1. Déterminer le destinataire
       * --------------------------------------------------------
       */

      let recipientId: string | null = null;

      /**
       * Employé :
       * son rapport est envoyé à son manager.
       */

      if (role === 'employee') {
        recipientId = profile.manager_id || null;

        if (!recipientId) {
          throw new Error(
            'Aucun manager n’est associé à votre profil.'
          );
        }
      }

      /**
       * Manager :
       * son rapport est envoyé à l'administration.
       */

      if (role === 'manager') {
        recipientId = adminId;

        if (!recipientId) {
          throw new Error(
            'Aucun administrateur n’a été trouvé.'
          );
        }
      }

      /**
       * Admin :
       * on ne crée normalement pas de rapport depuis
       * cette interface.
       */

      if (role === 'admin') {
        throw new Error(
          'L’administrateur ne peut pas soumettre de rapport depuis cette interface.'
        );
      }

      /**
       * --------------------------------------------------------
       * 2. Upload fichier
       * --------------------------------------------------------
       */

      let fileUrl: string | null = null;

      if (newReport.file) {
        const file = newReport.file;

        const fileExtension =
          file.name.split('.').pop();

        const fileName = `${crypto.randomUUID()}.${
          fileExtension || 'file'
        }`;

        const filePath = `reports/${profile.id}/${fileName}`;

        const { error: uploadError } =
          await supabase.storage
            .from('reports')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: false,
            });

        if (uploadError) {
          throw uploadError;
        }

        /**
         * Si ton bucket est public, on récupère
         * l'URL publique.
         *
         * Si ton bucket est privé, il faudra plutôt
         * stocker filePath et générer une signed URL
         * lors de l'affichage.
         */

        const { data: publicUrlData } =
          supabase.storage
            .from('reports')
            .getPublicUrl(filePath);

        fileUrl =
          publicUrlData.publicUrl;
      }

      /**
       * --------------------------------------------------------
       * 3. Création du rapport
       * --------------------------------------------------------
       */

      const { error: insertError } =
        await supabase
          .from('reports')
          .insert({
            employee_id: profile.id,
            report_type_id: newReport.typeId,
            title: newReport.title.trim(),
            description:
              newReport.description.trim() ||
              null,
            file_url: fileUrl,
            recipient_id: recipientId,
          });

      if (insertError) {
        throw insertError;
      }

      toast({
        title: 'Rapport envoyé',
        description:
          role === 'employee'
            ? 'Votre rapport a été envoyé à votre manager.'
            : 'Votre rapport a été envoyé à l’administration.',
      });

      setNewReport({
        title: '',
        description: '',
        typeId: '',
        file: null,
      });

      setIsCreating(false);

      await loadReports();
    } catch (error: any) {
      console.error(
        'Erreur création rapport:',
        error
      );

      toast({
        title: 'Erreur',
        description:
          error?.message ||
          'Impossible de créer le rapport.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * ============================================================
   * FORWARD REPORT
   *
   * Manager → Admin
   * ============================================================
   */

  const handleForwardReport = async () => {
    if (!profile || !selectedReport) return;

    if (role !== 'manager') return;

    if (!adminId) {
      toast({
        title: 'Erreur',
        description:
          'Aucun administrateur n’a été trouvé.',
        variant: 'destructive',
      });

      return;
    }

    setForwarding(true);

    try {
      const { error } = await supabase
        .from('reports')
        .update({
          recipient_id: adminId,
          forwarded_by: profile.id,
          forwarded_at: new Date().toISOString(),
        })
        .eq('id', selectedReport.id);

      if (error) {
        throw error;
      }

      toast({
        title: 'Rapport transmis',
        description:
          'Le rapport a été transmis à l’administration.',
      });

      setIsForwardOpen(false);
      setSelectedReport(null);

      await loadReports();
    } catch (error: any) {
      console.error(
        'Erreur transfert rapport:',
        error
      );

      toast({
        title: 'Erreur',
        description:
          error?.message ||
          'Impossible de transmettre le rapport.',
        variant: 'destructive',
      });
    } finally {
      setForwarding(false);
    }
  };

  /**
   * ============================================================
   * DOWNLOAD / OPEN FILE
   * ============================================================
   */

  const handleOpenFile = async (
    fileUrl: string
  ) => {
    window.open(
      fileUrl,
      '_blank',
      'noopener,noreferrer'
    );
  };

  /**
   * ============================================================
   * REPORT FILTERS
   * ============================================================
   */

  const currentEmployeeId =
    getCurrentEmployeeId();

  /**
   * EMPLOYEE
   *
   * Seulement ses propres rapports.
   */

  const employeeReports = reports.filter(
    (report) =>
      report.employee_id ===
      currentEmployeeId
  );

  /**
   * MANAGER
   *
   * Rapports reçus des employés dont
   * manager_id = manager actuel.
   */

  const managerReceivedReports =
    reports.filter((report) => {
      if (
        role !== 'manager' ||
        !currentEmployeeId
      ) {
        return false;
      }

      return (
        report.employee_id !==
          currentEmployeeId &&
        report.employees?.manager_id ===
          currentEmployeeId
      );
    });

  /**
   * Rapports créés par le manager.
   */

  const managerOwnReports = reports.filter(
    (report) =>
      role === 'manager' &&
      report.employee_id ===
        currentEmployeeId
  );

  /**
   * ADMIN
   *
   * Rapports directement destinés à l'admin
   * ou transférés à l'admin.
   */

  const adminReceivedReports =
    reports.filter((report) => {
      if (role !== 'admin') return false;

      return (
        report.recipient_id ===
        currentEmployeeId
      );
    });

  /**
   * ============================================================
   * REPORT CARD
   * ============================================================
   */

  const renderReportCard = (
    report: Report,
    showForwardButton = false
  ) => {
    const employeeName =
      report.employees
        ? `${report.employees.first_name} ${report.employees.last_name}`
        : 'Utilisateur inconnu';

    const reportType =
      report.report_types?.name ||
      'Général';

    return (
      <Card
        key={report.id}
        className="hover:shadow-md transition-shadow"
      >
        <CardHeader className="pb-3">
          <div className="flex justify-between items-start gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded">
              {reportType}
            </span>

            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatDate(
                report.submitted_at
              )}
            </span>
          </div>

          <CardTitle className="text-lg mt-3 line-clamp-2">
            {report.title}
          </CardTitle>

          <CardDescription className="text-xs flex items-center gap-1 mt-1">
            <User className="h-3 w-3" />

            {employeeName}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
            {report.description ||
              'Aucune description.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedReport(report);
                setIsDetailsOpen(true);
              }}
            >
              <FileText className="h-4 w-4 mr-2" />
              Consulter
            </Button>

            {report.file_url && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  handleOpenFile(
                    report.file_url!
                  )
                }
              >
                <Download className="h-4 w-4 mr-2" />
                Pièce jointe
              </Button>
            )}

            {showForwardButton &&
              !report.forwarded_at && (
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedReport(report);
                    setIsForwardOpen(true);
                  }}
                >
                  <Forward className="h-4 w-4 mr-2" />
                  Transmettre
                </Button>
              )}

            {report.forwarded_at && (
              <span className="inline-flex items-center text-xs text-muted-foreground px-2 py-1">
                <CheckCircle2 className="h-3 w-3 mr-1" />

                Transmis à l'administration
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * ============================================================
   * LOADING
   * ============================================================
   */

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  /**
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <DashboardLayout>
      <div className="animate-fade-in">
        {/* =====================================================
            HEADER
        ====================================================== */}

        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="page-title">
              Rapports
            </h1>

            <p className="text-muted-foreground mt-1 text-sm">
              {role === 'admin'
                ? 'Rapports reçus des managers'
                : role === 'manager'
                ? 'Gestion des rapports de votre équipe'
                : 'Historique de vos rapports'}
            </p>
          </div>

          {(role === 'employee' ||
            role === 'manager') && (
            <Button
              onClick={() =>
                setIsCreating(
                  !isCreating
                )
              }
              variant={
                isCreating
                  ? 'outline'
                  : 'default'
              }
            >
              {isCreating ? (
                'Fermer'
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau rapport
                </>
              )}
            </Button>
          )}
        </div>

        {/* =====================================================
            CREATE FORM
        ====================================================== */}

        {isCreating &&
          (role === 'employee' ||
            role === 'manager') && (
            <Card className="mb-8 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle>
                  Nouveau rapport
                </CardTitle>

                <CardDescription>
                  {role === 'employee'
                    ? 'Votre rapport sera envoyé à votre manager.'
                    : 'Votre rapport sera envoyé à l’administration.'}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form
                  onSubmit={handleSubmit}
                  className="space-y-4 max-w-2xl"
                >
                  <div className="space-y-2">
                    <Label>
                      Type de rapport
                    </Label>

                    <Select
                      value={
                        newReport.typeId
                      }
                      onValueChange={(
                        value
                      ) =>
                        setNewReport(
                          (prev) => ({
                            ...prev,
                            typeId: value,
                          })
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un type" />
                      </SelectTrigger>

                      <SelectContent>
                        {reportTypes.map(
                          (type) => (
                            <SelectItem
                              key={
                                type.id
                              }
                              value={
                                type.id
                              }
                            >
                              {type.name}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Titre
                    </Label>

                    <Input
                      required
                      value={
                        newReport.title
                      }
                      onChange={(e) =>
                        setNewReport(
                          (prev) => ({
                            ...prev,
                            title:
                              e.target
                                .value,
                          })
                        )
                      }
                      placeholder="Ex : Rapport hebdomadaire"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Description
                    </Label>

                    <Textarea
                      value={
                        newReport.description
                      }
                      onChange={(e) =>
                        setNewReport(
                          (prev) => ({
                            ...prev,
                            description:
                              e.target
                                .value,
                          })
                        )
                      }
                      placeholder="Décrivez votre activité, les événements, difficultés ou résultats..."
                      rows={5}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Pièce jointe
                    </Label>

                    <Input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                      onChange={(e) =>
                        setNewReport(
                          (prev) => ({
                            ...prev,
                            file:
                              e.target
                                .files?.[0] ||
                              null,
                          })
                        )
                      }
                    />

                    {newReport.file && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />

                        {newReport.file
                          .name}
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={
                      submitting ||
                      !newReport.typeId ||
                      !newReport.title.trim()
                    }
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Envoi...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Envoyer le rapport
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

        {/* =====================================================
            EMPLOYEE
        ====================================================== */}

        {role === 'employee' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employeeReports.map(
              (report) =>
                renderReportCard(report)
            )}

            {employeeReports.length ===
              0 && (
              <EmptyState message="Vous n'avez encore soumis aucun rapport." />
            )}
          </div>
        )}

        {/* =====================================================
            MANAGER
        ====================================================== */}

        {role === 'manager' && (
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(
                value as ReportTab
              )
            }
          >
            <TabsList className="mb-6">
              <TabsTrigger value="received">
                Rapports reçus
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs">
                  {
                    managerReceivedReports.length
                  }
                </span>
              </TabsTrigger>

              <TabsTrigger value="mine">
                Mes rapports
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs">
                  {
                    managerOwnReports.length
                  }
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="received">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {managerReceivedReports.map(
                  (report) =>
                    renderReportCard(
                      report,
                      true
                    )
                )}

                {managerReceivedReports.length ===
                  0 && (
                  <EmptyState message="Aucun rapport reçu de vos employés." />
                )}
              </div>
            </TabsContent>

            <TabsContent value="mine">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {managerOwnReports.map(
                  (report) =>
                    renderReportCard(report)
                )}

                {managerOwnReports.length ===
                  0 && (
                  <EmptyState message="Vous n'avez encore soumis aucun rapport à l'administration." />
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* =====================================================
            ADMIN
        ====================================================== */}

        {role === 'admin' && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adminReceivedReports.map(
                (report) =>
                  renderReportCard(report)
              )}

              {adminReceivedReports.length ===
                0 && (
                <EmptyState message="Aucun rapport reçu pour le moment." />
              )}
            </div>
          </div>
        )}

        {/* =====================================================
            DETAILS DIALOG
        ====================================================== */}

        <Dialog
          open={isDetailsOpen}
          onOpenChange={
            setIsDetailsOpen
          }
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedReport?.title}
              </DialogTitle>

              <DialogDescription>
                Détails du rapport
              </DialogDescription>
            </DialogHeader>

            {selectedReport && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Auteur
                    </p>

                    <p className="font-medium mt-1">
                      {selectedReport
                        .employees
                        ? `${selectedReport.employees.first_name} ${selectedReport.employees.last_name}`
                        : 'Inconnu'}
                    </p>
                  </div>

                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Type
                    </p>

                    <p className="font-medium mt-1">
                      {selectedReport
                        .report_types
                        ?.name ||
                        'Général'}
                    </p>
                  </div>

                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Date d'envoi
                    </p>

                    <p className="font-medium mt-1 flex items-center gap-1">
                      <Clock className="h-4 w-4" />

                      {formatDate(
                        selectedReport.submitted_at
                      )}
                    </p>
                  </div>

                  {selectedReport
                    .forwarded_at && (
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">
                        Transfert
                      </p>

                      <p className="font-medium mt-1 flex items-center gap-1">
                        <Forward className="h-4 w-4" />

                        {formatDate(
                          selectedReport.forwarded_at
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">
                    Description
                  </p>

                  <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                    {selectedReport
                      .description ||
                      'Aucune description.'}
                  </div>
                </div>

                {selectedReport.file_url && (
                  <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Paperclip className="h-5 w-5 text-primary" />

                      <div>
                        <p className="text-sm font-medium">
                          Pièce jointe
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {getFileName(
                            selectedReport.file_url
                          )}
                        </p>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleOpenFile(
                          selectedReport.file_url!
                        )
                      }
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Ouvrir
                    </Button>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  setIsDetailsOpen(false)
                }
              >
                Fermer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* =====================================================
            FORWARD DIALOG
        ====================================================== */}

        <Dialog
          open={isForwardOpen}
          onOpenChange={
            setIsForwardOpen
          }
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Transmettre le rapport
              </DialogTitle>

              <DialogDescription>
                Ce rapport sera transmis à
                l'administration.
              </DialogDescription>
            </DialogHeader>

            {selectedReport && (
              <div className="rounded-lg border p-4 space-y-2">
                <p className="font-medium">
                  {selectedReport.title}
                </p>

                <p className="text-sm text-muted-foreground">
                  Auteur :{' '}
                  {selectedReport
                    .employees
                    ? `${selectedReport.employees.first_name} ${selectedReport.employees.last_name}`
                    : 'Inconnu'}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  setIsForwardOpen(false)
                }
                disabled={forwarding}
              >
                Annuler
              </Button>

              <Button
                onClick={
                  handleForwardReport
                }
                disabled={forwarding}
              >
                {forwarding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Transmission...
                  </>
                ) : (
                  <>
                    <Forward className="h-4 w-4 mr-2" />
                    Transmettre à l'administration
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

/**
 * ============================================================
 * EMPTY STATE
 * ============================================================
 */

function EmptyState({
  message,
}: {
  message: string;
}) {
  return (
    <div className="col-span-full py-16 text-center text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
      <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />

      <p>{message}</p>
    </div>
  );
}