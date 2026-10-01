import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/DashboardLayout'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'

import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  Filter,
  Loader2,
  Plus,
  Search,
  Send,
  Upload,
  X,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
} from '@/components/ui/card'

const REPORT_BUCKET = 'reports'

type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'received'
  | 'forwarded'
  | 'reviewed'
  | 'archived'
  | 'rejected'

interface ReportType {
  id: string
  name: string
}

interface Attachment {
  id: string
  report_id: string
  file_name: string
  file_path: string
  file_url: string | null
  mime_type: string | null
  file_size: number | null
  created_at: string
}

interface Report {
  id: string
  employee_id: string
  author_employee_id: string | null
  report_type_id: string
  title: string
  description: string | null
  file_url: string | null
  submitted_at: string
  validated_at: string | null
  created_at: string
  recipient_id: string | null
  recipient_employee_id: string | null
  forwarded_by: string | null
  forwarded_at: string | null
  structure_id: string | null
  site_id: string | null
  status: ReportStatus
  received_at: string | null
  report_types: ReportType | null
  attachments: Attachment[]
}

interface NewReportState {
  title: string
  description: string
  typeId: string
  files: File[]
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Brouillon',
  submitted: 'Soumis',
  received: 'Reçu',
  forwarded: 'Transmis',
  reviewed: 'Examiné',
  archived: 'Archivé',
  rejected: 'Rejeté',
}

