const fs = require('fs');
let code = fs.readFileSync('src/pages/Attendance.tsx', 'utf8');

// Replacement 1: init
code = code.replace(
    `    const init = async () => {
      if (profile) {
        let siteId = profile.site_id;
        if (!siteId) {
          const { data: sites } = await supabase
            .from('sites')
            .select('id')
            .eq('structure_id', profile.structure_id)
            .eq('is_active', true)
            .limit(1);
          if (sites && sites.length > 0) siteId = sites[0].id;
        }
        if (siteId) await loadSiteAndSchedule(siteId);
        await loadAttendance();
      }
      setPendingCount(readQueue().length);
      setLoading(false);
    };`,
    `    const init = async () => {
      if (profile) {
        let siteId = null;
        const { data: esData } = await supabase
          .from('employee_sites')
          .select('site_id')
          .eq('employee_id', profile.id)
          .eq('is_active', true)
          .order('assigned_at', { ascending: false })
          .limit(1);

        if (esData && esData.length > 0) {
          siteId = esData[0].site_id;
        }

        if (!siteId) {
          const { data: sites } = await supabase
            .from('sites')
            .select('id')
            .eq('structure_id', profile.structure_id)
            .eq('is_active', true)
            .limit(1);
          if (sites && sites.length > 0) siteId = sites[0].id;
        }
        if (siteId) await loadSiteAndSchedule(siteId);
        await loadAttendance();
      }
      setPendingCount(readQueue().length);
      setLoading(false);
    };`
);

// Replacement 2: handleClockIn (the query part)
const clockInOld = `    const { data, error } = await supabase
      .from('attendances')
      .insert({
        employee_id: profile.id,
        site_id: site.id,
        attendance_date: today,
        check_in: nowIso,
        check_in_latitude: position?.coords.latitude ?? null,
        check_in_longitude: position?.coords.longitude ?? null,
        check_in_accuracy_m: position?.coords.accuracy ?? null,
        check_in_distance_m: distance,
        validation_method: position ? 'gps' : 'manual',
        validation_status: validationStatus,
        client_timestamp: nowIso,
        synced_at: nowIso,
      })
      .select()
      .single();

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      setTodayRecord(data as AttendanceRecord);
      toast({
        title: validationStatus === 'out_of_zone' ? '⚠️ Arrivée hors zone' : '✅ Arrivée enregistrée',
        description: \`Pointage à \${format(now, 'HH:mm')}\${late ? ' — en retard' : ''}\`,
        variant: validationStatus === 'out_of_zone' ? 'destructive' : undefined,
      });
    }`;

const clockInNew = `    const { data: attendanceId, error } = await supabase.rpc('clock_in', {
      p_latitude: position?.coords.latitude || null,
      p_longitude: position?.coords.longitude || null,
      p_accuracy: position?.coords.accuracy || null,
      p_client_event_id: crypto.randomUUID(),
      p_device_recorded_at: nowIso,
    });

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else if (attendanceId) {
      const { data: newRecord } = await supabase.from('attendances').select('*').eq('id', attendanceId).single();
      setTodayRecord(newRecord as AttendanceRecord);
      const resultingStatus = newRecord?.validation_status || validationStatus;
      toast({
        title: resultingStatus === 'out_of_zone' ? '⚠️ Arrivée hors zone' : '✅ Arrivée enregistrée',
        description: \`Pointage à \${format(now, 'HH:mm')}\${newRecord?.validation_status === 'late' ? ' — en retard' : ''}\`,
        variant: resultingStatus === 'out_of_zone' ? 'destructive' : undefined,
      });
    }`;
code = code.replace(clockInOld, clockInNew);

// Replacement 3: handleClockOut
const clockOutOld = `    const { error } = await supabase
      .from('attendances')
      .update({
        check_out: nowIso,
        check_out_latitude: position?.coords.latitude ?? null,
        check_out_longitude: position?.coords.longitude ?? null,
        check_out_accuracy_m: position?.coords.accuracy ?? null,
        check_out_distance_m: distance,
        client_timestamp: nowIso,
        synced_at: nowIso,
      })
      .eq('id', todayRecord.id);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      setTodayRecord({ ...todayRecord, check_out: nowIso });
      toast({ title: '👋 Départ enregistré', description: \`À \${format(now, 'HH:mm')}\` });
    }`;

const clockOutNew = `    const { data: attendanceId, error } = await supabase.rpc('clock_out', {
      p_latitude: position?.coords.latitude || null,
      p_longitude: position?.coords.longitude || null,
      p_accuracy: position?.coords.accuracy || null,
      p_client_event_id: crypto.randomUUID(),
      p_device_recorded_at: nowIso,
    });

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      const { data: newRecord } = await supabase.from('attendances').select('*').eq('id', todayRecord.id).single();
      if (newRecord) setTodayRecord(newRecord as AttendanceRecord);
      toast({ title: '👋 Départ enregistré', description: \`À \${format(now, 'HH:mm')}\` });
    }`;
code = code.replace(clockOutOld, clockOutNew);

// Replacement 4: syncPendingQueue
const syncOld = `        if (action.type === 'check_in') {
          const { data, error } = await supabase
            .from('attendances')
            .insert({
              employee_id: action.employee_id,
              site_id: action.site_id,
              attendance_date: action.attendance_date,
              check_in: action.timestamp,
              check_in_latitude: action.latitude,
              check_in_longitude: action.longitude,
              check_in_accuracy_m: action.accuracy_m,
              validation_method: 'offline',
              validation_status: 'pending_review',
              client_timestamp: action.timestamp,
              synced_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (error) throw error;

          // Résout les check_out liés qui attendaient cet id
          queue = queue.map((a) =>
            a.linked_check_in_local_id === action.localId
              ? { ...a, attendance_id: data.id }
              : a
          );
          queue = queue.filter((a) => a.localId !== action.localId);
        } else {
          if (!action.attendance_id) continue; // check_in lié pas encore synchronisé, on réessaiera au prochain passage
          const { error } = await supabase
            .from('attendances')
            .update({
              check_out: action.timestamp,
              check_out_latitude: action.latitude,
              check_out_longitude: action.longitude,
              check_out_accuracy_m: action.accuracy_m,
              validation_method: 'offline',
              synced_at: new Date().toISOString(),
            })
            .eq('id', action.attendance_id);

          if (error) throw error;
          queue = queue.filter((a) => a.localId !== action.localId);
        }`;

const syncNew = `        const { data, error } = await supabase.rpc('sync_offline_attendance', {
          p_event_type: action.type,
          p_latitude: action.latitude || null,
          p_longitude: action.longitude || null,
          p_accuracy: action.accuracy_m || null,
          p_client_event_id: action.localId,
          p_device_recorded_at: action.timestamp,
        });

        if (error) throw error;

        if (action.type === 'check_in') {
          queue = queue.map((a) =>
            a.linked_check_in_local_id === action.localId
              ? { ...a, attendance_id: data as string }
              : a
          );
        }
        queue = queue.filter((a) => a.localId !== action.localId);`;

code = code.replace(syncOld, syncNew);

fs.writeFileSync('src/pages/Attendance.tsx', code);
console.log("Done");
