/**
 * Utilitaires partagés pour le module Rapports (Reports).
 * Gestion des statuts, validation des pièces jointes et traduction des erreurs Supabase / RPC.
 */

export type ReportStatus =
    | 'draft'
    | 'submitted'
    | 'received'
    | 'forwarded'
    | 'reviewed'
    | 'archived'
    | 'rejected'

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
    draft: 'Brouillon',
    submitted: 'Soumis',
    received: 'Reçu',
    forwarded: 'Transmis',
    reviewed: 'Examiné',
    archived: 'Archivé',
    rejected: 'Rejeté',
}

export const REPORT_STATUS_CLASSES: Record<ReportStatus, string> = {
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    received: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    forwarded: 'bg-violet-50 text-violet-700 border-violet-200',
    reviewed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    archived: 'bg-gray-100 text-gray-700 border-gray-200',
    rejected: 'bg-red-50 text-red-700 border-red-200',
}

export const MAX_REPORT_FILE_SIZE_BYTES = 15 * 1024 * 1024 // 15 Mo

export const ALLOWED_REPORT_EXTENSIONS = [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'svg',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'csv',
    'txt',
]

/**
 * Valide un fichier avant l'upload.
 */
export function validateReportFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_REPORT_FILE_SIZE_BYTES) {
        return {
            valid: false,
            error: `Le fichier "${file.name}" dépasse la taille maximale autorisée de 15 Mo.`,
        }
    }

    const extension = file.name.includes('.')
        ? file.name.split('.').pop()?.toLowerCase()
        : ''

    if (!extension || !ALLOWED_REPORT_EXTENSIONS.includes(extension)) {
        return {
            valid: false,
            error: `Le format du fichier "${file.name}" n'est pas autorisé. Formats acceptés : PDF, images, Word, Excel, CSV, texte.`,
        }
    }

    return { valid: true }
}

/**
 * Traduit les erreurs Supabase (RPC, RLS, Storage) en messages compréhensibles pour l'utilisateur,
 * tout en conservant le détail technique dans les logs de développement.
 */
export function getFriendlyReportErrorMessage(error: unknown): string {
    if (!error) return 'Une erreur inconnue est survenue.'

    const err = error as {
        message?: string
        code?: string
        details?: string
        hint?: string
    }

    const code = (err.code || '').toUpperCase()
    const msg = (err.message || '')

    // 1. Fonction RPC introuvable (migration non appliquée ou cache non rafraîchi)
    if (
        code === 'PGRST202' ||
        msg.includes('submit_report') ||
        msg.includes('schema cache')
    ) {
        return "Le module de soumission de rapport n'est pas disponible sur le serveur (fonction submit_report introuvable, code PGRST202). Veuillez contacter l'administrateur système pour déployer la migration en base de données."
    }

    // 2. Erreurs métier spécifiques renvoyées par submit_report (Postgres P0001)
    if (msg.includes('NO_MANAGER_FOR_STRUCTURE')) {
        return "Aucun manager actif n'est configuré pour votre structure. Selon les règles de l'établissement, un manager actif doit être affecté à votre structure avant de pouvoir soumettre un rapport. Veuillez contacter un administrateur."
    }

    if (msg.includes('NO_ADMIN_FOUND')) {
        return "Aucun compte administrateur actif n'a été trouvé dans le système pour recevoir ce rapport. Veuillez contacter le support technique."
    }

    if (msg.includes('AUTHOR_ACCOUNT_NOT_ACTIVE')) {
        return 'Votre compte employé n’est pas actif. Seuls les comptes validés et actifs peuvent transmettre des rapports.'
    }

    if (msg.includes('AUTHOR_INACTIVE')) {
        return 'Votre profil employé est désactivé. Veuillez contacter un responsable.'
    }

    if (msg.includes('AUTHOR_NOT_FOUND')) {
        return 'Votre profil employé est introuvable. Veuillez vous reconnecter.'
    }

    if (msg.includes('AUTHOR_HAS_NO_STRUCTURE')) {
        return 'Votre compte n’est associé à aucune structure. Veuillez demander à votre administrateur de vous affecter à une structure.'
    }

    if (msg.includes('AUTHOR_HAS_NO_ROLE')) {
        return 'Aucun rôle n’est attribué à votre profil dans le système. Veuillez contacter l’administrateur.'
    }

    if (msg.includes('INVALID_REPORT_TYPE')) {
        return 'Le type de rapport sélectionné est invalide ou n’existe plus. Veuillez actualiser la page.'
    }

    // 3. Erreurs RLS (Permissions)
    if (code === '42501' || msg.toLowerCase().includes('row-level security')) {
        return 'Accès refusé : vos autorisations actuelles ne permettent pas d’effectuer cette action sur ce rapport.'
    }

    // 4. Erreurs Supabase Storage
    if (msg.toLowerCase().includes('bucket not found')) {
        return "Le dossier de stockage 'reports' est introuvable sur le serveur Supabase. Veuillez contacter l'administrateur."
    }

    if (msg.toLowerCase().includes('failed to fetch')) {
        return 'Erreur réseau : impossible de joindre le serveur Supabase. Vérifiez votre connexion internet.'
    }

    return msg || 'Une erreur inattendue est survenue lors de l’opération.'
}
