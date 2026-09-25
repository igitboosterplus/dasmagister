import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/DashboardLayout'
import { supabase } from '@/integrations/supabase/client'

import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  Filter,
  Loader2,
  Search,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'received'
  | 'forwarded'
  | 'reviewed'
  | 'archived'
  | 'rejected'

interface Structure {
  id: string
  name: string
  code: string
  is_active: boolean
}

interface Site {
  id: string
  name: string
  structure_id: string
  city_id: string | null
  type: string | null
  is_active: boolean
}

interface Employee {
  id: string
  first_name: string
  last_name: string
  structure_id: string | null
  site_id: string | null
  service_id: string | null
  position_id: string | null
  is_active: boolean
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

const REPORT_BUCKET = 'reports'

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

function formatDate(value: string | null | undefined) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatFileSize(size: number | null) {
  if (!size) return '—'

  if (size < 1024) return `${size} o`

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} Ko`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} Mo`
}

function isImage(file: Attachment) {
  return (
    file.mime_type?.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.file_name)
  )
}

function isPdf(file: Attachment) {
  return (
    file.mime_type === 'application/pdf' ||
    /\.pdf$/i.test(file.file_name)
  )
}

function getFileIcon(file: Attachment) {
  if (isImage(file)) return FileImage
  if (isPdf(file)) return FileText
  return File
}

