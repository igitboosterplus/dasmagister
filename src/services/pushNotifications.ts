import { supabase } from '@/integrations/supabase/client';

export class PushNotificationService {
    /**
     * Initialise the PushNotificationService and check environment.
     */
    static isSupported(): boolean {
        return 'serviceWorker' in navigator && 'PushManager' in window;
    }

    static urlBase64ToUint8Array(base64String: string) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    static async requestPermission(): Promise<NotificationPermission> {
        if (!this.isSupported()) return 'denied';
        const permission = await Notification.requestPermission();
        return permission;
    }

    static async subscribe(employeeId: string): Promise<boolean> {
        if (!this.isSupported()) return false;

        // Demande au navigateur
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return false;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        // VAPID KEY - Needs frontend environment variable setup later
        // Temporary logic checking for missing environment.
        const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
            console.warn('VITE_VAPID_PUBLIC_KEY is not defined. Push subscription aborted.');
            return false;
        }

        if (!subscription) {
            const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey,
            });
        }

        return await this.saveSubscription(subscription, employeeId);
    }

    static async unsubscribe(): Promise<boolean> {
        if (!this.isSupported()) return false;
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            // Clean DB if it existed matching this endpoint
            await this.removeSubscription(subscription.endpoint);
            await subscription.unsubscribe();
        }
        return true;
    }

    /**
     * Sauvegarder la subscription de manière sécurisée en base.
     */
    private static async saveSubscription(subscription: PushSubscription, employeeId: string): Promise<boolean> {
        try {
            const p256dh = subscription.getKey('p256dh');
            const auth = subscription.getKey('auth');

            if (!p256dh || !auth) throw new Error('Missing keys in subscription');

            const p256dhStr = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dh))));
            const authStr = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(auth))));

            // Insertion propre via Upsert RLS-compliant (Géré sur le device partagé, endpoint = UNIQUE)
            const { error } = await supabase.from('push_subscriptions').upsert(
                {
                    employee_id: employeeId,
                    endpoint: subscription.endpoint,
                    p256dh: p256dhStr,
                    auth: authStr,
                    user_agent: navigator.userAgent,
                    is_active: true,
                    last_used_at: new Date().toISOString(),
                },
                { onConflict: 'endpoint' }
            );

            if (error) {
                console.error('Failed to save push subscription in DB:', error);
                return false;
            }
            return true;
        } catch (e) {
            console.error('Upsert subscription error: ', e);
            return false;
        }
    }

    private static async removeSubscription(endpoint: string): Promise<void> {
        try {
            // RLS handles allowing delete only if employee_id matches current auth implicitly.
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        } catch (err) {
            console.error('Failed to delete subscription on DB', err);
        }
    }
}
