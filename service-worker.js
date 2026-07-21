const CACHE='npi-forms-v23';
const APP_SHELL=['./','./index.html','./css/styles.css?v=17','./js/app.js?v=25','./js/database.js?v=25','./js/excel-reader.js','./js/form-generator.js?v=24','./js/model-change-mapping.js','./js/npi-employees.js','./js/vendor/xlsx.full.min.js','./js/vendor/exceljs.min.js','./js/vendor/supabase-js-2.110.7.umd.js','./data/production-plan.xlsx','./data/employees.xlsx','./data/npi-employees.xlsx?v=13','./templates/New_Model_Material_Delivery_Record_Corporate.xlsx','./templates/Model Change Format_Rev.06 Loss Time Record.xlsx','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.endsWith('/env.js')){event.respondWith(fetch(request,{cache:'no-store'}));return}
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response}).catch(()=>caches.match('./index.html')));
    return;
  }
  if(/\.(?:js|css|xlsx)$/.test(url.pathname)){
    event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}return response}).catch(()=>caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}return response})));
});
