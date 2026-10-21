import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Loader2 } from 'lucide-react'

export default function ReportsRedirect() {
    const { user, role, loading } = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        if (!loading && user && role) {
            if (role === 'admin') {
                navigate('/reports/admin', { replace: true })
            } else if (role === 'manager') {
                navigate('/reports/manager', { replace: true })
            } else if (role === 'employee') {
                navigate('/reports/employer', { replace: true })
            } else {
                navigate('/dashboard', { replace: true })
            }
        }
    }, [loading, user, role, navigate])

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    )
}
