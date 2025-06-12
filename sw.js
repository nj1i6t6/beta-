const CACHE_NAME = 'ai-multitool-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './main-style.css',
  './manifest.json',
  './icons/ai_camera_translate.png',

  // 語音翻譯的資源
  './voice-translator/index.html',
  './voice-translator/script.js',
  './voice-translator/style.css',
  './voice-translator/audio-processor.js',

  // 圖像辨識的資源
  './image-translator/index.html',

  // 外部函式庫
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://esm.run/@google/genai' // 語音翻譯用的
];

// --- 以下的 Service Worker 邏輯與您原本的 sw.js 相同，無需更改 ---

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
      .catch(error => {
        console.error('Service Worker: Failed to cache during install:', error);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            return response;
          }
          return fetch(event.request);
        })
    );
  } else {
    return fetch(event.request);
  }
});