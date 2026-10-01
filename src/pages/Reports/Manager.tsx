import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/DashboardLayout'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Upload,
  User,
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

/* =========================================================
   TYPES
========================================================= */

type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'received'
  | 'forwarded'
  | 'reviewed'
  | 'archived'
  | 'rejected'

type ViewMode = 'mine' | 'received'

interface Employee {
  id: string
  auth_user_id?: string | null
  first_name: string
  last_name: string
  structure_id?: string | null
  site_id?: string | null
  is_active?: boolean
}

interface Site {
  id: string
  name: string
  structure_id?: string | null
  is_active?: boolean
}

interface ReportType {
  id: string
  name: string
}

interface Attachment {
  id: string
  report_id: string
  file_name: string
  file_path: string
  file_url?: string | null
  mime_type?: string | null
  file_size?: number | null
  created_at?: string
}

interface Report {
  id: string
  employee_id: string
  author_employee_id?: string | null
  recipient_employee_id?: string | null
  recipient_id?: string | null

  report_type_id: string
  title: string
  description?: string | null

  file_url?: string | null

  submitted_at?: string | null
  validated_at?: string | null
  created_at?: string | null
  received_at?: string | null

  forwarded_by?: string | null
  forwarded_at?: string | null

  structure_id?: string | null
  site_id?: string | null

  status: ReportStatus

  report_types?: ReportType | null
  report_attachments?: Attachment[]

  employee?: Employee | null
  author?: Employee | null
  site?: Site | null
}

interface ReportTypeGroup {
  type: ReportType | null
  reports: Report[]
}

interface SiteReportGroup {
  site: Site | null
  reportsByType: ReportTypeGroup[]
}

/* =========================================================
   HELPERS
========================================================= */

const statusLabels: Record<ReportStatus, string> = {
  draft: 'Brouillon',
  submitted: 'Envoyé',
  received: 'Reçu',
  forwarded: 'Transmis',
  reviewed: 'Consulté',
  archived: 'Archivé',
  rejected: 'Rejeté',
}

const statusClasses: Record<ReportStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  received: 'bg-purple-100 text-purple-700',
  forwarded: 'bg-amber-100 text-amber-700',
  reviewed: 'bg-green-100 text-green-700',
  archived: 'bg-slate-100 text-slate-700',
  rejected: 'bg-red-100 text-red-700',
}

