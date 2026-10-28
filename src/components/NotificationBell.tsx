import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Bell,
  CheckCircle2,
  UserPlus,
  XCircle,
  Clock,
  Check,
  Loader2,
  Inbox,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export default function NotificationBell() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_employee_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      const list = (data || []) as NotificationItem[];
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.is_read).length);
    } catch (err: any) {
      console.error('Erreur chargement notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchNotifications();

    if (!profile?.id) return;

    // Nom de canal unique par instance pour éviter tout conflit (ex: affichage bureau + mobile ou re-rendu)
    const uniqueId = Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(`notifs-${profile.id}-${uniqueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${profile.id}`,
        },
        (payload) => {
          const newNotif = payload.new as NotificationItem;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((c) => c + 1);

          // Alerte Toast instantanée
          toast({
            title: newNotif.title,
            description: newNotif.message,
            duration: 6000,
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${profile.id}`,
        },
        (payload) => {
          const updated = payload.new as NotificationItem;
          setNotifications((prev) => {
            const next = prev.map((n) => (n.id === updated.id ? updated : n));
            setUnreadCount(next.filter((n) => !n.is_read).length);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      setActionLoading(id);
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      console.error('Erreur markAsRead:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const markAllAsRead = async () => {
    if (!profile?.id || unreadCount === 0) return;
    try {
      setActionLoading('all');
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('recipient_employee_id', profile.id)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      toast({
        title: 'Toutes les notifications marquées comme lues',
      });
    } catch (err: any) {
      console.error('Erreur markAllAsRead:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      await markAsRead(notif.id);
    }

    setOpen(false);

    // Redirection contextuelle selon le type
    if (notif.type === 'new_registration') {
      navigate('/dashboard/manager');
    } else if (
      notif.type === 'registration_approved' ||
      notif.type === 'registration_rejected'
    ) {
      navigate('/profile');
    } else if (notif.entity_type === 'mission') {
      navigate('/dashboard/manager');
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'new_registration':
        return <UserPlus className="h-4 w-4 text-amber-500" />;
      case 'registration_approved':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'registration_rejected':
        return <XCircle className="h-4 w-4 text-rose-500" />;
      case 'mission_assigned':
      case 'mission_completed':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      default:
        return <Bell className="h-4 w-4 text-primary" />;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      return formatDistanceToNow(parseISO(isoString), {
        addSuffix: true,
        locale: fr,
      });
    } catch {
      return 'récemment';
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Centre de notifications"
          className="relative p-2 rounded-full border border-border/80 bg-card hover:bg-muted/70 hover:border-primary/40 transition-all text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-background animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 shadow-xl border-border/80 bg-card/95 backdrop-blur-md rounded-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">Notifications</span>
            {unreadCount > 0 ? (
              <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0.5 bg-primary/10 text-primary">
                {unreadCount} non lue{unreadCount > 1 ? 's' : ''}
              </Badge>
            ) : null}
          </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={actionLoading === 'all'}
              onClick={markAllAsRead}
              className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              {actionLoading === 'all' ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Check className="h-3 w-3 mr-1 text-primary" />
              )}
              Tout marquer comme lu
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[380px] divide-y divide-border/40">
          {loading && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
              <p className="text-xs">Chargement des alertes...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">Aucune notification</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                Vous serez alerté ici des inscriptions, validations et activités importantes.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`group relative flex items-start gap-3 p-3.5 transition-colors cursor-pointer hover:bg-muted/60 ${
                    !notif.is_read ? 'bg-primary/[0.04]' : 'bg-transparent opacity-85 hover:opacity-100'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-card border border-border/60 shadow-xs shrink-0 mt-0.5">
                    {renderIcon(notif.type)}
                  </div>

                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-start justify-between gap-1">
                      <h4
                        className={`text-xs font-semibold leading-tight line-clamp-1 ${
                          !notif.is_read ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {notif.title}
                      </h4>
                      {!notif.is_read && (
                        <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                      )}
                    </div>

                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">
                      {notif.message}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1">
                      <span className="text-[10px] text-muted-foreground/75 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(notif.created_at)}
                      </span>

                      {!notif.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notif.id);
                          }}
                          disabled={actionLoading === notif.id}
                          className="text-[10px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                        >
                          {actionLoading === notif.id ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Check className="h-2.5 w-2.5" />
                          )}
                          Marquer lu
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <div className="p-2 border-t border-border/60 bg-muted/20 text-center">
            <p className="text-[10px] text-muted-foreground">
              Notifications en temps réel synchronisées
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
