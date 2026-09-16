import { useCallback, useEffect, useMemo, useState } from 'react';

import DashboardLayout from '@/components/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  Filter,
  Forward,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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

import { Badge } from '@/components/ui/badge';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { ScrollArea } from '@/components/ui/scroll-area';

import { format } from 'date-fns';
import { fr } from 'date-fns/locale';


// ============================================================
// TYPES
// ============================================================

interface ReportType {
  id: string;
  name: string;
}

interface ReportEmployee {
  id: string;
  first_name: string;
  last_name: string;
  structure_id: string | null;
}

interface ReportTypeRelation {
  name: string;
}

interface ReportAttachment {
  id: string;
  report_id: string;
  file_name: string;
  file_path: string;
  file_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
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

  structure_id: string | null;
  site_id: string | null;

  author_employee_id: string | null;
  recipient_employee_id: string | null;

  status: string;

  received_at: string | null;

  employees?: ReportEmployee | null;
  report_types: ReportTypeRelation | null;

  attachments: ReportAttachment[];
}

interface NewReport {
  title: string;
  description: string;
  typeId: string;
  files: File[];
}

interface StructureManager {
  id: string;
  first_name: string;
  last_name: string;
}

type ReportTab = 'received' | 'mine';

type PreviewType = 'image' | 'pdf' | 'unsupported';


// ============================================================
// CONSTANTES
// ============================================================

const STORAGE_BUCKET = 'reports';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  submitted: 'Soumis',
  received: 'Reçu',
  forwarded: 'Transmis',
  reviewed: 'Examiné',
  archived: 'Archivé',
  rejected: 'Rejeté',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  forwarded: 'bg-purple-100 text-purple-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};


// ============================================================
// HELPERS
// ============================================================

const getStatusLabel = (status: string) => {
  return STATUS_LABELS[status] ?? status;
};

const getStatusClass = (status: string) => {
  return STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700';
};

const isImageFile = (attachment: ReportAttachment) => {
  if (attachment.mime_type?.startsWith('image/')) {
    return true;
  }

  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(
    attachment.file_name,
  );
};

const isPdfFile = (attachment: ReportAttachment) => {
  if (attachment.mime_type === 'application/pdf') {
    return true;
  }

  return /\.pdf$/i.test(attachment.file_name);
};

const getFileIcon = (attachment: ReportAttachment) => {
  if (isImageFile(attachment)) {
    return FileImage;
  }

  if (isPdfFile(attachment)) {
    return FileText;
  }

  return File;
};