function getEmployeeName(employee?: Employee | null) {
  if (!employee) {
    return 'Employé inconnu'
  }

  return `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim()
}

function formatDate(date?: string | null) {
  if (!date) {
    return '—'
  }

  const parsed = new Date(date)

  if (Number.isNaN(parsed.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function formatFileSize(size?: number | null) {
  if (!size) {
    return ''
  }

  if (size < 1024) {
    return `${size} o`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} Ko`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} Mo`
}

function isImage(file?: Attachment | null) {
  if (!file) {
    return false
  }

  return (
    file.mime_type?.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.file_name)
  )
}

function isPdf(file?: Attachment | null) {
  if (!file) {
    return false
  }

  return (
    file.mime_type === 'application/pdf' ||
    /\.pdf$/i.test(file.file_name)
  )
}

/* =========================================================
   COMPONENT
========================================================= */

export default function ManagerReportsPage() {
  const { profile } = useAuth()

  /* -------------------------------------------------------
     DATA
  ------------------------------------------------------- */

  const [reports, setReports] = useState<Report[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [reportTypes, setReportTypes] = useState<ReportType[]>([])
  // employee_id → primary site_id (from employee_sites V3)
  const [employeeSiteMap, setEmployeeSiteMap] = useState<Map<string, string>>(new Map())

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  /* -------------------------------------------------------
     VIEW
  ------------------------------------------------------- */

  const [viewMode, setViewMode] = useState<ViewMode>('received')

  /* -------------------------------------------------------
     FILTERS
  ------------------------------------------------------- */

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [siteFilter, setSiteFilter] = useState<string>('all')

  /* -------------------------------------------------------
     GROUP EXPANSION
  ------------------------------------------------------- */

  const [expandedSites, setExpandedSites] = useState<Set<string>>(
    new Set(),
  )

  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(
    new Set(),
  )

  /* -------------------------------------------------------
     DETAILS
  ------------------------------------------------------- */

  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  /* -------------------------------------------------------
     PREVIEW
  ------------------------------------------------------- */

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<Attachment | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  /* -------------------------------------------------------
     CREATE REPORT
  ------------------------------------------------------- */

  const [createOpen, setCreateOpen] = useState(false)
  const [newReportTypeId, setNewReportTypeId] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [creating, setCreating] = useState(false)

  /* -------------------------------------------------------
     FEEDBACK
  ------------------------------------------------------- */

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const showFeedback = useCallback(
    (type: 'success' | 'error', message: string) => {
      setFeedback({
        type,
        message,
      })

      window.setTimeout(() => {
        setFeedback(null)
      }, 4500)
    },
    [],
  )

  /* =======================================================
     GROUP TOGGLE
  ======================================================= */

  const toggleSite = (siteId: string) => {
    setExpandedSites((current) => {
      const next = new Set(current)
      if (next.has(siteId)) {
        next.delete(siteId)
      } else {
        next.add(siteId)
      }
      return next
    })
  }

  const toggleType = (typeKey: string) => {
    setExpandedTypes((current) => {
      const next = new Set(current)
      if (next.has(typeKey)) {
        next.delete(typeKey)
      } else {
        next.add(typeKey)
      }
      return next
    })
  }

  const expandAllSites = (groups: SiteReportGroup[]) => {
    setExpandedSites(
      new Set(groups.map((g) => g.site?.id ?? 'without-site')),
    )
    const typeKeys = new Set<string>()
    groups.forEach((g) => {
      const siteId = g.site?.id ?? 'without-site'
      g.reportsByType.forEach((tg) => {
        typeKeys.add(`${siteId}-${tg.type?.id ?? 'without-type'}`)
      })
    })
    setExpandedTypes(typeKeys)
  }

  const collapseAllSites = () => {
    setExpandedSites(new Set())
    setExpandedTypes(new Set())
  }

  /* =======================================================
     LOAD DATA
  ======================================================= */

  const loadData = useCallback(
    async (showLoader = true) => {
      if (!profile?.id || !profile.structure_id) {
        return
      }

      if (showLoader) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      try {
        /* ---------------------------------------------------
           EMPLOYEES
        --------------------------------------------------- */

        const {
          data: employeeData,
          error: employeeError,
        } = await supabase
          .from('employees')
          .select('id, auth_user_id, first_name, last_name, structure_id, is_active')
          .eq('structure_id', profile.structure_id)
          .order('last_name', { ascending: true })

        if (employeeError) throw employeeError

        /* ---------------------------------------------------
           EMPLOYEE_SITES (V3)
           Permet de déterminer le site principal de chaque
           employé. On prend le premier site actif où
           l'employé est responsable, ou à défaut actif.
        --------------------------------------------------- */

        const employeeIds = (employeeData ?? []).map((e) => e.id)

        const empSiteMap = new Map<string, string>()

        if (employeeIds.length > 0) {
          const {
            data: empSiteData,
            error: empSiteError,
          } = await supabase
            .from('employee_sites')
            .select('employee_id, site_id, is_responsible, is_active')
            .in('employee_id', employeeIds)
            .eq('is_active', true)

          if (empSiteError) {
            console.warn('employee_sites non chargé:', empSiteError.message)
          } else {
            /*
             * Priorité : site où l'employé est responsable,
             * sinon premier site actif.
             */
            const rows = empSiteData ?? []
            // First pass : responsable
            rows.filter((r) => r.is_responsible).forEach((r) => {
              if (!empSiteMap.has(r.employee_id)) {
                empSiteMap.set(r.employee_id, r.site_id)
              }
            })
            // Second pass : actif simple
            rows.filter((r) => !r.is_responsible).forEach((r) => {
              if (!empSiteMap.has(r.employee_id)) {
                empSiteMap.set(r.employee_id, r.site_id)
              }
            })
          }
        }

        setEmployeeSiteMap(empSiteMap)

        /* ---------------------------------------------------
           SITES

           IMPORTANT :
           On charge TOUS les sites actifs de la structure.
           Les sites sont la source de l'arborescence.
        --------------------------------------------------- */

        const {
          data: siteData,
          error: siteError,
        } = await supabase
          .from('sites')
          .select(`
            id,
            name,
            structure_id,
            is_active
          `)
          .eq('structure_id', profile.structure_id)
          .eq('is_active', true)
          .order('name', {
            ascending: true,
          })

        if (siteError) {
          throw siteError
        }

        /* ---------------------------------------------------
           REPORT TYPES
        --------------------------------------------------- */

        const {
          data: typeData,
          error: typeError,
        } = await supabase
          .from('report_types')
          .select(`
            id,
            name
          `)
          .order('name', {
            ascending: true,
          })

        if (typeError) {
          throw typeError
        }

        /* ---------------------------------------------------
           REPORTS REÇUS
           Rapports dont le destinataire est le manager courant.
           Un rapport appartient à un et un seul employé
           de la structure.
        --------------------------------------------------- */

        const {
          data: receivedData,
          error: receivedError,
        } = await supabase
          .from('reports')
          .select(`
            id,
            employee_id,
            author_employee_id,
            recipient_employee_id,
            recipient_id,
            report_type_id,
            title,
            description,
            file_url,
            submitted_at,
            validated_at,
            created_at,
            received_at,
            forwarded_by,
            forwarded_at,
            structure_id,
            site_id,
            status,
            report_attachments (
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
          .eq('structure_id', profile.structure_id)
          .or(
            `recipient_employee_id.eq.${profile.id},` +
            `recipient_id.eq.${profile.id}`,
          )
          .order('submitted_at', {
            ascending: false,
            nullsFirst: false,
          })

        if (receivedError) {
          throw receivedError
        }

        /* ---------------------------------------------------
           MES RAPPORTS
           Rapports créés par le manager (vers l'admin).
        --------------------------------------------------- */

        const {
          data: myData,
          error: myError,
        } = await supabase
          .from('reports')
          .select(`
            id,
            employee_id,
            author_employee_id,
            recipient_employee_id,
            recipient_id,
            report_type_id,
            title,
            description,
            file_url,
            submitted_at,
            validated_at,
            created_at,
            received_at,
            forwarded_by,
            forwarded_at,
            structure_id,
            site_id,
            status,
            report_attachments (
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
            `employee_id.eq.${profile.id},` +
            `author_employee_id.eq.${profile.id}`,
          )
          .order('submitted_at', {
            ascending: false,
            nullsFirst: false,
          })

        if (myError) {
          throw myError
        }

        const reportData = [
          ...(receivedData ?? []),
          ...(myData ?? []).filter(
            (r) =>
              !(receivedData ?? []).some(
                (rec) => rec.id === r.id,
              ),
          ),
        ]

        /* ---------------------------------------------------
           MAPS
        --------------------------------------------------- */

        const employeeMap = new Map<string, Employee>()

          ; (employeeData ?? []).forEach((employee) => {
            employeeMap.set(employee.id, employee)
          })

        const siteMap = new Map<string, Site>()

          ; (siteData ?? []).forEach((site) => {
            siteMap.set(site.id, site)
          })

        const typeMap = new Map<string, ReportType>()

          ; (typeData ?? []).forEach((type) => {
            typeMap.set(type.id, type)
          })

        /* ---------------------------------------------------
           ENRICHMENT
        --------------------------------------------------- */

        const enrichedReports: Report[] = (
          reportData ?? []
        ).map((report) => {
          const employee =
            employeeMap.get(report.employee_id) ?? null

          const author =
            report.author_employee_id
              ? employeeMap.get(report.author_employee_id) ?? null
              : employee

          /*
           * Résolution du site du rapport (priorité décroissante) :
           *
           * 1. site_id enregistré directement sur le rapport
           * 2. site principal de l'employé via employee_sites (V3)
           * 3. site principal de l'auteur via employee_sites (V3)
           */
          const effectiveSiteId =
            report.site_id ??
            empSiteMap.get(report.employee_id) ??
            (report.author_employee_id
              ? empSiteMap.get(report.author_employee_id)
              : undefined) ??
            null

          const reportSite = effectiveSiteId
            ? siteMap.get(effectiveSiteId) ?? null
            : null

          return {
            ...report,
            employee,
            author,
            site: reportSite,
            report_types: typeMap.get(report.report_type_id) ?? null,
            report_attachments: report.report_attachments ?? [],
          }
        })

        setSites(siteData ?? [])
        setReportTypes(typeData ?? [])
        setReports(enrichedReports)
      } catch (error) {
        console.error(
          'Erreur chargement rapports manager:',
          error,
        )

        showFeedback(
          'error',
          error instanceof Error
            ? error.message
            : 'Impossible de charger les rapports.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [
      profile?.id,
      profile?.structure_id,
      showFeedback,
    ],
  )

  useEffect(() => {
    loadData()
  }, [loadData])

  /* =======================================================
     REPORT CATEGORIES
  ======================================================= */

  const myReports = useMemo(() => {
    if (!profile?.id) {
      return []
    }

    return reports.filter(
      (report) =>
        report.author_employee_id === profile.id ||
        report.employee_id === profile.id,
    )
  }, [reports, profile?.id])

  /*
   * recipient_employee_id est le champ canonique.
   *
   * On utilise également recipient_id comme compatibilité
   * uniquement si recipient_employee_id n'est pas renseigné.
   */
  const receivedReports = useMemo(() => {
    if (!profile?.id) {
      return []
    }

    return reports.filter(
      (report) =>
        report.recipient_employee_id === profile.id ||
        (
          !report.recipient_employee_id &&
          report.recipient_id === profile.id
        ),
    )
  }, [reports, profile?.id])

  /* =======================================================
     FILTERED REPORTS
  ======================================================= */

  const currentReports = useMemo(() => {
    const source =
      viewMode === 'mine' ? myReports : receivedReports

    const normalizedSearch = search.trim().toLowerCase()

    return source.filter((report) => {
      const employeeName = getEmployeeName(report.employee ?? report.author)
      const typeName = report.report_types?.name?.toLowerCase() ?? ''
      const title = report.title?.toLowerCase() ?? ''
      const description = report.description?.toLowerCase() ?? ''
      const siteName = report.site?.name?.toLowerCase() ?? ''

      const matchesSearch =
        !normalizedSearch ||
        title.includes(normalizedSearch) ||
        description.includes(normalizedSearch) ||
        employeeName.toLowerCase().includes(normalizedSearch) ||
        typeName.includes(normalizedSearch) ||
        siteName.includes(normalizedSearch)

      const matchesStatus =
        statusFilter === 'all' || report.status === statusFilter

      const matchesType =
        typeFilter === 'all' || report.report_type_id === typeFilter

      const matchesSite =
        siteFilter === 'all' ||
        (siteFilter === 'without-site' && !report.site?.id) ||
        report.site?.id === siteFilter

      return matchesSearch && matchesStatus && matchesType && matchesSite
    })
  }, [
    viewMode,
    myReports,
    receivedReports,
    search,
    statusFilter,
    typeFilter,
    siteFilter,
  ])

  /* =======================================================
     GROUP REPORTS BY SITE THEN TYPE

     IMPORTANT :
     Les groupes de sites sont maintenant créés à partir
     de `sites`, et non plus à partir des rapports.

     Cela permet d'afficher :

     Site 1
       └── rapports

     Site 2
       └── Aucun rapport

     Site 3
       └── Aucun rapport
  ======================================================= */

  /*
   * Catégorisation : Site → Type de rapport → Rapport
   *
   * Règle métier :
   * Un rapport appartient à un et un seul employé
   * qui appartient à un et un seul site de la structure.
   *
   * On initialise TOUS les sites actifs de la structure
   * pour afficher même les sites sans rapports.
   */
  const reportsBySite = useMemo<SiteReportGroup[]>(() => {
    if (viewMode !== 'received') return []

    /* 1. Initialiser tous les sites */
    const siteGroups = new Map<
      string,
      { site: Site | null; typeGroups: Map<string, { type: ReportType | null; reports: Report[] }> }
    >()

    sites.forEach((site) => {
      siteGroups.set(site.id, { site, typeGroups: new Map() })
    })

    /* 2. Bucket spécial pour rapports sans site identifié */
    const ensureWithoutSite = () => {
      if (!siteGroups.has('without-site')) {
        siteGroups.set('without-site', { site: null, typeGroups: new Map() })
      }
      return siteGroups.get('without-site')!
    }

    /* 3. Répartir les rapports */
    for (const report of currentReports) {
      const bucketId = report.site?.id ?? 'without-site'
      const group = siteGroups.get(bucketId) ?? ensureWithoutSite()

      const typeId = report.report_type_id ?? 'without-type'
      const reportType =
        report.report_types ??
        reportTypes.find((t) => t.id === report.report_type_id) ??
        null

      if (!group.typeGroups.has(typeId)) {
        group.typeGroups.set(typeId, { type: reportType, reports: [] })
      }
      group.typeGroups.get(typeId)!.reports.push(report)
    }

    /* 4. Convertir en tableau trié */
    return Array.from(siteGroups.entries())
      .map(([siteId, { site, typeGroups }]) => ({
        site: siteId === 'without-site' ? null : site,
        reportsByType: Array.from(typeGroups.values())
          .map(({ type, reports }) => ({
            type,
            reports: [...reports].sort((a, b) => {
              const da = new Date(a.submitted_at ?? a.created_at ?? 0).getTime()
              const db = new Date(b.submitted_at ?? b.created_at ?? 0).getTime()
              return db - da
            }),
          }))
          .sort((a, b) =>
            (a.type?.name ?? 'zzz').localeCompare(
              b.type?.name ?? 'zzz', 'fr',
            ),
          ),
      }))
      .sort((a, b) =>
        (a.site?.name ?? 'Site non attribué').localeCompare(
          b.site?.name ?? 'Site non attribué', 'fr',
        ),
      )
  }, [currentReports, sites, reportTypes, viewMode])

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    const received = receivedReports

    return {
      received: received.length,

      pending: received.filter(
        (report) =>
          report.status === 'submitted' ||
          report.status === 'received',
      ).length,

      forwarded: received.filter(
        (report) =>
          report.status === 'forwarded',
      ).length,

      mine: myReports.length,
    }
  }, [
    receivedReports,
    myReports,
  ])

  /* =======================================================
     DETAILS
  ======================================================= */

  const openDetails = (report: Report) => {
    setSelectedReport(report)
    setDetailsOpen(true)
  }

  const closeDetails = () => {
    setDetailsOpen(false)

    window.setTimeout(() => {
      setSelectedReport(null)
    }, 200)
  }

  /* =======================================================
     SIGNED URL
  ======================================================= */

  const getSignedUrl = async (
    attachment: Attachment,
  ) => {
    if (!attachment.file_path) {
      throw new Error(
        'Le chemin du fichier est introuvable.',
      )
    }

    const {
      data,
      error,
    } = await supabase.storage
      .from('reports')
      .createSignedUrl(
        attachment.file_path,
        60 * 60,
      )

    if (error) {
      throw error
    }

    if (!data?.signedUrl) {
      throw new Error(
        'Impossible de générer le lien du fichier.',
      )
    }

    return data.signedUrl
  }

  /* =======================================================
     PREVIEW
  ======================================================= */

  const previewFile = async (
    attachment: Attachment,
  ) => {
    setPreviewAttachment(attachment)
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewUrl(null)

    try {
      const url =
        await getSignedUrl(attachment)

      setPreviewUrl(url)
    } catch (error) {
      console.error(
        'Erreur preview:',
        error,
      )

      showFeedback(
        'error',
        'Impossible de prévisualiser ce fichier.',
      )

      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  /* =======================================================
     DOWNLOAD
  ======================================================= */

  const downloadFile = async (
    attachment: Attachment,
  ) => {
    try {
      const url =
        await getSignedUrl(attachment)

      const response =
        await fetch(url)

      if (!response.ok) {
        throw new Error(
          'Impossible de récupérer le fichier.',
        )
      }

      const blob =
        await response.blob()

      const blobUrl =
        URL.createObjectURL(blob)

      const link =
        document.createElement('a')

      link.href = blobUrl
      link.download =
        attachment.file_name

      document.body.appendChild(link)

      link.click()

      link.remove()

      URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error(
        'Erreur téléchargement:',
        error,
      )

      showFeedback(
        'error',
        'Impossible de télécharger le fichier.',
      )
    }
  }

  /* =======================================================
     CREATE REPORT
  ======================================================= */

  const resetCreateForm = () => {
    setNewReportTypeId('')
    setNewTitle('')
    setNewDescription('')
    setNewFiles([])
  }

  const handleFilesChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(
      event.target.files ?? [],
    )

    setNewFiles(files)
  }

  const createReport = async () => {
    if (!profile?.id || !profile.structure_id) {
      showFeedback('error', 'Profil utilisateur introuvable.')
      return
    }

    if (!newReportTypeId) {
      showFeedback('error', 'Sélectionnez le type de rapport.')
      return
    }

    if (!newTitle.trim()) {
      showFeedback('error', 'Le titre du rapport est obligatoire.')
      return
    }

    setCreating(true)

    try {
      /* -------------------------------------------------------
         STEP 1 — Créer le rapport via la RPC sécurisée
         La RPC détermine automatiquement :
           • l'auteur (auth.uid() → employees)
           • la structure
           • le site principal
           • les destinataires (manager + admin selon le rôle)
           • les notifications
         Le frontend n'envoie QUE les données métier.
      ------------------------------------------------------- */
      const {
        data: reportId,
        error: rpcError,
      } = await supabase.rpc('submit_report', {
        p_report_type_id: newReportTypeId,
        p_title: newTitle.trim(),
        p_description: newDescription.trim() || null,
      })

      if (rpcError) {
        throw rpcError
      }

      if (!reportId) {
        throw new Error(
          'Le rapport a été créé mais son identifiant est introuvable.',
        )
      }

      /* -------------------------------------------------------
         STEP 2 — Upload des pièces jointes (si présentes)
      ------------------------------------------------------- */
      for (const file of newFiles) {
        const extension =
          file.name.includes('.')
            ? file.name.split('.').pop()?.toLowerCase() ?? 'file'
            : 'file'

        const filePath = [
          profile.structure_id,
          profile.id,
          reportId,
          `${crypto.randomUUID()}.${extension}`,
        ].join('/')

        const { error: uploadError } = await supabase.storage
          .from('reports')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || undefined,
          })

        if (uploadError) {
          console.error('Erreur upload fichier:', uploadError)
          continue
        }

        const { error: attachmentError } = await supabase
          .from('report_attachments')
          .insert({
            report_id: reportId,
            file_name: file.name,
            file_path: filePath,
            file_url: null,
            mime_type: file.type || null,
            file_size: file.size,
          })

        if (attachmentError) {
          console.error('Erreur insertion attachment:', attachmentError)
        }
      }

      resetCreateForm()
      setCreateOpen(false)

      showFeedback(
        'success',
        'Votre rapport a été envoyé à l\u2019administrateur.',
      )

      await loadData(false)
    } catch (error) {
      console.error('Erreur création rapport:', error)

      showFeedback(
        'error',
        error instanceof Error
          ? error.message
          : 'Impossible de créer le rapport.',
      )
    } finally {
      setCreating(false)
    }
  }

  /* =======================================================
     RENDER ATTACHMENT
  ======================================================= */

  const renderAttachment = (
    attachment: Attachment,
  ) => {
    return (
      <div
        key={attachment.id}
        className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            {isImage(attachment) ? (
              <ImageIcon className="h-5 w-5" />
            ) : isPdf(attachment) ? (
              <FileText className="h-5 w-5" />
            ) : (
              <File className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {attachment.file_name}
            </p>

            {attachment.file_size ? (
              <p className="text-xs text-muted-foreground">
                {formatFileSize(
                  attachment.file_size,
                )}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {(isImage(attachment) ||
            isPdf(attachment)) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Consulter"
                onClick={() =>
                  previewFile(attachment)
                }
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Télécharger"
            onClick={() =>
              downloadFile(attachment)
            }
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  /* =======================================================
     REPORT CARD
  ======================================================= */

  const renderReportCard = (
    report: Report,
  ) => {
    const employee =
      report.employee ??
      report.author

    const employeeName =
      getEmployeeName(employee)

    return (
      <div
        key={report.id}
        className="rounded-xl border bg-card p-4 transition hover:shadow-sm"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
              <FileText className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">
                  {report.title}
                </h3>

                <Badge
                  className={
                    statusClasses[
                    report.status
                    ]
                  }
                >
                  {
                    statusLabels[
                    report.status
                    ]
                  }
                </Badge>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {viewMode ===
                  'received' && (
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {employeeName}
                    </span>
                  )}

                {report.report_types?.name && (
                  <span>
                    {report.report_types.name}
                  </span>
                )}

                <span>
                  {formatDate(
                    report.submitted_at ??
                    report.created_at,
                  )}
                </span>

                {report.site?.name && (
                  <span>
                    Site : {report.site.name}
                  </span>
                )}
              </div>

              {report.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {report.description}
                </p>
              )}

              {report.report_attachments &&
                report.report_attachments.length >
                0 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <File className="h-3.5 w-3.5" />

                    {
                      report
                        .report_attachments
                        .length
                    }{' '}
                    pièce
                    {report
                      .report_attachments
                      .length > 1
                      ? 's'
                      : ''}{' '}
                    jointe
                    {report
                      .report_attachments
                      .length > 1
                      ? 's'
                      : ''}
                  </div>
                )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
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

            {report.report_attachments &&
              report.report_attachments.length >
              0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadFile(
                      report.report_attachments![0],
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" />
                  Télécharger
                </Button>
              )}
          </div>
        </div>
      </div>
    )
  }

  /* =======================================================
     EMPTY STATE
  ======================================================= */

  const renderEmptyState = () => {
    return (
      <div className="rounded-xl border bg-card py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground/50" />

        <h3 className="mt-4 font-semibold">
          Aucun rapport trouvé
        </h3>

        <p className="mt-1 text-sm text-muted-foreground">
          {viewMode === 'received'
            ? 'Aucun rapport reçu ne correspond aux filtres.'
            : "Vous n'avez encore créé aucun rapport."}
        </p>

        {viewMode === 'mine' && (
          <Button
            className="mt-5"
            onClick={() =>
              setCreateOpen(true)
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Créer un rapport
          </Button>
        )}
      </div>
    )
  }

  /* =======================================================
     LOADING
  ======================================================= */

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
    )
  }

  /* =======================================================
     MAIN RENDER
  ======================================================= */

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">

        {/* FEEDBACK */}

        {feedback && (
          <div
            className={`fixed right-4 top-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border bg-background p-4 shadow-lg ${feedback.type === 'success'
              ? 'border-green-200'
              : 'border-red-200'
              }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            )}

            <p className="text-sm">
              {feedback.message}
            </p>

            <button
              type="button"
              onClick={() =>
                setFeedback(null)
              }
              className="ml-auto"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* HEADER */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Rapports
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              Consultez les rapports reçus ou gérez vos propres rapports.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                loadData(false)
              }
              disabled={refreshing}
              title="Actualiser"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing
                  ? 'animate-spin'
                  : ''
                  }`}
              />
            </Button>

            <Button
              onClick={() =>
                setCreateOpen(true)
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Nouveau rapport
            </Button>
          </div>
        </div>

        {/* VIEW SWITCH */}

        <div className="rounded-xl border bg-muted/40 p-1">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => {
                setViewMode('mine')
                setSearch('')
                setStatusFilter('all')
                setTypeFilter('all')
              }}
              className={`rounded-lg px-4 py-3 text-sm font-medium transition ${viewMode === 'mine'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              Mes rapports

              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                {stats.mine}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode('received')
                setSearch('')
                setStatusFilter('all')
                setTypeFilter('all')
              }}
              className={`rounded-lg px-4 py-3 text-sm font-medium transition ${viewMode === 'received'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              Rapports reçus

              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                {stats.received}
              </span>
            </button>
          </div>
        </div>

        {/* STATS */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              Mes rapports
            </p>

            <p className="mt-1 text-2xl font-bold">
              {stats.mine}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              Rapports reçus
            </p>

            <p className="mt-1 text-2xl font-bold">
              {stats.received}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              À consulter
            </p>

            <p className="mt-1 text-2xl font-bold">
              {stats.pending}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              Transmis
            </p>

            <p className="mt-1 text-2xl font-bold">
              {stats.forwarded}
            </p>
          </div>
        </div>

        {/* FILTERS */}

        <div className={`grid gap-3 rounded-xl border bg-card p-4 ${viewMode === 'received' ? 'md:grid-cols-[1fr_160px_180px_180px]' : 'md:grid-cols-[1fr_160px_180px]'}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                viewMode === 'received'
                  ? 'Rechercher un site, employé ou rapport...'
                  : 'Rechercher un rapport...'
              }
              className="pl-9"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {(Object.keys(statusLabels) as ReportStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabels[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {reportTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {viewMode === 'received' && (
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les sites</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
                <SelectItem value="without-site">Sans site</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* REPORTS */}

        {viewMode === 'received' ? (
          <div className="space-y-4">

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Rapports reçus</h2>
                <p className="text-sm text-muted-foreground">
                  {reportsBySite.length} site{reportsBySite.length > 1 ? 's' : ''}
                  {' '}•{' '}
                  {currentReports.length} rapport{currentReports.length > 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => expandAllSites(reportsBySite)}
                >
                  Tout ouvrir
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={collapseAllSites}
                >
                  Tout fermer
                </Button>
              </div>
            </div>

            {reportsBySite.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card py-16 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-4 font-semibold">Aucun rapport reçu</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Aucun rapport ne correspond aux filtres sélectionnés.
                </p>
              </div>
            ) : (
              reportsBySite.map((siteGroup) => {
                const siteId = siteGroup.site?.id ?? 'without-site'
                const siteName = siteGroup.site?.name ?? 'Site non attribué'
                const totalReports = siteGroup.reportsByType.reduce(
                  (sum, tg) => sum + tg.reports.length, 0,
                )
                const isSiteExpanded = expandedSites.has(siteId)

                return (
                  <div key={siteId} className="overflow-hidden rounded-2xl border bg-card">

                    {/* EN-TÊTE SITE */}
                    <button
                      type="button"
                      onClick={() => toggleSite(siteId)}
                      className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          {isSiteExpanded
                            ? <ChevronDown className="h-5 w-5" />
                            : <ChevronRight className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold">{siteName}</h3>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {totalReports} rapport{totalReports > 1 ? 's' : ''}
                            {siteGroup.reportsByType.length > 0 && (
                              <>
                                {' '}•{' '}
                                {siteGroup.reportsByType.length} type{siteGroup.reportsByType.length > 1 ? 's' : ''}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">{totalReports}</Badge>
                    </button>

                    {/* CONTENU SITE */}
                    {isSiteExpanded && (
                      <div className="border-t bg-muted/10 p-4 md:p-5">
                        {siteGroup.reportsByType.length === 0 ? (
                          <div className="rounded-xl border border-dashed bg-background p-8 text-center">
                            <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                            <p className="mt-3 text-sm font-medium">Aucun rapport pour ce site</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Aucun rapport reçu ne correspond aux filtres actifs.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {siteGroup.reportsByType.map((typeGroup) => {
                              const typeId = typeGroup.type?.id ?? 'without-type'
                              const typeKey = `${siteId}-${typeId}`
                              const typeName = typeGroup.type?.name ?? 'Type non défini'
                              const isTypeExpanded = expandedTypes.has(typeKey)

                              return (
                                <div
                                  key={typeKey}
                                  className="overflow-hidden rounded-xl border bg-background"
                                >
                                  {/* EN-TÊTE TYPE */}
                                  <button
                                    type="button"
                                    onClick={() => toggleType(typeKey)}
                                    className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-muted/30"
                                  >
                                    <div className="flex min-w-0 items-center gap-3">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                        {isTypeExpanded
                                          ? <ChevronDown className="h-4 w-4" />
                                          : <ChevronRight className="h-4 w-4" />}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-medium">{typeName}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {typeGroup.reports.length} rapport{typeGroup.reports.length > 1 ? 's' : ''}
                                        </p>
                                      </div>
                                    </div>
                                    <Badge variant="outline">{typeGroup.reports.length}</Badge>
                                  </button>

                                  {/* RAPPORTS */}
                                  {isTypeExpanded && (
                                    <div className="space-y-3 border-t bg-muted/5 p-3 md:p-4">
                                      {typeGroup.reports.map((report) =>
                                        renderReportCard(report),
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        ) : currentReports.length === 0 ? (
          renderEmptyState()
        ) : (
          /* MES RAPPORTS */
          <div className="space-y-3">
            {currentReports.map(
              (report) =>
                renderReportCard(report),
            )}
          </div>
        )}

        {/* =================================================
            DETAILS DIALOG
        ================================================= */}

        <Dialog
          open={detailsOpen}
          onOpenChange={
            setDetailsOpen
          }
        >
          <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
            {selectedReport && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {selectedReport.title}
                  </DialogTitle>

                  <DialogDescription>
                    {viewMode ===
                      'received'
                      ? `Rapport envoyé par ${getEmployeeName(
                        selectedReport.employee ??
                        selectedReport.author,
                      )}`
                      : 'Votre rapport'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">

                  {/* INFORMATIONS */}

                  <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                    {viewMode ===
                      'received' && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Employé
                          </p>

                          <p className="mt-1 font-medium">
                            {getEmployeeName(
                              selectedReport.employee ??
                              selectedReport.author,
                            )}
                          </p>
                        </div>
                      )}

                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Type
                      </p>

                      <p className="mt-1 font-medium">
                        {selectedReport
                          .report_types
                          ?.name ?? '—'}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Statut
                      </p>

                      <div className="mt-1">
                        <Badge
                          className={
                            statusClasses[
                            selectedReport.status
                            ]
                          }
                        >
                          {
                            statusLabels[
                            selectedReport.status
                            ]
                          }
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Date d'envoi
                      </p>

                      <p className="mt-1 font-medium">
                        {formatDate(
                          selectedReport.submitted_at,
                        )}
                      </p>
                    </div>

                    {selectedReport.site && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Site
                        </p>

                        <p className="mt-1 font-medium">
                          {
                            selectedReport
                              .site.name
                          }
                        </p>
                      </div>
                    )}
                  </div>

                  {/* DESCRIPTION */}

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">
                      Contenu du rapport
                    </h3>

                    <div className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-sm leading-6">
                      {selectedReport.description ||
                        'Aucune description.'}
                    </div>
                  </div>

                  {/* ATTACHMENTS */}

                  <div>
                    <h3 className="mb-3 text-sm font-semibold">
                      Pièces jointes
                    </h3>

                    {selectedReport
                      .report_attachments &&
                      selectedReport
                        .report_attachments
                        .length > 0 ? (
                      <div className="space-y-2">
                        {selectedReport.report_attachments.map(
                          renderAttachment,
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                        Aucune pièce jointe.
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={
                      closeDetails
                    }
                  >
                    Fermer
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* =================================================
            CREATE REPORT DIALOG
        ================================================= */}

        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!creating) {
              setCreateOpen(open)

              if (!open) {
                resetCreateForm()
              }
            }
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Nouveau rapport
              </DialogTitle>

              <DialogDescription>
                Créez un rapport qui sera transmis à l'administrateur.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">

              {/* TYPE */}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Type de rapport
                </label>

                <Select
                  value={
                    newReportTypeId
                  }
                  onValueChange={
                    setNewReportTypeId
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

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Titre
                </label>

                <Input
                  value={newTitle}
                  onChange={(event) =>
                    setNewTitle(
                      event.target.value,
                    )
                  }
                  placeholder="Titre du rapport"
                  maxLength={255}
                />
              </div>

              {/* DESCRIPTION */}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Description
                </label>

                <Textarea
                  value={
                    newDescription
                  }
                  onChange={(event) =>
                    setNewDescription(
                      event.target.value,
                    )
                  }
                  placeholder="Décrivez votre rapport..."
                  rows={7}
                />
              </div>

              {/* FILES */}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Pièces jointes
                </label>

                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition hover:bg-muted/40">
                  <Upload className="h-7 w-7 text-muted-foreground" />

                  <span className="mt-2 text-sm font-medium">
                    Ajouter des fichiers
                  </span>

                  <span className="mt-1 text-xs text-muted-foreground">
                    PDF, images, documents, etc.
                  </span>

                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={
                      handleFilesChange
                    }
                  />
                </label>

                {newFiles.length >
                  0 && (
                    <div className="space-y-2">
                      {newFiles.map(
                        (
                          file,
                          index,
                        ) => (
                          <div
                            key={`${file.name}-${index}`}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <File className="h-4 w-4 shrink-0" />

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

                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                setNewFiles(
                                  (
                                    current,
                                  ) =>
                                    current.filter(
                                      (
                                        _,
                                        i,
                                      ) =>
                                        i !==
                                        index,
                                    ),
                                )
                              }
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  )}
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => {
                  setCreateOpen(false)
                  resetCreateForm()
                }}
              >
                Annuler
              </Button>

              <Button
                type="button"
                disabled={creating}
                onClick={
                  createReport
                }
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Envoyer à l'administration
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* =================================================
            PREVIEW
        ================================================= */}

        <Dialog
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open)

            if (!open) {
              setPreviewUrl(null)
              setPreviewAttachment(null)
            }
          }}
        >
          <DialogContent className="h-[90vh] w-[calc(100%-2rem)] max-w-6xl p-0">
            <div className="flex h-full flex-col">

              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">
                    {
                      previewAttachment?.file_name
                    }
                  </h3>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setPreviewOpen(false)
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
                {previewLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : previewUrl &&
                  previewAttachment &&
                  isImage(
                    previewAttachment,
                  ) ? (
                  <img
                    src={previewUrl}
                    alt={
                      previewAttachment.file_name
                    }
                    className="max-h-full max-w-full object-contain"
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
                    className="h-full w-full rounded-lg border bg-white"
                  />
                ) : (
                  <div className="text-center">
                    <File className="mx-auto h-12 w-12 text-muted-foreground" />

                    <p className="mt-3 text-sm text-muted-foreground">
                      Ce fichier ne peut pas être prévisualisé.
                    </p>

                    {previewAttachment && (
                      <Button
                        className="mt-4"
                        onClick={() =>
                          downloadFile(
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
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout >
  )
}
