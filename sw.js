const CACHE_NAME = 'image-optimizer-v19';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './styles.css',
    './js/main.js',
    './js/dom.js',
    './js/state.js',
    './js/constants.js',
    './js/utils.js',
    './js/formats.js',
    './js/optimize.js',
    './js/ui.js',
    './js/upload.js',
    './js/comparison.js',
    './js/worker-fast.js',

    // WASM Encoder Core + Dependencies
    './js/vendor/jsquash-avif/encode.js',
    './js/vendor/jsquash-avif/meta.js',
    './js/vendor/jsquash-avif/utils.js',
    './js/vendor/jsquash-avif/codec/enc/avif_enc.js',
    './js/vendor/jsquash-avif/codec/enc/avif_enc.wasm',
    './js/vendor/jsquash-avif/codec/enc/avif_enc_mt.js',
    './js/vendor/jsquash-avif/codec/enc/avif_enc_mt.wasm',
    './js/vendor/jsquash-avif/codec/enc/avif_enc_mt.worker.mjs',

    './js/vendor/jsquash-jxl/encode.js',
    './js/vendor/jsquash-jxl/meta.js',
    './js/vendor/jsquash-jxl/utils.js',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc.js',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc.wasm',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt.js',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt.wasm',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt.worker.js',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt_simd.js',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt_simd.wasm',
    './js/vendor/jsquash-jxl/codec/enc/jxl_enc_mt_simd.worker.js',

    './js/vendor/wasm-feature-detect/dist/esm/index.js',

    './animations-enhancement.css',
    './hero-styles.css',
    './progress-modal.css',
    './progress-modal.js',
    './success-modal.css',
    './success-modal.js',
    './notifications.css',
    './notifications.js',
    './benefits-trust.css',
    './trust-elements.js',
    './comparison-modal.css',
    './assets/logo.png',
    './assets/hero-graphic.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js'
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching files');
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('[Service Worker] Some assets failed to cache, skipping those:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Clearing old cache');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Determine if it's a local asset or external CDN
    const isLocal = url.origin === self.location.origin;

    if (isLocal) {
        // Network First Strategy for local assets to ensure they are always up to date
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request).then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;
                        // For navigation, fallback to index.html
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                    });
                })
        );
    } else {
        // Cache First Strategy for external CDN assets
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;

                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // Nothing in cache and no network
                    return null;
                });
            })
        );
    }
});