const formatFileSize = (bytes: number | null) => {
  if (!bytes) {
    return 'Taille inconnue';
  }

  if (bytes < 1024) {
    return `${bytes} octets`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} Ko`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};


// ============================================================
// COMPOSANT
// ============================================================

export default function Reports() {
  const { profile, role } = useAuth();

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [reports, setReports] = useState<Report[]>([]);
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);

  // ----------------------------------------------------------
  // LOADING
  // ----------------------------------------------------------

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // ----------------------------------------------------------
  // MANAGER
  // ----------------------------------------------------------

  const [structureManager, setStructureManager] =
    useState<StructureManager | null>(null);

  // ----------------------------------------------------------
  // NEW REPORT
  // ----------------------------------------------------------

  const [newReport, setNewReport] = useState<NewReport>({
    typeId: '',
    title: '',
    description: '',
    files: [],
  });

  const [isNewReportOpen, setIsNewReportOpen] = useState(false);

  // ----------------------------------------------------------
  // DETAILS
  // ----------------------------------------------------------

  const [selectedReport, setSelectedReport] =
    useState<Report | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // ----------------------------------------------------------
  // PREVIEW
  // ----------------------------------------------------------

  const [previewAttachment, setPreviewAttachment] =
    useState<ReportAttachment | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [previewType, setPreviewType] =
    useState<PreviewType>('unsupported');

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // ----------------------------------------------------------
  // FILTERS
  // ----------------------------------------------------------

  const [activeTab, setActiveTab] =
    useState<ReportTab>('received');

  const [search, setSearch] = useState('');

  const [statusFilter, setStatusFilter] =
    useState<string>('all');

  const [typeFilter, setTypeFilter] =
    useState<string>('all');

  // ----------------------------------------------------------
  // FORWARD
  // ----------------------------------------------------------

  const [forwardingReportId, setForwardingReportId] =
    useState<string | null>(null);


  // ==========================================================
  // LOAD REPORT TYPES
  // ==========================================================

  const loadReportTypes = useCallback(async () => {
    const { data, error } = await supabase
      .from('report_types')
      .select('id, name')
      .order('name');

    if (error) {
      console.error(
        'Erreur chargement types de rapports:',
        error,
      );

      return;
    }

    setReportTypes(data ?? []);
  }, []);


  // ==========================================================
  // LOAD REPORTS
  // ==========================================================

 const loadReports = useCallback(async () => {
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
      structure_id,
      site_id,
      author_employee_id,
      recipient_employee_id,
      status,
      received_at,

      report_types (
        name
      ),

      attachments:report_attachments (
        id,
        report_id,
        file_name,
        file_path,
        file_url,
        mime_type,
        file_size,
        created_at
      )
    `)
    .order('submitted_at', {
      ascending: false,
    });

  if (error) {
    console.error(
      'Erreur chargement rapports:',
      error
    );

    return;
  }

  setReports(
    (data ?? []) as unknown as Report[]
  );
}, []);


  // ==========================================================
  // LOAD STRUCTURE MANAGER
  // ==========================================================

  const loadStructureManager = useCallback(async () => {
    if (role !== 'employee') {
      return;
    }

    const { data, error } = await supabase.rpc(
      'get_current_structure_manager',
    );

    if (error) {
      console.error(
        'Erreur récupération manager:',
        error,
      );

      setStructureManager(null);

      return;
    }

    setStructureManager(
      (data?.[0] ?? null) as StructureManager | null,
    );
  }, [role]);


  // ==========================================================
  // INITIALIZATION
  // ==========================================================

  const initialize = useCallback(async () => {
    setLoading(true);

    try {
      await Promise.all([
        loadReportTypes(),
        loadReports(),
        role === 'employee'
          ? loadStructureManager()
          : Promise.resolve(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    loadReportTypes,
    loadReports,
    loadStructureManager,
    role,
  ]);


  useEffect(() => {
    initialize();
  }, [initialize]);


  // ==========================================================
  // CURRENT REPORTS
  // ==========================================================

  const employeeReports = useMemo(() => {
    if (!profile) {
      return [];
    }

    return reports.filter(
      (report) =>
        report.employee_id === profile.id ||
        report.author_employee_id === profile.id,
    );
  }, [reports, profile]);


  const managerReceivedReports = useMemo(() => {
    if (!profile) {
      return [];
    }

    return reports.filter(
      (report) =>
        report.recipient_employee_id === profile.id ||
        report.recipient_id === profile.id,
    );
  }, [reports, profile]);


  const managerOwnReports = useMemo(() => {
    if (!profile) {
      return [];
    }

    return reports.filter(
      (report) =>
        report.employee_id === profile.id ||
        report.author_employee_id === profile.id,
    );
  }, [reports, profile]);


  const adminReceivedReports = useMemo(() => {
    if (!profile) {
      return [];
    }

    return reports.filter(
      (report) =>
        report.recipient_employee_id === profile.id ||
        report.recipient_id === profile.id,
    );
  }, [reports, profile]);


  // ==========================================================
  // ROLE LIST
  // ==========================================================

  const roleReports = useMemo(() => {
    if (role === 'employee') {
      return employeeReports;
    }

    if (role === 'manager') {
      return activeTab === 'received'
        ? managerReceivedReports
        : managerOwnReports;
    }

    if (role === 'admin') {
      return adminReceivedReports;
    }

    return [];
  }, [
    role,
    activeTab,
    employeeReports,
    managerReceivedReports,
    managerOwnReports,
    adminReceivedReports,
  ]);


  // ==========================================================
  // FILTERED REPORTS
  // ==========================================================

  const filteredReports = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return roleReports.filter((report) => {
      // ------------------------------------------------------
      // STATUS
      // ------------------------------------------------------

      if (
        statusFilter !== 'all' &&
        report.status !== statusFilter
      ) {
        return false;
      }

      // ------------------------------------------------------
      // TYPE
      // ------------------------------------------------------

      if (
        typeFilter !== 'all' &&
        report.report_type_id !== typeFilter
      ) {
        return false;
      }

      // ------------------------------------------------------
      // SEARCH
      // ------------------------------------------------------

      if (normalizedSearch) {
        const searchable = [
          report.title,
          report.description ?? '',
          report.report_types?.name ?? '',
          report.employees?.first_name ?? '',
          report.employees?.last_name ?? '',
        ]
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(normalizedSearch)) {
          return false;
        }
      }

      return true;
    });
  }, [
    roleReports,
    search,
    statusFilter,
    typeFilter,
  ]);


  // ==========================================================
  // FILE SELECTION
  // ==========================================================

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(
      event.target.files ?? [],
    );

    setNewReport((previous) => ({
      ...previous,
      files: selectedFiles,
    }));

    event.target.value = '';
  };


  // ==========================================================
  // REMOVE SELECTED FILE
  // ==========================================================

  const removeSelectedFile = (index: number) => {
    setNewReport((previous) => ({
      ...previous,
      files: previous.files.filter(
        (_, fileIndex) => fileIndex !== index,
      ),
    }));
  };


  // ==========================================================
  // RESET FORM
  // ==========================================================

  const resetNewReport = () => {
    setNewReport({
      typeId: '',
      title: '',
      description: '',
      files: [],
    });
  };


  // ==========================================================
  // CREATE REPORT
  // ==========================================================

  const handleSubmit = async () => {
    if (!profile) {
      return;
    }

    if (role === 'admin') {
      alert(
        'Un administrateur ne peut pas envoyer un rapport depuis cette interface.',
      );

      return;
    }

    if (!profile.structure_id) {
      alert(
        'Votre compte n’est associé à aucune structure.',
      );

      return;
    }

    if (!newReport.typeId) {
      alert(
        'Veuillez sélectionner un type de rapport.',
      );

      return;
    }

    if (!newReport.title.trim()) {
      alert(
        'Veuillez renseigner le titre du rapport.',
      );

      return;
    }

    setSubmitting(true);

    const uploadedPaths: string[] = [];

    try {
      // ------------------------------------------------------
      // DESTINATAIRE
      // ------------------------------------------------------

      let recipientId: string | null = null;

      // EMPLOYÉ -> MANAGER DE SA STRUCTURE
      if (role === 'employee') {
        let manager = structureManager;

        if (!manager) {
          const { data, error } = await supabase.rpc(
            'get_current_structure_manager',
          );

          if (error) {
            throw new Error(
              `Impossible de récupérer le manager : ${error.message}`,
            );
          }

          manager =
            (data?.[0] ?? null) as StructureManager | null;
        }

        if (!manager) {
          throw new Error(
            'Aucun manager actif n’a été trouvé dans votre structure.',
          );
        }

        recipientId = manager.id;
      }

      // MANAGER -> ADMIN
      if (role === 'manager') {
        const { data, error } =
          await supabase.rpc('get_current_admin');

        if (error) {
          throw new Error(
            `Impossible de récupérer l'administrateur : ${error.message}`,
          );
        }

        const admin =
          (data?.[0] ?? null) as StructureManager | null;

        if (!admin) {
          throw new Error(
            'Aucun administrateur actif n’a été trouvé dans le système.',
          );
        }

        recipientId = admin.id;
      }

      if (!recipientId) {
        throw new Error(
          'Impossible de déterminer le destinataire du rapport.',
        );
      }


      // ------------------------------------------------------
      // CRÉATION DU RAPPORT
      // ------------------------------------------------------

      const { data: createdReport, error: reportError } =
        await supabase
          .from('reports')
          .insert({
            employee_id: profile.id,

            author_employee_id: profile.id,

            structure_id: profile.structure_id,

            report_type_id: newReport.typeId,

            title: newReport.title.trim(),

            description:
              newReport.description.trim() || null,

            file_url: null,

            recipient_employee_id: recipientId,

            recipient_id: recipientId,

            status: 'submitted',

            submitted_at: new Date().toISOString(),
          })
          .select('id')
          .single();

      if (reportError) {
        throw reportError;
      }

      if (!createdReport) {
        throw new Error(
          'Le rapport n’a pas pu être créé.',
        );
      }


      // ------------------------------------------------------
      // UPLOAD DES FICHIERS
      // ------------------------------------------------------

      for (const file of newReport.files) {
        const extension =
          file.name.includes('.')
            ? file.name
              .split('.')
              .pop()
              ?.toLowerCase() ?? 'file'
            : 'file';

        const uniqueName =
          `${crypto.randomUUID()}.${extension}`;

        const filePath =
          `${profile.structure_id}/${profile.id}/${createdReport.id}/${uniqueName}`;


        const { error: uploadError } =
          await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(
              filePath,
              file,
              {
                cacheControl: '3600',
                upsert: false,
                contentType:
                  file.type || 'application/octet-stream',
              },
            );

        if (uploadError) {
          throw uploadError;
        }

        uploadedPaths.push(filePath);


        // ----------------------------------------------------
        // ENREGISTREMENT DE LA PIÈCE JOINTE
        // ----------------------------------------------------

        const { error: attachmentError } =
          await supabase
            .from('report_attachments')
            .insert({
              report_id: createdReport.id,

              file_name: file.name,

              file_path: filePath,

              file_url: null,

              mime_type:
                file.type ||
                'application/octet-stream',

              file_size: file.size,
            });

        if (attachmentError) {
          throw attachmentError;
        }
      }


      // ------------------------------------------------------
      // SUCCÈS
      // ------------------------------------------------------

      resetNewReport();

      setIsNewReportOpen(false);

      await loadReports();

      alert('Rapport envoyé avec succès.');

    } catch (error: any) {
      console.error(
        'Erreur envoi rapport:',
        error,
      );


      // ------------------------------------------------------
      // NETTOYAGE STORAGE
      // ------------------------------------------------------

      if (uploadedPaths.length > 0) {
        const { error: removeError } =
          await supabase.storage
            .from(STORAGE_BUCKET)
            .remove(uploadedPaths);

        if (removeError) {
          console.error(
            'Erreur nettoyage fichiers:',
            removeError,
          );
        }
      }


      alert(
        error?.message ||
        'Une erreur est survenue lors de l’envoi du rapport.',
      );
    } finally {
      setSubmitting(false);
    }
  };


  // ==========================================================
  // GET SIGNED URL
  // ==========================================================

  const getSignedUrl = async (
    filePath: string,
  ) => {
    const { data, error } =
      await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(
          filePath,
          60 * 10,
        );

    if (error) {
      throw error;
    }

    if (!data?.signedUrl) {
      throw new Error(
        'Impossible de générer le lien sécurisé du fichier.',
      );
    }

    return data.signedUrl;
  };


  // ==========================================================
  // PREVIEW FILE
  // ==========================================================

  const handlePreview = async (
    attachment: ReportAttachment,
  ) => {
    try {
      setPreviewAttachment(attachment);

      if (isImageFile(attachment)) {
        setPreviewType('image');
      } else if (isPdfFile(attachment)) {
        setPreviewType('pdf');
      } else {
        setPreviewType('unsupported');
      }

      const url = await getSignedUrl(
        attachment.file_path,
      );

      setPreviewUrl(url);

      setIsPreviewOpen(true);

    } catch (error: any) {
      console.error(
        'Erreur prévisualisation:',
        error,
      );

      alert(
        error?.message ||
        'Impossible d’ouvrir le document.',
      );
    }
  };


  // ==========================================================
  // DOWNLOAD FILE
  // ==========================================================

  const handleDownload = async (
    attachment: ReportAttachment,
  ) => {
    try {
      setDownloading(attachment.id);

      const url = await getSignedUrl(
        attachment.file_path,
      );

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          'Impossible de télécharger le fichier.',
        );
      }

      const blob = await response.blob();

      const blobUrl =
        window.URL.createObjectURL(blob);

      const link =
        document.createElement('a');

      link.href = blobUrl;

      link.download = attachment.file_name;

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.URL.revokeObjectURL(blobUrl);

    } catch (error: any) {
      console.error(
        'Erreur téléchargement:',
        error,
      );

      alert(
        error?.message ||
        'Impossible de télécharger le document.',
      );
    } finally {
      setDownloading(null);
    }
  };


  // ==========================================================
  // OPEN FILE
  // ==========================================================

  const handleOpenFile = async (
    attachment: ReportAttachment,
  ) => {
    try {
      const url = await getSignedUrl(
        attachment.file_path,
      );

      window.open(
        url,
        '_blank',
        'noopener,noreferrer',
      );
    } catch (error: any) {
      console.error(
        'Erreur ouverture fichier:',
        error,
      );

      alert(
        error?.message ||
        'Impossible d’ouvrir le fichier.',
      );
    }
  };


  // ==========================================================
  // FORWARD REPORT
  // ==========================================================

  const handleForwardReport = async (
    report: Report,
  ) => {
    if (role !== 'manager') {
      return;
    }

    setForwardingReportId(report.id);

    try {
      // ------------------------------------------------------
      // RÉCUPÉRATION DYNAMIQUE DE L'ADMIN
      // ------------------------------------------------------

      const { data, error } =
        await supabase.rpc(
          'get_current_admin',
        );

      if (error) {
        throw error;
      }

      const admin =
        (data?.[0] ?? null) as StructureManager | null;

      if (!admin) {
        throw new Error(
          'Aucun administrateur actif n’a été trouvé.',
        );
      }


      // ------------------------------------------------------
      // TRANSMISSION
      // ------------------------------------------------------

      const { error: updateError } =
        await supabase
          .from('reports')
          .update({
            recipient_employee_id: admin.id,

            recipient_id: admin.id,

            status: 'forwarded',

            forwarded_by: profile?.id ?? null,

            forwarded_at:
              new Date().toISOString(),

            received_at: null,
          })
          .eq('id', report.id);


      if (updateError) {
        throw updateError;
      }


      await loadReports();

      alert(
        `Rapport transmis à ${admin.first_name} ${admin.last_name}.`,
      );

    } catch (error: any) {
      console.error(
        'Erreur transmission rapport:',
        error,
      );

      alert(
        error?.message ||
        'Impossible de transmettre le rapport.',
      );
    } finally {
      setForwardingReportId(null);
    }
  };


  // ==========================================================
  // OPEN DETAILS
  // ==========================================================

  const openDetails = (report: Report) => {
    setSelectedReport(report);
    setIsDetailsOpen(true);
  };


  // ==========================================================
  // RESET FILTERS
  // ==========================================================

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
  };


  // ==========================================================
  // RENDER ATTACHMENTS
  // ==========================================================

  const renderAttachments = (
    attachments: ReportAttachment[],
  ) => {
    if (!attachments || attachments.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Aucune pièce jointe.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {attachments.map((attachment) => {
          const Icon =
            getFileIcon(attachment);

          return (
            <div
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-lg bg-muted p-2">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {attachment.file_name}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(
                      attachment.file_size,
                    )}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                {(isImageFile(attachment) ||
                  isPdfFile(attachment)) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handlePreview(attachment)
                      }
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Voir
                    </Button>
                  )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    handleDownload(attachment)
                  }
                  disabled={
                    downloading === attachment.id
                  }
                >
                  {downloading ===
                    attachment.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}

                  Télécharger
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };


  // ==========================================================
  // REPORT CARD
  // ==========================================================

  const renderReportCard = (
    report: Report,
  ) => {
    const attachments =
      report.attachments ?? [];

    const employeeName =
      report.employees
        ? `${report.employees.first_name} ${report.employees.last_name}`
        : 'Employé inconnu';

    return (
      <Card
        key={report.id}
        className="transition-shadow hover:shadow-md"
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="truncate">
                {report.title}
              </CardTitle>

              <CardDescription className="mt-1">
                {report.report_types?.name ??
                  'Type inconnu'}
              </CardDescription>
            </div>

            <Badge
              className={getStatusClass(
                report.status,
              )}
            >
              {getStatusLabel(
                report.status,
              )}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {role !== 'employee' && (
            <div className="text-sm">
              <span className="font-medium">
                Auteur :
              </span>{' '}
              {employeeName}
            </div>
          )}

          {report.description && (
            <p className="line-clamp-3 text-sm text-muted-foreground">
              {report.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {format(
                new Date(
                  report.submitted_at,
                ),
                'dd MMM yyyy à HH:mm',
                {
                  locale: fr,
                },
              )}
            </span>

            <span className="flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" />

              {attachments.length}{' '}
              pièce
              {attachments.length > 1
                ? 's'
                : ''}{' '}
              jointe
              {attachments.length > 1
                ? 's'
                : ''}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openDetails(report)
              }
            >
              <Eye className="mr-2 h-4 w-4" />
              Consulter
            </Button>

            {role === 'manager' &&
              activeTab === 'received' &&
              report.status === 'submitted' && (
                <Button
                  size="sm"
                  onClick={() =>
                    handleForwardReport(
                      report,
                    )
                  }
                  disabled={
                    forwardingReportId ===
                    report.id
                  }
                >
                  {forwardingReportId ===
                    report.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Forward className="mr-2 h-4 w-4" />
                  )}

                  Transmettre à l'administration
                </Button>
              )}
          </div>
        </CardContent>
      </Card>
    );
  };


  // ==========================================================
  // FILTERS
  // ==========================================================

  const renderFilters = () => {
    return (
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-4">
            {/* RECHERCHE */}

            <div className="md:col-span-2">
              <Label className="mb-2 block">
                Rechercher
              </Label>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  className="pl-9"
                  placeholder="Titre, description, auteur..."
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                />
              </div>
            </div>


            {/* STATUT */}

            <div>
              <Label className="mb-2 block">
                Statut
              </Label>

              <Select
                value={statusFilter}
                onValueChange={
                  setStatusFilter
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Tous les statuts
                  </SelectItem>

                  {Object.entries(
                    STATUS_LABELS,
                  ).map(
                    ([value, label]) => (
                      <SelectItem
                        key={value}
                        value={value}
                      >
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>


            {/* TYPE */}

            <div>
              <Label className="mb-2 block">
                Type
              </Label>

              <Select
                value={typeFilter}
                onValueChange={
                  setTypeFilter
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les types" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Tous les types
                  </SelectItem>

                  {reportTypes.map(
                    (type) => (
                      <SelectItem
                        key={type.id}
                        value={type.id}
                      >
                        {type.name}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
            >
              <Filter className="mr-2 h-4 w-4" />
              Réinitialiser les filtres
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };


  // ==========================================================
  // NEW REPORT DIALOG
  // ==========================================================

  const renderNewReportDialog = () => {
    return (
      <Dialog
        open={isNewReportOpen}
        onOpenChange={
          setIsNewReportOpen
        }
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Nouveau rapport
            </DialogTitle>

            <DialogDescription>
              Votre rapport sera envoyé automatiquement au
              destinataire correspondant à votre rôle.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* DESTINATAIRE */}

            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm font-medium">
                Destinataire
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {role === 'employee'
                  ? structureManager
                    ? `${structureManager.first_name} ${structureManager.last_name} — Manager de votre structure`
                    : 'Recherche du manager de votre structure...'
                  : 'Administrateur du système'}
              </p>
            </div>


            {/* TYPE */}

            <div className="space-y-2">
              <Label htmlFor="report-type">
                Type de rapport
              </Label>

              <Select
                value={newReport.typeId}
                onValueChange={(value) =>
                  setNewReport(
                    (previous) => ({
                      ...previous,
                      typeId: value,
                    }),
                  )
                }
              >
                <SelectTrigger id="report-type">
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>

                <SelectContent>
                  {reportTypes.map(
                    (type) => (
                      <SelectItem
                        key={type.id}
                        value={type.id}
                      >
                        {type.name}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>


            {/* TITRE */}

            <div className="space-y-2">
              <Label htmlFor="report-title">
                Titre
              </Label>

              <Input
                id="report-title"
                value={newReport.title}
                onChange={(event) =>
                  setNewReport(
                    (previous) => ({
                      ...previous,
                      title:
                        event.target.value,
                    }),
                  )
                }
                placeholder="Titre du rapport"
              />
            </div>


            {/* DESCRIPTION */}

            <div className="space-y-2">
              <Label htmlFor="report-description">
                Description
              </Label>

              <Textarea
                id="report-description"
                value={
                  newReport.description
                }
                onChange={(event) =>
                  setNewReport(
                    (previous) => ({
                      ...previous,
                      description:
                        event.target.value,
                    }),
                  )
                }
                placeholder="Décrivez votre rapport..."
                rows={6}
              />
            </div>


            {/* FICHIERS */}

            <div className="space-y-3">
              <Label htmlFor="report-files">
                Pièces jointes
              </Label>

              <Input
                id="report-files"
                type="file"
                multiple
                onChange={
                  handleFileChange
                }
              />

              <p className="text-xs text-muted-foreground">
                Vous pouvez sélectionner plusieurs documents.
              </p>


              {/* FICHIERS SÉLECTIONNÉS */}

              {newReport.files.length >
                0 && (
                  <div className="space-y-2">
                    {newReport.files.map(
                      (file, index) => (
                        <div
                          key={`${file.name}-${index}`}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <File className="h-5 w-5 shrink-0" />

                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {file.name}
                              </p>

                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(
                                  file.size,
                                )}
                              </p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              removeSelectedFile(
                                index,
                              )
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ),
                    )}
                  </div>
                )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setIsNewReportOpen(false)
              }
              disabled={submitting}
            >
              Annuler
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Envoi...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Envoyer le rapport
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };


  // ==========================================================
  // DETAILS DIALOG
  // ==========================================================

  const renderDetailsDialog = () => {
    if (!selectedReport) {
      return null;
    }

    return (
      <Dialog
        open={isDetailsOpen}
        onOpenChange={
          setIsDetailsOpen
        }
      >
        <DialogContent className="max-h-[90vh] max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedReport.title}
            </DialogTitle>

            <DialogDescription>
              {selectedReport.report_types?.name ??
                'Type de rapport'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="space-y-6">
              {/* INFORMATIONS */}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Statut
                  </p>

                  <Badge
                    className={`mt-1 ${getStatusClass(
                      selectedReport.status,
                    )}`}
                  >
                    {getStatusLabel(
                      selectedReport.status,
                    )}
                  </Badge>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Date d'envoi
                  </p>

                  <p className="mt-1 text-sm">
                    {format(
                      new Date(
                        selectedReport.submitted_at,
                      ),
                      'dd MMMM yyyy à HH:mm',
                      {
                        locale: fr,
                      },
                    )}
                  </p>
                </div>
              </div>


              {/* DESCRIPTION */}

              <div>
                <h3 className="mb-2 font-semibold">
                  Description
                </h3>

                <div className="rounded-lg bg-muted/40 p-4">
                  <p className="whitespace-pre-wrap text-sm">
                    {selectedReport.description ||
                      'Aucune description.'}
                  </p>
                </div>
              </div>


              {/* PIECES JOINTES */}

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">
                    Pièces jointes
                  </h3>

                  <Badge variant="outline">
                    {
                      (
                        selectedReport.attachments ??
                        []
                      ).length
                    }
                  </Badge>
                </div>

                {renderAttachments(
                  selectedReport.attachments ??
                  [],
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  };


  // ==========================================================
  // PREVIEW DIALOG
  // ==========================================================

  const renderPreviewDialog = () => {
    return (
      <Dialog
        open={isPreviewOpen}
        onOpenChange={(open) => {
          setIsPreviewOpen(open);

          if (!open) {
            setPreviewUrl(null);
            setPreviewAttachment(null);
          }
        }}
      >
        <DialogContent className="h-[90vh] max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              {previewAttachment?.file_name ??
                'Document'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/30">
            {previewType === 'image' &&
              previewUrl && (
                <img
                  src={previewUrl}
                  alt={
                    previewAttachment?.file_name ??
                    'Document'
                  }
                  className="max-h-[70vh] max-w-full object-contain"
                />
              )}

            {previewType === 'pdf' &&
              previewUrl && (
                <iframe
                  src={previewUrl}
                  title={
                    previewAttachment?.file_name ??
                    'Document PDF'
                  }
                  className="h-[75vh] w-full rounded-lg border"
                />
              )}

            {previewType ===
              'unsupported' && (
                <div className="flex flex-col items-center gap-4 p-10 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground" />

                  <div>
                    <p className="font-medium">
                      Prévisualisation non disponible
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Ce format doit être téléchargé pour être consulté.
                    </p>
                  </div>

                  {previewAttachment && (
                    <Button
                      onClick={() =>
                        handleDownload(
                          previewAttachment,
                        )
                      }
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Télécharger
                    </Button>
                  )}
                </div>
              )}
          </div>
        </DialogContent>
      </Dialog>
    );
  };


  // ==========================================================
  // EMPTY STATE
  // ==========================================================

  const renderEmptyState = () => {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="mb-4 h-12 w-12 text-muted-foreground" />

          <h3 className="font-semibold">
            Aucun rapport trouvé
          </h3>

          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Aucun rapport ne correspond aux filtres sélectionnés.
          </p>

          {(search ||
            statusFilter !== 'all' ||
            typeFilter !== 'all') && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={resetFilters}
              >
                Réinitialiser les filtres
              </Button>
            )}
        </CardContent>
      </Card>
    );
  };


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin" />

            <p className="text-sm text-muted-foreground">
              Chargement des rapports...
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }


  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Rapports
            </h1>

            <p className="text-muted-foreground">
              Gérez et consultez vos rapports professionnels.
            </p>
          </div>

          {role !== 'admin' && (
            <Button
              onClick={() =>
                setIsNewReportOpen(true)
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Nouveau rapport
            </Button>
          )}
        </div>


        {/* ================================================== */}
        {/* MANAGER TABS */}
        {/* ================================================== */}

        {role === 'manager' ? (
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(
                value as ReportTab,
              )
            }
          >
            <TabsList>
              <TabsTrigger value="received">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Rapports reçus
              </TabsTrigger>

              <TabsTrigger value="mine">
                <FileText className="mr-2 h-4 w-4" />
                Mes rapports
              </TabsTrigger>
            </TabsList>

            <TabsContent value="received">
              {renderFilters()}

              {filteredReports.length >
                0 ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredReports.map(
                    renderReportCard,
                  )}
                </div>
              ) : (
                renderEmptyState()
              )}
            </TabsContent>

            <TabsContent value="mine">
              {renderFilters()}

              {filteredReports.length >
                0 ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredReports.map(
                    renderReportCard,
                  )}
                </div>
              ) : (
                renderEmptyState()
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {/* ================================================== */}
            {/* EMPLOYEE / ADMIN */}
            {/* ================================================== */}

            {renderFilters()}

            {filteredReports.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {filteredReports.map(
                  renderReportCard,
                )}
              </div>
            ) : (
              renderEmptyState()
            )}
          </>
        )}


        {/* ================================================== */}
        {/* DIALOGS */}
        {/* ================================================== */}

        {renderNewReportDialog()}

        {renderDetailsDialog()}

        {renderPreviewDialog()}
      </div>
    </DashboardLayout>
  );
}