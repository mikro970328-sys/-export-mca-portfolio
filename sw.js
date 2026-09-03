const CACHE='export-mca-shell-v5';
const CORE=['/logo.png','/admin/pwa.html','/app/pwa.html','/admin/manifest.webmanifest','/app/manifest.webmanifest','/admin/apple-touch-icon.png','/admin/app-icon-192.svg','/admin/app-icon-512.svg'];
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safeCount=value=>Math.max(0,Math.min(999,Number(value)||0));
const safeNotification=data=>{
  const id=UUID_RE.test(String(data?.notificationId||''))?String(data.notificationId):null;
  return {
    id,
    url:id?`/admin/pwa.html?notification=${encodeURIComponent(id)}`:'/admin/pwa.html',
    count:safeCount(data?.unreadCount),
    severity:['warning','critical'].includes(data?.severity)?data.severity:'info'
  };
};

async function setBadge(count){
  try{
    if(typeof self.navigator?.setAppBadge==='function'){
      if(count>0)await self.navigator.setAppBadge(count);
      else if(typeof self.navigator.clearAppBadge==='function')await self.navigator.clearAppBadge();
    }
  }catch{}
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json?.()||{};}catch{}
  const notification=safeNotification(payload);
  event.waitUntil(Promise.all([
    self.registration.showNotification('Export MCA ERP',{
      body:'Tienes una actualización operativa pendiente.',
      icon:'/admin/apple-touch-icon.png',
      badge:'/admin/apple-touch-icon.png',
      tag:notification.id?`export-mca-${notification.id}`:'export-mca-update',
      renotify:false,
      data:{url:notification.url,notificationId:notification.id},
      requireInteraction:notification.severity==='critical'
    }),
    setBadge(notification.count)
  ]));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const notification=safeNotification({notificationId:event.notification.data?.notificationId});
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const target=new URL(notification.url,self.location.origin).href;
    const current=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(current){
      if(typeof current.navigate==='function')await current.navigate(target);
      return current.focus();
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='EXPORT_MCA_BADGE')event.waitUntil(setBadge(safeCount(event.data.count)));
  if(event.data?.type==='EXPORT_MCA_BADGE_CLEAR')event.waitUntil(setBadge(0));
});
