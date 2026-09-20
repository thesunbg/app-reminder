/* eslint-env serviceworker */
/**
 * Được workbox nạp vào service worker qua importScripts (xem vite.config.ts).
 * Phải để ở public/ và là JS thuần — file này không đi qua bundler.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_) {
    payload = { title: 'Family Hub', body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Family Hub', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // cùng tag thì thông báo sau thay thế thông báo trước, không xếp chồng
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      lang: 'vi',
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // đã mở app rồi thì đưa tab đó lên thay vì mở thêm tab mới
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
