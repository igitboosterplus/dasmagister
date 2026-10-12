import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const MAX_CONCURRENCY = 10;

// Configuration VAPID
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DeliveryData {
    id: string;
    queue_id: string;
    subscription_id: string;
}

interface EnrichedDelivery extends DeliveryData {
    endpoint: string;
    p256dh: string; // Base64 string directly from DB
    auth: string;   // Base64 string directly from DB
    payload: {
        notification_id: string;
        title: string;
        message: string;
        entity_type: string;
        entity_id: string;
    };
}

serve(async (req) => {
    // 1. Authentification Machine-to-Machine
    const authHeader = req.headers.get('Authorization');
    // Seul le cron pg_net ou un admin autorisé connaissant le SERVICE_ROLE_KEY peut déclencher le worker
    if (!authHeader || !authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
        console.error('Unauthorized invocation attempt');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // 2. Initialisation Supabase Client (bypassed RLS for daemon tasks)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 3. Worker Identity
    const workerId = crypto.randomUUID();
    console.log(`[Worker ${workerId}] Démarrage du claim...`);

    try {
        // 4. Claim atomique des jobs (Limite 50)
        const { data: deliveries, error: claimError } = await supabase
            .rpc('claim_push_deliveries', {
                p_worker_id: workerId,
                p_limit: 50,
            });

        if (claimError) {
            throw new Error(`Claim error: ${claimError.message}`);
        }

        if (!deliveries || deliveries.length === 0) {
            console.log(`[Worker ${workerId}] Aucun job à traiter.`);
            return new Response(JSON.stringify({ claimed: 0 }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        const claimedCount = deliveries.length;
        console.log(`[Worker ${workerId}] ${claimedCount} deliveries réclamées.`);

        // 5. Enrichissement des données groupées via Service Role
        const deliveryIds = deliveries.map((d: any) => d.id);

        const { data: enrichedData, error: enrichmentError } = await supabase
            .from('notification_push_deliveries')
            .select(`
        id,
        queue_id,
        subscription_id,
        queue:notification_push_queue(
          notification_id,
          notification:notifications(title, message, entity_type, entity_id)
        ),
        subscription:push_subscriptions(endpoint, p256dh, auth)
      `)
            .in('id', deliveryIds);

        if (enrichmentError || !enrichedData) {
            throw new Error(`Enrichment error: ${enrichmentError?.message}`);
        }

        // Reconstruction du tableau des tâches
        const tasks: EnrichedDelivery[] = enrichedData.map((row: any) => {
            const endpoint = row.subscription?.endpoint || '';
            const p256dhBase64 = row.subscription?.p256dh || '';
            const authBase64 = row.subscription?.auth || '';

            // Attention à bien extraire au singulier via le destructuring approprié des relations Supabase
            const queueObj = Array.isArray(row.queue) ? row.queue[0] : row.queue;
            const notifData = queueObj?.notification;
            const finalNotif = Array.isArray(notifData) ? notifData[0] : notifData;

            return {
                id: row.id,
                queue_id: row.queue_id,
                subscription_id: row.subscription_id,
                endpoint,
                p256dh: p256dhBase64, // Garder le Base64 original stocké en BDD par le frontend
                auth: authBase64,     // Garder le Base64 original stocké en BDD par le frontend
                payload: {
                    notification_id: queueObj?.notification_id || 'unknown',
                    title: finalNotif?.title || 'Notification',
                    message: finalNotif?.message || '',
                    entity_type: finalNotif?.entity_type || '',
                    entity_id: finalNotif?.entity_id || '',
                }
            };
        });

        // Configuration Web Push
        if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
            webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        } else {
            console.error(`[Worker ${workerId}] Clés VAPID manquantes !`);
        }

        let successCount = 0;
        let failedCount = 0;

        // 6. Concurrence bornée avec chunks (Evite la surcharge CPU/mémoire)
        for (let i = 0; i < tasks.length; i += MAX_CONCURRENCY) {
            const chunk = tasks.slice(i, i + MAX_CONCURRENCY);

            await Promise.all(
                chunk.map(async (task) => {
                    let pushSuccess = false;
                    let is410 = false;
                    let errorMessage = null;

                    if (!task.endpoint || !task.p256dh || !task.auth || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
                        errorMessage = 'Données de subscription ou VAPID manquantes';
                    } else {
                        try {
                            const pushSubForAPI = {
                                endpoint: task.endpoint,
                                keys: {
                                    p256dh: task.p256dh,
                                    auth: task.auth
                                }
                            };

                            await webpush.sendNotification(
                                pushSubForAPI,
                                JSON.stringify(task.payload)
                            );

                            pushSuccess = true;
                        } catch (err: any) {
                            errorMessage = err.message || 'Push failed unknown';
                            const statusCode = err.statusCode;

                            if (statusCode === 404 || statusCode === 410) {
                                is410 = true;
                                console.log(`[Worker ${workerId}] Delivery ${task.id} INVALIDE (410/404)`);
                            } else {
                                console.log(`[Worker ${workerId}] Delivery ${task.id} Retryable error (${statusCode || 'exception'}): ${errorMessage}`);
                            }
                        }
                    }

                    // 7. Résolution immédiate de chaque tâche individuellement
                    // Même en cas d'exception, le Delivery reste associé au worker courant et doit être resolve (pour retry si non 410).
                    try {
                        await supabase.rpc('resolve_push_delivery', {
                            p_delivery_id: task.id,
                            p_worker_id: workerId,
                            p_success: pushSuccess,
                            p_error: errorMessage ? errorMessage.substring(0, 200) : null,
                            p_is_410: is410,
                        });

                        if (pushSuccess) successCount++;
                        else failedCount++;
                    } catch (resolveErr: any) {
                        console.error(`[Worker ${workerId}] FATAL: Impossible de résoudre la delivery ${task.id}`, resolveErr);
                    }
                })
            );
        }

        console.log(`[Worker ${workerId}] Bilan: ${successCount} succès, ${failedCount} échecs`);

        return new Response(JSON.stringify({
            claimed: claimedCount,
            success: successCount,
            failed: failedCount
        }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (err: any) {
        console.error(`[Worker ${workerId}] Erreur inattendue Worker:`, err);
        return new Response(JSON.stringify({ error: err.message || 'Internal Worker Exception' }), { status: 500 });
    }
});
