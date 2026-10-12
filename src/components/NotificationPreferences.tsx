import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PushNotificationService } from "@/services/pushNotifications";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

interface UserNotificationPreferences {
    push_enabled: boolean;
    in_app_enabled: boolean;
    missions_enabled: boolean;
    reports_enabled: boolean;
    requests_enabled: boolean;
    attendance_enabled: boolean;
    feedback_enabled: boolean;
}

export function NotificationPreferences() {
    const { profile } = useAuth();
    const [preferences, setPreferences] = useState<UserNotificationPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pushStatus, setPushStatus] = useState<'default' | 'granted' | 'denied'>('default');

    useEffect(() => {
        if (profile?.id) {
            fetchPreferences();
            checkPushStatus();
        }
    }, [profile?.id]);

    const checkPushStatus = () => {
        if ('Notification' in window) {
            setPushStatus(Notification.permission as any);
        }
    };

    const fetchPreferences = async () => {
        try {
            const { data, error } = await supabase
                .from('user_notification_preferences')
                .select('*')
                .eq('employee_id', profile!.id)
                .single();

            if (error && error.code !== 'PGRST116') {
                console.error("Error fetching preferences", error);
            } else if (data) {
                setPreferences(data);
            } else {
                // Defaults if row doesn't exist yet
                setPreferences({
                    push_enabled: false,
                    in_app_enabled: true,
                    missions_enabled: true,
                    reports_enabled: true,
                    requests_enabled: true,
                    attendance_enabled: true,
                    feedback_enabled: true
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const updatePreference = async (key: keyof UserNotificationPreferences, value: boolean) => {
        if (!profile?.id || !preferences) return;

        // Optimistic update
        const newPrefs = { ...preferences, [key]: value };
        setPreferences(newPrefs);
        setSaving(true);

        try {
            const { error } = await supabase
                .from('user_notification_preferences')
                .upsert({
                    employee_id: profile.id,
                    ...newPrefs
                });

            if (error) throw error;

            toast({
                title: "Préférences mises à jour",
                description: "Vos paramètres de notification ont été enregistrés.",
            });
        } catch (e: any) {
            console.error(e);
            // Revert on error
            setPreferences(preferences);
            toast({
                title: "Erreur",
                description: "Impossible d'enregistrer vos paramètres",
                variant: "destructive"
            });
        } finally {
            setSaving(false);
        }
    };

    const handleTogglePush = async () => {
        if (!profile?.id) return;

        if (preferences?.push_enabled) {
            // User is disabling Push
            await PushNotificationService.unsubscribe();
            await updatePreference('push_enabled', false);
            checkPushStatus();

            toast({
                title: "Notifications désactivées",
                description: "Vous ne recevrez plus de notifications Push sur cet appareil.",
            });
        } else {
            // User is enabling Push
            setSaving(true);
            const isSubscribed = await PushNotificationService.subscribe(profile.id);
            setSaving(false);
            checkPushStatus();

            if (isSubscribed) {
                await updatePreference('push_enabled', true);
                toast({
                    title: "Notifications activées !",
                    description: "Votre appareil est prêt à recevoir des alertes.",
                });
            } else {
                toast({
                    title: "Permission refusée",
                    description: "Veuillez autoriser les notifications dans les paramètres de votre navigateur.",
                    variant: "destructive"
                });
            }
        }
    };

    if (loading) return <Loader2 className="h-4 w-4 animate-spin" />;

    const isPushDisabledOnBrowser = pushStatus === 'denied';

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                        <Bell className="h-5 w-5" /> Centre de Notifications
                    </CardTitle>
                    <CardDescription>Gérez vos préférences d'alertes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Push Global Switch */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-muted/40 rounded-lg gap-4">
                        <div>
                            <h4 className="font-semibold text-sm">Notifications Push (Appareil Actif)</h4>
                            <p className="text-sm text-muted-foreground">
                                Recevez des alertes directement sur votre écran, même si l'application est fermée.
                            </p>
                            {isPushDisabledOnBrowser && (
                                <p className="text-xs text-destructive mt-1">
                                    Votre navigateur bloque actuellement les notifications. Vous devez d'abord les autoriser via le cadenas de l'URL.
                                </p>
                            )}
                        </div>
                        <Button
                            variant={preferences?.push_enabled ? "destructive" : "default"}
                            onClick={handleTogglePush}
                            disabled={saving}
                            className="w-full sm:w-auto shrink-0"
                        >
                            {preferences?.push_enabled ? (
                                <><BellOff className="mr-2 h-4 w-4" /> Désactiver</>
                            ) : (
                                <><Bell className="mr-2 h-4 w-4" /> Activer les alertes</>
                            )}
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-medium text-sm border-b pb-2">Catégories de messages</h4>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="missions-toggle" className="cursor-pointer">
                                <span className="block font-medium">Missions</span>
                                <span className="block text-sm text-muted-foreground font-normal">Assignations, modifications et annulations de missions</span>
                            </Label>
                            <Switch
                                id="missions-toggle"
                                checked={preferences?.missions_enabled}
                                onCheckedChange={(c) => updatePreference('missions_enabled', c)}
                                disabled={saving}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="reports-toggle" className="cursor-pointer">
                                <span className="block font-medium">Rapports</span>
                                <span className="block text-sm text-muted-foreground font-normal">Retours et approbations de rapports</span>
                            </Label>
                            <Switch
                                id="reports-toggle"
                                checked={preferences?.reports_enabled}
                                onCheckedChange={(c) => updatePreference('reports_enabled', c)}
                                disabled={saving}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="requests-toggle" className="cursor-pointer">
                                <span className="block font-medium">Absences</span>
                                <span className="block text-sm text-muted-foreground font-normal">Statut de vos demandes de congés/absences</span>
                            </Label>
                            <Switch
                                id="requests-toggle"
                                checked={preferences?.requests_enabled}
                                onCheckedChange={(c) => updatePreference('requests_enabled', c)}
                                disabled={saving}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
