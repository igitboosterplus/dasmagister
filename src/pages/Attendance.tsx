import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface AttendanceRecord {
  id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
}

export default function Attendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (profile) {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
          .from('attendances')
          .select('*')
          .eq('employee_id', profile.id)
          .eq('attendance_date', today)
          .single();
          
        if (data) setTodayRecord(data);

        // History
        const { data: histData } = await supabase
          .from('attendances')
          .select('*')
          .eq('employee_id', profile.id)
          .order('attendance_date', { ascending: false })
          .limit(30);
        if (histData) setHistory(histData);
      }

      setLoading(false);
    };

    init();
  }, [profile]);

  const handleClockIn = async () => {
    if (!profile) return;
    setSubmitting(true);

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    // Default site if employee doesn't have a site_id
    let siteId = profile.site_id;
    if (!siteId) {
      // Find a default site based on structure, or just the first site
      const { data: sites } = await supabase.from('sites').select('id').eq('structure_id', profile.structure_id).limit(1);
      if (sites && sites.length > 0) {
        siteId = sites[0].id;
      }
    }

    if (!siteId) {
      toast({ title: 'Erreur', description: 'Aucun site attribué pour ce pointage.', variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    const { data, error } = await supabase
      .from('attendances')
      .insert({
        employee_id: profile.id,
        site_id: siteId,
        attendance_date: today,
        check_in: now,
      })
      .select()
      .single();

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      setTodayRecord(data);
      toast({
        title: '✅ Arrivée enregistrée',
        description: `Pointage à ${format(new Date(now), 'HH:mm')}`,
      });
    }
    setSubmitting(false);
  };

  const handleClockOut = async () => {
    if (!todayRecord) return;
    setSubmitting(true);
    
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('attendances')
      .update({ check_out: now })
      .eq('id', todayRecord.id);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      setTodayRecord({ ...todayRecord, check_out: now });
      toast({ title: '👋 Départ enregistré', description: `À ${format(new Date(now), 'HH:mm')}` });
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in">
        <h1 className="page-title mb-6">Pointage</h1>

        {/* Clock In/Out Card */}
        <Card className="stat-card mb-8 max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Aujourd'hui — {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!todayRecord ? (
              <div>
                <p className="text-sm text-muted-foreground mb-4">Vous n'avez pas encore pointé aujourd'hui.</p>
                <Button
                  onClick={handleClockIn}
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
                  Marquer mon arrivée
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Arrivée</span>
                  <span className="font-medium">{todayRecord.check_in ? format(new Date(todayRecord.check_in), 'HH:mm') : '—'}</span>
                </div>
                {todayRecord.check_out ? (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Départ</span>
                    <span className="font-medium">{format(new Date(todayRecord.check_out), 'HH:mm')}</span>
                  </div>
                ) : (
                  <Button onClick={handleClockOut} variant="outline" disabled={submitting} className="w-full mt-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
                    Marquer mon départ
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* History */}
        <h2 className="font-display text-lg font-semibold mb-4">Historique récent</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="table-header px-4 py-3 text-left">Date</th>
                  <th className="table-header px-4 py-3 text-left">Arrivée</th>
                  <th className="table-header px-4 py-3 text-left">Départ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm">
                      {format(new Date(record.attendance_date), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {record.check_in ? format(new Date(record.check_in), 'HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {record.check_out ? format(new Date(record.check_out), 'HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      Aucun historique de pointage
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

