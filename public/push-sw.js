self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const payload = event.data.json();

        const title = payload.title || 'Nouvelle notification';
        const message = payload.message || '';
        const tag = payload.notification_id || 'default-tag';

        const options = {
            body: message,
            icon: '/pwa-192x192.png',
            tag: tag, // Web Push Idempotency / Collapse
            data: {
                url: buildUrlFromEntity(payload.entity_type, payload.entity_id),
                notification_id: payload.notification_id,
            },
        };

        event.waitUntil(self.registration.showNotification(title, options));
    } catch (error) {
        console.error('Erreur lors du traitement du push', error);
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Reuse existing window if available
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    // If we want to navigate to the exact tab
                    // client.navigate(urlToOpen); -- Optional if we strictly want to change route
                    return client.focus();
                }
            }

            // Fallback: Open new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});

function buildUrlFromEntity(entityType, entityId) {
    if (!entityType) return '/dashboard';

    switch (entityType) {
        case 'mission':
            return '/dashboard/employee';
        case 'report':
            return '/reports/employer';
        case 'employee_absence':
            return '/manager/attendance';
        case 'attendance':
            return '/attendance';
        default:
            return '/dashboard';
    }
}
