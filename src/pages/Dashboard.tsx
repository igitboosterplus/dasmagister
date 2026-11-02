import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { redirect, useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { role, profile, isRhManager } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (role) {
      if (isRhManager) {
        navigate('/dashboard/manager', { replace: true });
      } else {
        navigate('/dashboard/' + role, { replace: true });
      }
    }
  }, [role, isRhManager, navigate]);

  return <></>;
}