export default function AdminReports() {
  const [structures, setStructures] = useState<Structure[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [reportTypes, setReportTypes] = useState<ReportType[]>([])

  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [structureFilter, setStructureFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const [expandedStructures, setExpandedStructures] =
    useState<Record<string, boolean>>({})

  const [expandedSites, setExpandedSites] =
    useState<Record<string, boolean>>({})

  const [expandedEmployees, setExpandedEmployees] =
    useState<Record<string, boolean>>({})

  const [selectedReport, setSelectedReport] =
    useState<Report | null>(null)

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<Attachment | null>(null)

  const [downloading, setDownloading] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)

    try {
      const [
        structuresResult,
        sitesResult,
        employeesResult,
        reportsResult,
        typesResult,
      ] = await Promise.all([
        supabase
          .from('structures')
          .select('id, name, code, is_active')
          .order('name'),

        supabase
          .from('sites')
          .select(
            'id, name, structure_id, city_id, type, is_active',
          )
          .eq('is_active', true)
          .order('name'),

        supabase
          .from('employees')
          .select(
            'id, first_name, last_name, structure_id, site_id, service_id, position_id, is_active',
          )
          .eq('is_active', true)
          .order('last_name'),

        supabase
          .from('reports')
          .select(`
            id,
            employee_id,
            author_employee_id,
            report_type_id,
            title,
            description,
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
          .order('submitted_at', { ascending: false }),

        supabase
          .from('report_types')
          .select('id, name')
          .order('name'),
      ])

      if (structuresResult.error) throw structuresResult.error
      if (sitesResult.error) throw sitesResult.error
      if (employeesResult.error) throw employeesResult.error
      if (reportsResult.error) throw reportsResult.error
      if (typesResult.error) throw typesResult.error

      setStructures(structuresResult.data || [])
      setSites(sitesResult.data || [])
      setEmployees(employeesResult.data || [])
      setReports(
        (reportsResult.data || []) as unknown as Report[],
      )
      setReportTypes(typesResult.data || [])

      const structureState: Record<string, boolean> = {}

      ;(structuresResult.data || []).forEach((structure) => {
        structureState[structure.id] = true
      })

      setExpandedStructures(structureState)
    } catch (error) {
      console.error('Erreur chargement administration:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getEmployee = (report: Report) => {
    const employeeId =
      report.author_employee_id || report.employee_id

    return employees.find((employee) => employee.id === employeeId)
  }

  const getStructure = (report: Report) => {
    const employee = getEmployee(report)

    return structures.find(
      (structure) =>
        structure.id ===
        (report.structure_id || employee?.structure_id),
    )
  }

  const getSite = (report: Report) => {
    const employee = getEmployee(report)

    return sites.find(
      (site) =>
        site.id ===
        (report.site_id || employee?.site_id),
    )
  }

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase()

    return reports.filter((report) => {
      const employee = getEmployee(report)
      const structure = getStructure(report)
      const site = getSite(report)

      const employeeName = employee
        ? `${employee.first_name} ${employee.last_name}`
        : ''

      const reportStructureId =
        report.structure_id || employee?.structure_id

      const reportSiteId = report.site_id || employee?.site_id

      const matchesStructure =
        structureFilter === 'all' ||
        reportStructureId === structureFilter

      const matchesSite =
        siteFilter === 'all' ||
        reportSiteId === siteFilter

      const matchesStatus =
        statusFilter === 'all' ||
        report.status === statusFilter

      const matchesType =
        typeFilter === 'all' ||
        report.report_type_id === typeFilter

      const matchesSearch =
        !query ||
        report.title.toLowerCase().includes(query) ||
        report.description?.toLowerCase().includes(query) ||
        employeeName.toLowerCase().includes(query) ||
        structure?.name.toLowerCase().includes(query) ||
        site?.name.toLowerCase().includes(query) ||
        report.report_types?.name.toLowerCase().includes(query)

      return (
        matchesStructure &&
        matchesSite &&
        matchesStatus &&
        matchesType &&
        matchesSearch
      )
    })
  }, [
    reports,
    employees,
    structures,
    sites,
    search,
    structureFilter,
    siteFilter,
    statusFilter,
    typeFilter,
  ])

  const groupedData = useMemo(() => {
    return structures
      .map((structure) => {
        const structureSites = sites.filter(
          (site) => site.structure_id === structure.id,
        )

        const siteGroups = structureSites
          .map((site) => {
            const siteEmployees = employees.filter(
              (employee) =>
                employee.site_id === site.id &&
                employee.structure_id === structure.id,
            )

            const employeeGroups = siteEmployees
              .map((employee) => {
                const employeeReports =
                  filteredReports.filter((report) => {
                    const reportEmployeeId =
                      report.author_employee_id ||
                      report.employee_id

                    const reportSiteId =
                      report.site_id || employee.site_id

                    return (
                      reportEmployeeId === employee.id &&
                      reportSiteId === site.id
                    )
                  })

                return {
                  employee,
                  reports: employeeReports,
                }
              })
              .filter(
                (group) => group.reports.length > 0,
              )

            return {
              site,
              employeeGroups,
              totalReports: employeeGroups.reduce(
                (sum, group) => sum + group.reports.length,
                0,
              ),
            }
          })
          .filter((group) => group.totalReports > 0)

        return {
          structure,
          siteGroups,
          totalReports: siteGroups.reduce(
            (sum, group) => sum + group.totalReports,
            0,
          ),
        }
      })
      .filter((group) => group.totalReports > 0)
  }, [structures, sites, employees, filteredReports])

  const stats = useMemo(() => {
    return {
      total: reports.length,
      submitted: reports.filter(
        (report) => report.status === 'submitted',
      ).length,
      forwarded: reports.filter(
        (report) => report.status === 'forwarded',
      ).length,
      reviewed: reports.filter(
        (report) => report.status === 'reviewed',
      ).length,
      structures: new Set(
        reports.map(
          (report) =>
            report.structure_id ||
            getEmployee(report)?.structure_id,
        ),
      ).size,
    }
  }, [reports, employees])

  const toggleStructure = (id: string) => {
    setExpandedStructures((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const toggleSite = (id: string) => {
    setExpandedSites((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const toggleEmployee = (id: string) => {
    setExpandedEmployees((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const getSignedUrl = async (path: string) => {
    const { data, error } = await supabase.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(path, 600)

    if (error) throw error

    return data.signedUrl
  }

  const previewFile = async (attachment: Attachment) => {
    try {
      const url = await getSignedUrl(attachment.file_path)

      setPreviewAttachment(attachment)
      setPreviewUrl(url)
      setPreviewOpen(true)
    } catch (error) {
      console.error(error)
      alert('Impossible d’ouvrir cette pièce jointe.')
    }
  }

  const downloadFile = async (attachment: Attachment) => {
    try {
      setDownloading(attachment.id)

      const url = await getSignedUrl(attachment.file_path)

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Téléchargement impossible.')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)

      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = attachment.file_name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()

      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error(error)
      alert('Impossible de télécharger le fichier.')
    } finally {
      setDownloading(null)
    }
  }

  const ReportRow = ({ report }: { report: Report }) => {
    const employee = getEmployee(report)

    return (
      <div className="rounded-xl border bg-background p-4 transition-colors hover:bg-muted/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">
                {report.title}
              </h4>

              <Badge
                variant="outline"
                className={STATUS_CLASSES[report.status]}
              >
                {STATUS_LABELS[report.status]}
              </Badge>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {report.report_types?.name || 'Type non défini'}
              </span>

              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(report.submitted_at)}
              </span>

              {report.attachments?.length > 0 && (
                <span className="flex items-center gap-1">
                  <File className="h-3.5 w-3.5" />
                  {report.attachments.length} pièce(s)
                </span>
              )}
            </div>

            <div className="mt-2 text-xs font-medium text-muted-foreground">
              Auteur :{' '}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : 'Employé inconnu'}
            </div>

            {report.description && (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {report.description}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              setSelectedReport(report)
              setDetailsOpen(true)
            }}
          >
            <Eye className="h-4 w-4" />
            Consulter
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        {/* HEADER */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            Administration
          </div>

          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Rapports des structures
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Consultez les rapports organisés par structure, site et
            employé.
          </p>
        </div>

        {/* STATS */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Rapports
              </p>

              <p className="mt-1 text-2xl font-bold">
                {stats.total}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Structures
              </p>

              <p className="mt-1 text-2xl font-bold">
                {stats.structures}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Soumis
              </p>

              <p className="mt-1 text-2xl font-bold text-blue-600">
                {stats.submitted}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Transmis
              </p>

              <p className="mt-1 text-2xl font-bold text-violet-600">
                {stats.forwarded}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Examinés
              </p>

              <p className="mt-1 text-2xl font-bold text-emerald-600">
                {stats.reviewed}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* FILTERS */}
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-3 lg:grid-cols-5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="pl-9"
                />
              </div>

              <Select
                value={structureFilter}
                onValueChange={(value) => {
                  setStructureFilter(value)
                  setSiteFilter('all')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Structure" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Toutes les structures
                  </SelectItem>

                  {structures.map((structure) => (
                    <SelectItem
                      key={structure.id}
                      value={structure.id}
                    >
                      {structure.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={siteFilter}
                onValueChange={setSiteFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Site" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Tous les sites
                  </SelectItem>

                  {sites
                    .filter(
                      (site) =>
                        structureFilter === 'all' ||
                        site.structure_id === structureFilter,
                    )
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

              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
                <SelectTrigger>
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Tous les statuts
                  </SelectItem>

                  {Object.entries(STATUS_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Select
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Tous les types
                  </SelectItem>

                  {reportTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* HIERARCHY */}
        {loading ? (
          <div className="flex min-h-[400px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : groupedData.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-[350px] flex-col items-center justify-center text-center">
              <div className="rounded-full bg-muted p-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>

              <h3 className="mt-4 font-semibold">
                Aucun rapport trouvé
              </h3>

              <p className="mt-1 text-sm text-muted-foreground">
                Aucun rapport ne correspond aux critères sélectionnés.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {groupedData.map(
              ({
                structure,
                siteGroups,
                totalReports,
              }) => (
                <Card
                  key={structure.id}
                  className="overflow-hidden"
                >
                  {/* STRUCTURE */}
                  <button
                    type="button"
                    onClick={() =>
                      toggleStructure(structure.id)
                    }
                    className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-muted/40"
                  >
                    {expandedStructures[structure.id] ? (
                      <ChevronDown className="h-5 w-5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0" />
                    )}

                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">
                          {structure.name}
                        </h2>

                        <Badge variant="outline">
                          {structure.code}
                        </Badge>
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {totalReports}{' '}
                        {totalReports > 1
                          ? 'rapports'
                          : 'rapport'}
                      </p>
                    </div>

                    <Badge variant="secondary">
                      {siteGroups.length} site
                      {siteGroups.length > 1 ? 's' : ''}
                    </Badge>
                  </button>

                  {expandedStructures[structure.id] && (
                    <div className="space-y-3 border-t bg-muted/10 p-4">
                      {siteGroups.map(
                        ({
                          site,
                          employeeGroups,
                          totalReports: siteTotal,
                        }) => (
                          <div
                            key={site.id}
                            className="rounded-xl border bg-background"
                          >
                            {/* SITE */}
                            <button
                              type="button"
                              onClick={() =>
                                toggleSite(site.id)
                              }
                              className="flex w-full items-center gap-3 p-4 text-left"
                            >
                              {expandedSites[site.id] ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}

                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                                <Users className="h-4 w-4" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="font-medium">
                                  {site.name}
                                </p>

                                <p className="text-xs text-muted-foreground">
                                  {site.type || 'Site'} ·{' '}
                                  {siteTotal} rapport
                                  {siteTotal > 1
                                    ? 's'
                                    : ''}
                                </p>
                              </div>

                              <Badge variant="outline">
                                {employeeGroups.length}{' '}
                                employé
                                {employeeGroups.length > 1
                                  ? 's'
                                  : ''}
                              </Badge>
                            </button>

                            {expandedSites[site.id] && (
                              <div className="space-y-3 border-t p-3">
                                {employeeGroups.map(
                                  ({
                                    employee,
                                    reports:
                                      employeeReports,
                                  }) => (
                                    <div
                                      key={employee.id}
                                      className="rounded-xl border"
                                    >
                                      {/* EMPLOYEE */}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleEmployee(
                                            employee.id,
                                          )
                                        }
                                        className="flex w-full items-center gap-3 p-4 text-left"
                                      >
                                        {expandedEmployees[
                                          employee.id
                                        ] ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}

                                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                                          {employee.first_name.charAt(
                                            0,
                                          )}
                                          {employee.last_name.charAt(
                                            0,
                                          )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                          <p className="font-medium">
                                            {
                                              employee.first_name
                                            }{' '}
                                            {
                                              employee.last_name
                                            }
                                          </p>

                                          <p className="text-xs text-muted-foreground">
                                            {
                                              employeeReports.length
                                            }{' '}
                                            rapport
                                            {employeeReports.length >
                                            1
                                              ? 's'
                                              : ''}
                                          </p>
                                        </div>
                                      </button>

                                      {expandedEmployees[
                                        employee.id
                                      ] && (
                                        <div className="space-y-2 border-t bg-muted/10 p-3">
                                          {employeeReports.map(
                                            (report) => (
                                              <ReportRow
                                                key={
                                                  report.id
                                                }
                                                report={
                                                  report
                                                }
                                              />
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </Card>
              ),
            )}
          </div>
        )}
      </div>

      {/* DETAILS */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selectedReport && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>
                    {selectedReport.title}
                  </DialogTitle>

                  <Badge
                    variant="outline"
                    className={
                      STATUS_CLASSES[selectedReport.status]
                    }
                  >
                    {STATUS_LABELS[selectedReport.status]}
                  </Badge>
                </div>

                <DialogDescription>
                  {selectedReport.report_types?.name ||
                    'Type non défini'}{' '}
                  · {formatDate(selectedReport.submitted_at)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">
                      Employé
                    </p>

                    <p className="mt-1 font-medium">
                      {getEmployee(selectedReport)
                        ? `${getEmployee(selectedReport)?.first_name} ${getEmployee(selectedReport)?.last_name}`
                        : 'Inconnu'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">
                      Structure
                    </p>

                    <p className="mt-1 font-medium">
                      {getStructure(selectedReport)?.name ||
                        'Inconnue'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">
                      Site
                    </p>

                    <p className="mt-1 font-medium">
                      {getSite(selectedReport)?.name ||
                        'Inconnu'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">
                      Date de transmission
                    </p>

                    <p className="mt-1 font-medium">
                      {formatDate(
                        selectedReport.submitted_at,
                      )}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-muted/40 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {selectedReport.description ||
                      'Aucune description.'}
                  </p>
                </div>

                {selectedReport.attachments?.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold">
                      Pièces jointes
                    </h3>

                    <div className="space-y-2">
                      {selectedReport.attachments.map(
                        (attachment) => {
                          const Icon = getFileIcon(
                            attachment,
                          )

                          return (
                            <div
                              key={attachment.id}
                              className="flex items-center gap-3 rounded-xl border p-3"
                            >
                              <Icon className="h-5 w-5" />

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {attachment.file_name}
                                </p>

                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(
                                    attachment.file_size,
                                  )}
                                </p>
                              </div>

                              <div className="flex gap-1">
                                {(isImage(attachment) ||
                                  isPdf(attachment)) && (
                                  <Button
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

      {/* PREVIEW */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[95vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {previewAttachment?.file_name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex max-h-[75vh] min-h-[300px] items-center justify-center overflow-auto rounded-xl bg-muted/30">
            {previewUrl && previewAttachment && isImage(previewAttachment) ? (
              <img
                src={previewUrl}
                alt={previewAttachment.file_name}
                className="max-h-[70vh] max-w-full object-contain"
              />
            ) : previewUrl && previewAttachment && isPdf(previewAttachment) ? (
              <iframe
                src={previewUrl}
                title={previewAttachment.file_name}
                className="h-[70vh] w-full"
              />
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Aperçu indisponible.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}