const STATUS_CLASSES: Record<ReportStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  received: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  forwarded: 'bg-violet-50 text-violet-700 border-violet-200',
  reviewed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-gray-100 text-gray-700 border-gray-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatFileSize(size: number | null | undefined): string {
  if (size == null || size === 0) {
    return '—'
  }

  if (size < 1024) {
    return `${size} o`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} Ko`
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} Mo`
  }

  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} Go`
}

function isImage(
  file: Pick<Attachment, 'mime_type' | 'file_name'>,
): boolean {
  const mime = file.mime_type?.toLowerCase() ?? ''
  const name = file.file_name?.toLowerCase() ?? ''

  return (
    mime.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i.test(name)
  )
}

function isPdf(
  file: Pick<Attachment, 'mime_type' | 'file_name'>,
): boolean {
  const mime = file.mime_type?.toLowerCase() ?? ''
  const name = file.file_name?.toLowerCase() ?? ''

  return (
    mime === 'application/pdf' ||
    /\.pdf$/i.test(name)
  )
}

function getFileIcon(file: Attachment | File) {
  const mime =
    'mime_type' in file
      ? file.mime_type?.toLowerCase() ?? ''
      : file.type?.toLowerCase() ?? ''

  const name =
    'file_name' in file
      ? file.file_name?.toLowerCase() ?? ''
      : file.name?.toLowerCase() ?? ''

  if (
    mime.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i.test(name)
  ) {
    return FileImage
  }

  if (
    mime === 'application/pdf' ||
    /\.pdf$/i.test(name)
  ) {
    return FileText
  }

  return File
}
export default function EmployerReports() {
  const { toast } = useToast()
  const { profile } = useAuth()

  const [reports, setReports] = useState<Report[]>([])
  const [reportTypes, setReportTypes] = useState<ReportType[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)

  const [selectedReport, setSelectedReport] =
    useState<Report | null>(null)

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null)

  const [previewAttachment, setPreviewAttachment] =
    useState<Attachment | null>(null)

  const [newReport, setNewReport] =
    useState<NewReportState>({
      title: '',
      description: '',
      typeId: '',
      files: [],
    })

  /**
   * ============================================================
   * CHARGEMENT DES TYPES DE RAPPORT
   * ============================================================
   */
  const loadReportTypes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('report_types')
        .select('id, name')
        .order('name', {
          ascending: true,
        })

      if (error) {
        throw error
      }

      setReportTypes(
        (data ?? []) as ReportType[],
      )
    } catch (error) {
      console.error(
        'Erreur chargement types de rapports:',
        error,
      )

      toast({
        title: 'Erreur',
        description:
          'Impossible de charger les types de rapports.',
        variant: 'destructive',
      })
    }
  }, [toast])

  /**
   * ============================================================
   * CHARGEMENT DES RAPPORTS DE L'EMPLOYÉ CONNECTÉ
   *
   * IMPORTANT :
   * On utilise employee_id ET author_employee_id.
   *
   * Cela permet de récupérer :
   * - les rapports créés par l'employé ;
   * - les rapports dont il est l'auteur ;
   *
   * sans dépendre de recipient_id.
   * ============================================================
   */
  const loadReports = useCallback(async () => {
    if (!profile?.id) {
      setReports([])
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const {
        data,
        error,
      } = await supabase
        .from('reports')
        .select(`
          id,
          employee_id,
          author_employee_id,
          report_type_id,
          title,
          description,
          file_url,
          submitted_at,
          validated_at,
          created_at,
          recipient_id,
          recipient_employee_id,
          forwarded_by,
          forwarded_at,
          structure_id,
          site_id,
          status,
          received_at,
          report_types (
            id,
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
        .or(
          `employee_id.eq.${profile.id},author_employee_id.eq.${profile.id}`,
        )
        .order(
          'submitted_at',
          {
            ascending: false,
            nullsFirst: false,
          },
        )

      if (error) {
        throw error
      }

      const normalizedReports: Report[] =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).map((item: any) => ({
          ...item,
          report_types:
            Array.isArray(item.report_types)
              ? item.report_types[0] ?? null
              : item.report_types ?? null,
          attachments:
            Array.isArray(item.attachments)
              ? item.attachments
              : [],
        }))

      setReports(normalizedReports)
    } catch (error) {
      console.error(
        'Erreur chargement rapports:',
        error,
      )

      setReports([])

      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible de charger vos rapports.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [profile?.id, toast])

  /**
   * ============================================================
   * INITIALISATION
   * ============================================================
   */
  useEffect(() => {
    void loadReportTypes()
    void loadReports()
  }, [loadReportTypes, loadReports])

  /**
   * ============================================================
   * FILTRAGE
   * ============================================================
   */
  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase()

    return reports.filter((report) => {
      const matchesStatus =
        statusFilter === 'all' ||
        report.status === statusFilter

      const matchesType =
        typeFilter === 'all' ||
        report.report_type_id === typeFilter

      const matchesSearch =
        !query ||
        report.title.toLowerCase().includes(query) ||
        report.description
          ?.toLowerCase()
          .includes(query) ||
        report.report_types?.name
          ?.toLowerCase()
          .includes(query)

      return (
        matchesStatus &&
        matchesType &&
        matchesSearch
      )
    })
  }, [
    reports,
    search,
    statusFilter,
    typeFilter,
  ])

  /**
   * ============================================================
   * STATISTIQUES
   * ============================================================
   */
  const stats = useMemo(() => {
    return {
      total: reports.length,

      submitted: reports.filter(
        (report) =>
          report.status === 'submitted',
      ).length,

      received: reports.filter(
        (report) =>
          report.status === 'received',
      ).length,

      reviewed: reports.filter(
        (report) =>
          report.status === 'reviewed',
      ).length,

      rejected: reports.filter(
        (report) =>
          report.status === 'rejected',
      ).length,
    }
  }, [reports])

  /**
   * ============================================================
   * FICHIERS
   * ============================================================
   */
  const handleFiles = (
    fileList: FileList | null,
  ) => {
    if (!fileList) {
      return
    }

    const selectedFiles = Array.from(fileList)

    if (selectedFiles.length === 0) {
      return
    }

    setNewReport((current) => ({
      ...current,
      files: [
        ...current.files,
        ...selectedFiles,
      ],
    }))
  }

  const removeFile = (index: number) => {
    setNewReport((current) => ({
      ...current,
      files: current.files.filter(
        (_, currentIndex) =>
          currentIndex !== index,
      ),
    }))
  }

  const resetNewReport = () => {
    setNewReport({
      title: '',
      description: '',
      typeId: '',
      files: [],
    })
  }

  /**
   * ============================================================
   * CRÉATION DU RAPPORT
   *
   * La logique de destinataire reste dans la RPC
   * submit_report.
   *
   * Le frontend ne remplit PAS recipient_id directement.
   * ============================================================
   */
  const handleSubmit = async () => {
    if (!profile?.id) {
      toast({
        title: 'Erreur',
        description:
          'Utilisateur non authentifié.',
        variant: 'destructive',
      })

      return
    }

    if (!profile.structure_id) {
      toast({
        title: 'Information',
        description:
          'Votre compte n’est associé à aucune structure.',
      })

      return
    }

    if (!newReport.typeId) {
      toast({
        title: 'Information',
        description:
          'Veuillez sélectionner un type de rapport.',
      })

      return
    }

    const title = newReport.title.trim()

    if (!title) {
      toast({
        title: 'Information',
        description:
          'Veuillez renseigner le titre du rapport.',
      })

      return
    }

    setSubmitting(true)

    const uploadedPaths: string[] = []
    let createdReportId: string | null = null

    try {
      /**
       * Création du rapport.
       *
       * La RPC doit être responsable de déterminer
       * le destinataire selon les règles métier.
       */
      const {
        data: reportId,
        error: reportError,
      } = await supabase.rpc(
        'submit_report',
        {
          p_report_type_id:
            newReport.typeId,

          p_title: title,

          p_description:
            newReport.description.trim() ||
            null,
        },
      )

      if (reportError) {
        throw reportError
      }

      if (!reportId) {
        throw new Error(
          'Le rapport n’a pas pu être créé.',
        )
      }

      createdReportId =
        reportId as string

      /**
       * Upload des pièces jointes.
       */
      for (const file of newReport.files) {
        const extension =
          file.name.includes('.')
            ? file.name
              .split('.')
              .pop()
              ?.toLowerCase() || 'bin'
            : 'bin'

        const path = [
          profile.structure_id,
          profile.id,
          createdReportId,
          `${crypto.randomUUID()}.${extension}`,
        ].join('/')

        const {
          error: uploadError,
        } = await supabase.storage
          .from(REPORT_BUCKET)
          .upload(
            path,
            file,
            {
              contentType:
                file.type ||
                'application/octet-stream',

              upsert: false,
            },
          )

        if (uploadError) {
          throw uploadError
        }

        uploadedPaths.push(path)

        const {
          error: attachmentError,
        } = await supabase
          .from('report_attachments')
          .insert({
            report_id:
              createdReportId,

            file_name:
              file.name,

            file_path:
              path,

            file_url:
              null,

            mime_type:
              file.type || null,

            file_size:
              file.size,
          })

        if (attachmentError) {
          throw attachmentError
        }
      }

      resetNewReport()
      setNewDialogOpen(false)

      await loadReports()

      toast({
        title: 'Rapport transmis',
        description:
          'Votre rapport a été transmis avec succès.',
      })
    } catch (error) {
      console.error(
        'Erreur création rapport:',
        error,
      )

      /**
       * Nettoyage des fichiers déjà uploadés
       * en cas d'erreur.
       */
      if (uploadedPaths.length > 0) {
        const {
          error: cleanupError,
        } = await supabase.storage
          .from(REPORT_BUCKET)
          .remove(uploadedPaths)

        if (cleanupError) {
          console.error(
            'Erreur nettoyage fichiers:',
            cleanupError,
          )
        }
      }

      toast({
        title: 'Erreur',
        description:
          error instanceof Error
            ? error.message
            : 'Impossible de transmettre le rapport.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * ============================================================
   * SIGNED URL
   * ============================================================
   */
  const getSignedUrl = async (
    path: string,
  ): Promise<string> => {
    if (!path) {
      throw new Error(
        'Chemin du fichier invalide.',
      )
    }

    const {
      data,
      error,
    } = await supabase.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(
        path,
        600,
      )

    if (error) {
      throw error
    }

    if (!data?.signedUrl) {
      throw new Error(
        'URL sécurisée introuvable.',
      )
    }

    return data.signedUrl
  }

  /**
   * ============================================================
   * APERÇU
   * ============================================================
   */
  const previewFile = async (
    attachment: Attachment,
  ) => {
    try {
      if (
        !isImage(attachment) &&
        !isPdf(attachment)
      ) {
        toast({
          title: 'Aperçu indisponible',
          description:
            'Ce type de fichier ne peut pas être prévisualisé.',
        })

        return
      }

      const url =
        await getSignedUrl(
          attachment.file_path,
        )

      setPreviewAttachment(
        attachment,
      )

      setPreviewUrl(url)
      setPreviewDialogOpen(true)
    } catch (error) {
      console.error(
        'Erreur aperçu fichier:',
        error,
      )

      toast({
        title: 'Erreur',
        description:
          'Impossible d’ouvrir cette pièce jointe.',
        variant: 'destructive',
      })
    }
  }

  /**
   * ============================================================
   * TÉLÉCHARGEMENT
   * ============================================================
   */
  const downloadFile = async (
    attachment: Attachment,
  ) => {
    try {
      setDownloading(
        attachment.id,
      )

      const url =
        await getSignedUrl(
          attachment.file_path,
        )

      const response =
        await fetch(url)

      if (!response.ok) {
        throw new Error(
          'Téléchargement impossible.',
        )
      }

      const blob =
        await response.blob()

      const objectUrl =
        URL.createObjectURL(blob)

      const anchor =
        document.createElement('a')

      anchor.href = objectUrl
      anchor.download =
        attachment.file_name

      document.body.appendChild(
        anchor,
      )

      anchor.click()
      anchor.remove()

      window.setTimeout(() => {
        URL.revokeObjectURL(
          objectUrl,
        )
      }, 1000)
    } catch (error) {
      console.error(
        'Erreur téléchargement:',
        error,
      )

      toast({
        title: 'Erreur',
        description:
          'Impossible de télécharger le fichier.',
        variant: 'destructive',
      })
    } finally {
      setDownloading(null)
    }
  }

  /**
   * ============================================================
   * FERMETURE APERÇU
   * ============================================================
   */
  const handlePreviewDialogChange = (
    open: boolean,
  ) => {
    setPreviewDialogOpen(open)

    if (!open) {
      setPreviewUrl(null)
      setPreviewAttachment(null)
    }
  }

  /**
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        {/* HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              Mes rapports
            </div>

            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Mes rapports professionnels
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              Créez, transmettez et suivez l’état de vos rapports.
            </p>
          </div>

          <Button
            onClick={() =>
              setNewDialogOpen(true)
            }
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Nouveau rapport
          </Button>
        </div>

        {/* STATS */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {stats.total}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-100 p-3">
                  <FileText className="h-5 w-5 text-slate-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    En attente
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {stats.submitted}
                  </p>
                </div>

                <div className="rounded-xl bg-blue-50 p-3">
                  <Clock3 className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Reçus
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {stats.received}
                  </p>
                </div>

                <div className="rounded-xl bg-indigo-50 p-3">
                  <Send className="h-5 w-5 text-indigo-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Examinés
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    {stats.reviewed}
                  </p>
                </div>

                <div className="rounded-xl bg-emerald-50 p-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* FILTERS */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                  placeholder="Rechercher un rapport..."
                  className="pl-9"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Select
                  value={statusFilter}
                  onValueChange={
                    setStatusFilter
                  }
                >
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <Filter className="mr-2 h-4 w-4" />

                    <SelectValue placeholder="Statut" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all">
                      Tous les statuts
                    </SelectItem>

                    {Object.entries(
                      STATUS_LABELS,
                    ).map(
                      ([
                        value,
                        label,
                      ]) => (
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

                <Select
                  value={typeFilter}
                  onValueChange={
                    setTypeFilter
                  }
                >
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Type" />
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
          </CardContent>
        </Card>

        {/* REPORTS */}
        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : filteredReports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>

              <h3 className="mt-4 font-semibold">
                Aucun rapport trouvé
              </h3>

              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Vous n’avez encore transmis aucun rapport correspondant
                aux filtres sélectionnés.
              </p>

              <Button
                className="mt-5 gap-2"
                onClick={() =>
                  setNewDialogOpen(true)
                }
              >
                <Plus className="h-4 w-4" />
                Créer un rapport
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredReports.map(
              (report) => (
                <Card
                  key={report.id}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold">
                            {report.title}
                          </h3>

                          <Badge
                            variant="outline"
                            className={
                              STATUS_CLASSES[
                              report.status
                              ]
                            }
                          >
                            {
                              STATUS_LABELS[
                              report.status
                              ]
                            }
                          </Badge>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            {report.report_types?.name ||
                              'Type non défini'}
                          </span>

                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />

                            {formatDate(
                              report.submitted_at,
                            )}
                          </span>

                          {report.attachments.length >
                            0 && (
                              <span className="flex items-center gap-1">
                                <File className="h-3.5 w-3.5" />

                                {
                                  report
                                    .attachments
                                    .length
                                }{' '}
                                pièce(s)
                              </span>
                            )}
                        </div>

                        {report.description && (
                          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                            {
                              report.description
                            }
                          </p>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          setSelectedReport(
                            report,
                          )

                          setDetailsDialogOpen(
                            true,
                          )
                        }}
                      >
                        Consulter

                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ),
            )}
          </div>
        )}
      </div>

      {/* ========================================================
          CREATE DIALOG
          ======================================================== */}
      <Dialog
        open={newDialogOpen}
        onOpenChange={(open) => {
          if (!submitting) {
            setNewDialogOpen(open)

            if (!open) {
              resetNewReport()
            }
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Nouveau rapport
            </DialogTitle>

            <DialogDescription>
              Votre rapport sera transmis automatiquement au responsable
              de votre structure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* TYPE */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Type de rapport
              </label>

              <Select
                value={newReport.typeId}
                onValueChange={(value) =>
                  setNewReport(
                    (current) => ({
                      ...current,
                      typeId: value,
                    }),
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

            {/* TITLE */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Titre
              </label>

              <Input
                value={newReport.title}
                onChange={(event) =>
                  setNewReport(
                    (current) => ({
                      ...current,
                      title:
                        event.target
                          .value,
                    }),
                  )
                }
                placeholder="Ex. Rapport d'activité du 24 septembre"
              />
            </div>

            {/* DESCRIPTION */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Description
              </label>

              <Textarea
                value={
                  newReport.description
                }
                onChange={(event) =>
                  setNewReport(
                    (current) => ({
                      ...current,
                      description:
                        event.target
                          .value,
                    }),
                  )
                }
                placeholder="Décrivez le contenu de votre rapport..."
                className="min-h-[150px]"
              />
            </div>

            {/* ATTACHMENTS */}
            <div className="rounded-xl border border-dashed p-5">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="rounded-full bg-muted p-3">
                  <Upload className="h-5 w-5" />
                </div>

                <p className="mt-3 text-sm font-medium">
                  Ajouter des pièces jointes
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, images, documents...
                </p>

                <label className="mt-4 cursor-pointer">
                  <Button
                    type="button"
                    variant="outline"
                    asChild
                  >
                    <span>
                      Choisir des fichiers
                    </span>
                  </Button>

                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleFiles(
                        event.target
                          .files,
                      )

                      event.target.value =
                        ''
                    }}
                  />
                </label>
              </div>

              {newReport.files.length >
                0 && (
                  <div className="mt-5 space-y-2">
                    {newReport.files.map(
                      (
                        file,
                        index,
                      ) => {
                        const Icon =
                          getFileIcon(
                            file,
                          )

                        return (
                          <div
                            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                            className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"
                          >
                            <Icon className="h-5 w-5 shrink-0" />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {file.name}
                              </p>

                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(
                                  file.size,
                                )}
                              </p>
                            </div>

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                removeFile(
                                  index,
                                )
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )
                      },
                    )}
                  </div>
                )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setNewDialogOpen(false)
              }
              disabled={submitting}
            >
              Annuler
            </Button>

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="gap-2"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}

              Transmettre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================
          DETAILS
          ======================================================== */}
      <Dialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selectedReport && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>
                    {
                      selectedReport.title
                    }
                  </DialogTitle>

                  <Badge
                    variant="outline"
                    className={
                      STATUS_CLASSES[
                      selectedReport
                        .status
                      ]
                    }
                  >
                    {
                      STATUS_LABELS[
                      selectedReport
                        .status
                      ]
                    }
                  </Badge>
                </div>

                <DialogDescription>
                  {selectedReport.report_types
                    ?.name ||
                    'Type non défini'}{' '}
                  ·{' '}
                  {formatDate(
                    selectedReport.submitted_at,
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <div className="rounded-xl bg-muted/40 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {selectedReport.description ||
                      'Aucune description.'}
                  </p>
                </div>

                {selectedReport.attachments
                  .length > 0 && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">
                        Pièces jointes
                      </h3>

                      <div className="space-y-2">
                        {selectedReport.attachments.map(
                          (
                            attachment,
                          ) => {
                            const Icon =
                              getFileIcon(
                                attachment,
                              )

                            return (
                              <div
                                key={
                                  attachment.id
                                }
                                className="flex items-center gap-3 rounded-xl border p-3"
                              >
                                <Icon className="h-5 w-5 shrink-0" />

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">
                                    {
                                      attachment.file_name
                                    }
                                  </p>

                                  <p className="text-xs text-muted-foreground">
                                    {formatFileSize(
                                      attachment.file_size,
                                    )}
                                  </p>
                                </div>

                                <div className="flex gap-1">
                                  {(
                                    isImage(
                                      attachment,
                                    ) ||
                                    isPdf(
                                      attachment,
                                    )
                                  ) && (
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        onClick={() =>
                                          previewFile(
                                            attachment,
                                          )
                                        }
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    )}

                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() =>
                                      downloadFile(
                                        attachment,
                                      )
                                    }
                                    disabled={
                                      downloading ===
                                      attachment.id
                                    }
                                  >
                                    {downloading ===
                                      attachment.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            )
                          },
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ========================================================
          PREVIEW
          ======================================================== */}
      <Dialog
        open={previewDialogOpen}
        onOpenChange={
          handlePreviewDialogChange
        }
      >
        <DialogContent className="max-h-[95vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {
                previewAttachment?.file_name
              }
            </DialogTitle>
          </DialogHeader>

          <div className="flex max-h-[75vh] min-h-[300px] items-center justify-center overflow-auto rounded-xl bg-muted/30">
            {previewUrl &&
              previewAttachment &&
              isImage(
                previewAttachment,
              ) ? (
              <img
                src={previewUrl}
                alt={
                  previewAttachment.file_name
                }
                className="max-h-[70vh] max-w-full object-contain"
              />
            ) : previewUrl &&
              previewAttachment &&
              isPdf(
                previewAttachment,
              ) ? (
              <iframe
                src={previewUrl}
                title={
                  previewAttachment.file_name
                }
                className="h-[70vh] w-full rounded-lg"
              />
            ) : (
              <div className="p-10 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />

                <p className="mt-3 text-sm text-muted-foreground">
                  Aperçu indisponible pour ce fichier.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}