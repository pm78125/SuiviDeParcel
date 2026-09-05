import { supabase, supabaseUrl, supabaseKey, BUCKET_NAME, FILE_NAME } from './lib/supabase.js';
import { onConnectivityChange, cacheSnapshot, loadSnapshot, isOnline } from './lib/offline.js';
import { showToast, confirmAction } from './lib/utils.js';

let tousLesArbres = [];
let toutesLesCategories = [];
let toutesLesProvenances = [];
let tousLesSuivisGlobaux = [];
let arbreSelectionne = null;
let modeAjout = false;
let vueCourante = 'plan';

let growthChartInstance = null;
let chartCatInstance = null;
let chartSanteInstance = null;
let chartRecoltesInstance = null;

window.baseMapWidth = 800;
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function assertOnline(action = 'cette action') {
    if (!isOnline()) {
        showToast('Hors ligne : impossible — ' + action, 'danger');
        return false;
    }
    return true;
}

function showLoader(show) {
    const el = document.getElementById('app-loader');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

window.ouvrirSidebar = function() {
    document.getElementById('sidebar').classList.add('open');
    const ov = document.getElementById('sidebar-overlay');
    ov.classList.add('show');
    ov.classList.remove('hidden');
}
window.fermerSidebar = function() {
    document.getElementById('sidebar').classList.remove('open');
    const ov = document.getElementById('sidebar-overlay');
    ov.classList.remove('show');
    ov.classList.add('hidden');
}

window.ouvrirLightbox = function(url) {
    if (!url) return;
    document.getElementById('lightbox-img').src = url;
    document.getElementById('lightbox').classList.remove('hidden');
}

window.fermerLightbox = function() {
    const lb = document.getElementById('lightbox');
    lb.classList.add('hidden');
    document.getElementById('lightbox-img').src = '';
}

window.clearTooltip = function() {
    document.getElementById('hover-tooltip').classList.add('hidden');
}

function positionnerTooltip(marker) {
    const tooltip = document.getElementById('hover-tooltip');
    const rect = marker.getBoundingClientRect();
    const tipW = tooltip.offsetWidth || 216;
    const tipH = tooltip.offsetHeight || 220;
    const gap = 14;
    let left = rect.left + rect.width / 2;
    let top = rect.top - gap;

    // Garde la carte dans le viewport
    const half = tipW / 2;
    left = Math.max(half + 8, Math.min(left, window.innerWidth - half - 8));
    if (top - tipH < 8) {
        // Pas assez de place au-dessus → sous le marqueur
        top = rect.bottom + tipH + gap;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = 'translate(-50%, -100%)';
}

function afficherTooltipArbre(arbre, marker) {
    const tooltip = document.getElementById('hover-tooltip');
    const img = document.getElementById('tooltip-img');
    const fallback = document.getElementById('tooltip-img-fallback');
    if (arbre.image_url) {
        img.src = arbre.image_url;
        img.classList.remove('is-empty');
        fallback.classList.remove('is-visible');
    } else {
        img.removeAttribute('src');
        img.classList.add('is-empty');
        fallback.classList.add('is-visible');
    }

    document.getElementById('tooltip-text').textContent = arbre.espece || 'Inconnue';
    document.getElementById('tooltip-sante').innerHTML =
        `${getSanteDot(arbre.sante)}<span>${escapeHtml(getSanteLabel(arbre.sante))}</span>`;

    const metaBits = [];
    if (arbre.categorie) metaBits.push(arbre.categorie);
    if (arbre.taille_actuelle_brute) metaBits.push(arbre.taille_actuelle_brute);
    document.getElementById('tooltip-sub').textContent = metaBits.join(' · ');

    const recolteEl = document.getElementById('tooltip-recolte');
    recolteEl.textContent = arbre.recolte_totale > 0 ? `${arbre.recolte_totale} kg récoltés` : '';

    tooltip.classList.remove('hidden');
    positionnerTooltip(marker);
}

function isModalOpen(el) {
    return el && !el.classList.contains('hidden');
}

function fermerModaleOuverte() {
    if (isModalOpen(document.getElementById('confirm-modal'))) return false; // géré par confirmAction
    if (isModalOpen(document.getElementById('lightbox'))) {
        fermerLightbox();
        return true;
    }
    if (isModalOpen(document.getElementById('modal-categorie'))) {
        fermerModalCategorie();
        return true;
    }
    if (isModalOpen(document.getElementById('modal-provenance'))) {
        fermerModalProvenance();
        return true;
    }
    if (isModalOpen(document.getElementById('modal-gestion-categories'))) {
        fermerGestionCategories();
        return true;
    }
    if (isModalOpen(document.getElementById('suivi-modal'))) {
        fermerFormulaireSuivi();
        return true;
    }
    if (isModalOpen(document.getElementById('arbre-modal'))) {
        fermerModalArbre();
        return true;
    }
    if (document.getElementById('sidebar').classList.contains('open')) {
        fermerSidebar();
        return true;
    }
    return false;
}

function initModalsDismiss() {
    document.querySelectorAll('[data-modal-dismiss]').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target !== overlay) return;
            const fnName = overlay.getAttribute('data-modal-dismiss');
            const fn = window[fnName];
            if (typeof fn === 'function') fn();
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (fermerModaleOuverte()) e.preventDefault();
    });
}

function parseTailleToCm(val) {
    if (!val) return null;
    let s = val.toString().toLowerCase().replace(/,/g, '.').trim();
    let match;
    if (s.includes('m') && !s.includes('cm')) {
        match = s.match(/([0-9.,]+)\s*m\s*([0-9]*)/);
        if (match) {
            let m = parseFloat(match[1]) || 0;
            let cm = parseInt(match[2]) || 0;
            if (s.includes('.') || s.includes(',')) return Math.round(m * 100);
            return (m * 100) + cm;
        }
    } else {
        match = s.match(/([0-9.,]+)/);
        if (match) return parseFloat(match[1]);
    }
    return null;
}

/** Pipeline photo Samsung S20 — cloner immédiatement (proxy galerie), puis compresser. */

function friendlyPhotoError(err) {
    const m = String(err?.message || err || '');
    if (/failed to fetch|networkerror|network error|load failed|erreur de réseau/i.test(m)) {
        return 'Envoi interrompu — réessayez (vérifiez la connexion)';
    }
    if (/notreadable|file.?changed|permission|vide|lecture/i.test(m)) {
        return 'Fichier inaccessible — ouvrez-le via Fichiers (pas Galerie cloud), ou prenez la photo avec l’appareil';
    }
    if (/heic|heif|décodage|dimensions|compression|image|illisible/i.test(m)) {
        return 'Format non lu — dans Réglages caméra, désactivez HEIF / « Haute efficacité », ou prenez un JPEG';
    }
    return m || 'Impossible d’envoyer la photo';
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isHeicMagic(buffer) {
    if (!buffer || buffer.byteLength < 12) return false;
    const u = new Uint8Array(buffer.slice(0, Math.min(64, buffer.byteLength)));
    const ascii = String.fromCharCode(...u);
    // Conteneur HEIF/HEIC Samsung (souvent 1816×4032 « Haute efficacité »)
    return /ftyp/i.test(ascii) && /heic|heif|mif1|msf1|heim|heis|hevx/i.test(ascii);
}

function looksLikeHeic(file, buffer) {
    const type = (file?.type || '').toLowerCase();
    const name = (file?.name || '').toLowerCase();
    if (type.includes('heic') || type.includes('heif')) return true;
    if (/\.heic$|\.heif$/i.test(name)) return true;
    return !!(buffer && isHeicMagic(buffer));
}

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Décodage image impossible'));
        img.src = url;
    });
}

function preloadHeicConverter() {
    if (typeof window === 'undefined') return;
    if (window.heic2any || document.querySelector('script[data-heic2any]')) return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    s.async = true;
    s.dataset.heic2any = '1';
    document.head.appendChild(s);
}

async function ensureHeicConverter() {
    if (window.heic2any) return window.heic2any;
    preloadHeicConverter();
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
        if (window.heic2any) return window.heic2any;
        await sleep(120);
    }
    throw new Error('Chargement convertisseur HEIC impossible');
}

/** S20 / anciens Samsung : proxy Galerie + HEIC + peu de RAM → pipeline plus prudent. */
function isConstrainedPhotoDevice() {
    try {
        if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
    } catch (_) { /* ok */ }
    const ua = navigator.userAgent || '';
    if (/SM-G98[0-9]|SM-G991|SM-G780|SM-G781/i.test(ua)) return true; // S20 / S20 FE
    if (/Android/i.test(ua) && /Samsung|SM-/i.test(ua) && /Android ([5-9]|1[0-2])\b/i.test(ua)) {
        return true;
    }
    return false;
}

async function canvasToJpegBlob(canvas, quality) {
    const blob = await new Promise((resolve) => {
        if (!canvas.toBlob) {
            resolve(null);
            return;
        }
        canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (blob && blob.size) return blob;

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const parts = dataUrl.split(',');
    const bin = atob(parts[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const out = new Blob([bytes], { type: 'image/jpeg' });
    if (!out.size) throw new Error('Export JPEG vide');
    return out;
}

/**
 * Critique Samsung/Chrome : lire le File tout de suite dans un Blob mémoire,
 * sinon le proxy Galerie devient NotReadableError / ERR_UPLOAD_FILE_CHANGED.
 */
async function materializePhoto(file) {
    if (!file) throw new Error('Aucune photo');

    let buffer = null;
    let lastErr = null;

    const tryRead = async () => {
        try {
            const buf = await file.arrayBuffer();
            if (buf && buf.byteLength) return buf;
        } catch (e) {
            lastErr = e;
        }
        try {
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const r = reader.result;
                    if (r && r.byteLength) resolve(r);
                    else reject(new Error('Lecture photo vide'));
                };
                reader.onerror = () => reject(reader.error || new Error('Impossible de lire la photo'));
                reader.readAsArrayBuffer(file);
            });
        } catch (e) {
            lastErr = e;
            return null;
        }
    };

    // 1) Lecture immédiate — ne pas attendre (sinon Chrome Android invalide le proxy)
    if (file.size > 0) {
        buffer = await tryRead();
    }

    // 2) Taille 0 / lecture ratée : courtes retries (téléchargement cloud galerie)
    if (!buffer || !buffer.byteLength) {
        let lastSize = file.size || 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 3000) {
            await sleep(100);
            const s = file.size || 0;
            if (s > 0 && (s === lastSize || Date.now() - t0 > 400)) {
                buffer = await tryRead();
                if (buffer && buffer.byteLength) break;
            }
            lastSize = s;
        }
    }

    if (!buffer || !buffer.byteLength) {
        if (file.size > 0) return file;
        throw lastErr || new Error('Photo vide — attendez la fin du chargement dans la galerie');
    }

    let type = (file.type && file.type !== 'application/octet-stream') ? file.type : '';
    if (!type || type === 'application/octet-stream') {
        if (isHeicMagic(buffer)) type = 'image/heic';
        else if (buffer.byteLength >= 2) {
            const u = new Uint8Array(buffer);
            if (u[0] === 0xFF && u[1] === 0xD8) type = 'image/jpeg';
            else if (u[0] === 0x89 && u[1] === 0x50) type = 'image/png';
            else type = 'image/jpeg';
        } else {
            type = 'image/jpeg';
        }
    }

    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    try {
        const out = new File([buffer], `${name}.bin`, { type, lastModified: Date.now() });
        out._buffer = buffer;
        return out;
    } catch (_) {
        const out = new Blob([buffer], { type });
        out._buffer = buffer;
        out.name = `${name}.bin`;
        return out;
    }
}

async function convertHeicToJpeg(blob) {
    const buffer = blob._buffer || null;
    if (!looksLikeHeic(blob, buffer)) return blob;

    if (typeof setArbreSaveStatus === 'function') {
        setArbreSaveStatus('Conversion HEIC → JPEG…', 'is-saving');
    }

    const heic2any = await ensureHeicConverter();
    // Qualité d’abord ; descentes seulement si OOM S20
    const qualities = [0.82, 0.7, 0.55, 0.4];
    let lastErr = null;

    for (const quality of qualities) {
        try {
            const result = await heic2any({
                blob,
                toType: 'image/jpeg',
                quality,
            });
            const jpeg = Array.isArray(result) ? result[0] : result;
            if (jpeg?.size) {
                try { delete blob._buffer; } catch (_) { /* ok */ }
                return new Blob([jpeg], { type: 'image/jpeg' });
            }
        } catch (e) {
            lastErr = e;
            console.warn('heic2any q=' + quality, e);
            await sleep(80);
        }
    }

    console.warn('heic2any failed', lastErr);
    throw new Error('HEIC — passez la caméra en JPEG (Réglages → Formats d’image)');
}

async function decodePhotoDrawable(file, decodeMaxSide = 1600) {
    if (!file) throw new Error('Aucune photo');
    const maxSide = decodeMaxSide;
    const errors = [];
    // Gros HEIC/JPEG (ex. 1816×4032) : décoder déjà réduit (bonne qualité, pas d’OOM)
    const preferResizeFirst = isConstrainedPhotoDevice() || (file.size || 0) > 700_000;

    const tryBitmap = async () => {
        if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap indisponible');
        const attempts = [
            { imageOrientation: 'from-image', resizeHeight: maxSide, resizeQuality: 'high' },
            { imageOrientation: 'from-image', resizeWidth: maxSide, resizeQuality: 'high' },
            { imageOrientation: 'from-image', resizeHeight: maxSide, resizeQuality: 'medium' },
            { imageOrientation: 'from-image', resizeWidth: maxSide, resizeQuality: 'medium' },
            { resizeHeight: maxSide, resizeQuality: 'low' },
            { resizeWidth: maxSide, resizeQuality: 'low' },
            { imageOrientation: 'from-image' },
        ];
        let lastErr = null;
        for (const opts of attempts) {
            try {
                const bmp = await createImageBitmap(file, opts);
                if (bmp?.width && bmp?.height) {
                    return {
                        drawable: bmp,
                        width: bmp.width,
                        height: bmp.height,
                        release: () => { try { bmp.close?.(); } catch (_) { /* ok */ } },
                    };
                }
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('createImageBitmap échoué');
    };

    const tryImage = async () => {
        const objectUrl = URL.createObjectURL(file);
        try {
            const img = await loadImageFromUrl(objectUrl);
            if (img.decode) {
                try { await img.decode(); } catch (_) { /* ok */ }
            }
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (width && height) {
                return {
                    drawable: img,
                    width,
                    height,
                    release: () => URL.revokeObjectURL(objectUrl),
                };
            }
            throw new Error('Image sans dimensions');
        } catch (e) {
            URL.revokeObjectURL(objectUrl);
            throw e;
        }
    };

    const order = preferResizeFirst ? [tryBitmap, tryImage] : [tryImage, tryBitmap];
    for (const fn of order) {
        try {
            return await fn();
        } catch (e) {
            errors.push(e);
        }
    }

    console.warn('decodePhotoDrawable', errors);
    throw new Error('Décodage image impossible');
}

async function compressImage(file, maxSize = 1600, quality = 0.84) {
    if (!file) throw new Error('Aucune photo');

    const decoded = await decodePhotoDrawable(file, Math.max(maxSize, 1400));
    try {
        const { drawable, width: srcW, height: srcH } = decoded;
        if (!srcW || !srcH) throw new Error('Image sans dimensions');

        const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));
        const qualities = [quality, Math.max(0.55, quality - 0.1), Math.max(0.45, quality - 0.2)];
        let lastErr = null;

        for (const q of qualities) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) throw new Error('canvas indisponible');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(drawable, 0, 0, width, height);
                const out = await canvasToJpegBlob(canvas, q);
                if (out?.size) return out;
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('Compression impossible');
    } finally {
        decoded.release?.();
    }
}

/**
 * Qualité normale (~1600 px). `urgent` = recompression seulement après échec réseau.
 */
async function preparePhotoForUpload(file, { urgent = false } = {}) {
    if (!file) throw new Error('Aucune photo');

    if (
        !urgent
        && file.size > 0
        && file.size <= 1_800_000
        && (file.type === 'image/jpeg' || file.type === 'image/jpg')
    ) {
        return file;
    }

    // Recompression d’un JPEG déjà en mémoire (après échec upload)
    if (urgent && (file.type === 'image/jpeg' || file.type === 'image/jpg') && file.size > 0) {
        return compressImage(file, 1000, 0.68);
    }

    const local = await materializePhoto(file);
    const normalized = await convertHeicToJpeg(local);

    // Bonne qualité d’abord (identique S20 / S26 / iPhone)
    let compressed = await compressImage(normalized, 1600, 0.84);
    if (compressed.size > 1_900_000) {
        compressed = await compressImage(normalized, 1400, 0.78);
    }
    if (compressed.size > 1_900_000) {
        compressed = await compressImage(normalized, 1200, 0.72);
    }
    if (!compressed?.size) throw new Error('Compression impossible');
    return compressed;
}

function isTransientUploadError(err) {
    const m = String(err?.message || err?.error || err || '');
    return /failed to fetch|networkerror|network error|load failed|timeout|timed out|503|502|504|429|abort/i.test(m);
}

/** Repli XHR si fetch() tombe en « Failed to fetch » sur Chrome Android. */
function uploadPhotoViaXhr(fileName, payload, contentType) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `${supabaseUrl}/storage/v1/object/photos/${encodeURIComponent(fileName)}`;
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${supabaseKey}`);
        xhr.setRequestHeader('apikey', supabaseKey);
        xhr.setRequestHeader('Content-Type', contentType || 'image/jpeg');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', '3600');
        xhr.timeout = 90000;
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
            }
            let msg = `HTTP ${xhr.status}`;
            try {
                const j = JSON.parse(xhr.responseText);
                msg = j.message || j.error || msg;
            } catch (_) {
                if (xhr.responseText) msg = xhr.responseText.slice(0, 160);
            }
            reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error('Failed to fetch'));
        xhr.ontimeout = () => reject(new Error('timeout'));
        xhr.send(payload);
    });
}

async function uploadPhotoPayload(payload, prefix) {
    const contentType = 'image/jpeg';
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const fileName = `${prefix}_${Date.now()}_${attempt}_${Math.floor(Math.random() * 1000)}.jpg`;
        try {
            if (attempt > 1 && typeof setArbreSaveStatus === 'function') {
                setArbreSaveStatus(`Nouvel essai d’envoi (${attempt}/3)…`, 'is-saving');
            }
            try {
                const { error } = await supabase.storage.from('photos').upload(fileName, payload, {
                    cacheControl: '3600',
                    contentType,
                    upsert: false,
                });
                if (error) throw error;
            } catch (fetchErr) {
                if (!isTransientUploadError(fetchErr)) throw fetchErr;
                await uploadPhotoViaXhr(fileName, payload, contentType);
            }
            return supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
        } catch (e) {
            console.error('uploadPhoto attempt', attempt, e);
            lastErr = e;
            if (!isTransientUploadError(e) || attempt === 3) break;
            await sleep(500 * attempt);
        }
    }
    throw lastErr || new Error('Envoi impossible');
}

async function uploadPhoto(file, prefix) {
    let payload = file;
    const readyJpeg = !!(
        file
        && file.size > 0
        && file.size <= 1_800_000
        && (file.type === 'image/jpeg' || file.type === 'image/jpg')
    );
    if (!readyJpeg) {
        payload = await preparePhotoForUpload(file);
    }
    // Plafond doux — sans écraser en 512px
    if (payload.size > 2_200_000) {
        payload = await compressImage(payload, 1400, 0.76);
    }

    try {
        return await uploadPhotoPayload(payload, prefix);
    } catch (e) {
        if (!isTransientUploadError(e)) throw new Error(friendlyPhotoError(e));
        // Seulement si le réseau échoue : qualité réduite, pas par défaut
        if (typeof setArbreSaveStatus === 'function') {
            setArbreSaveStatus('Réseau fragile — nouvel essai…', 'is-saving');
        }
        try {
            const smaller = await preparePhotoForUpload(payload, { urgent: true });
            return await uploadPhotoPayload(smaller, prefix);
        } catch (e2) {
            throw new Error(friendlyPhotoError(e2));
        }
    }
}

// --- ZOOM / ROTATION ---
const ZOOM_MIN = 40;
/** Facteur par clic +/- : même sensation à 80 % ou à 2000 %. */
const ZOOM_BTN_FACTOR = 1.25;

let zoomLevel = parseInt(localStorage.getItem('mapZoom'), 10);
if (!Number.isFinite(zoomLevel) || zoomLevel < ZOOM_MIN || zoomLevel > 25000) zoomLevel = 100;
let rotationDeg = parseInt(localStorage.getItem('mapRotation'), 10);
if (!Number.isFinite(rotationDeg)) rotationDeg = 0;

function persistMapView() {
    try {
        localStorage.setItem('mapZoom', String(Math.round(zoomLevel)));
        localStorage.setItem('mapRotation', String(rotationDeg));
    } catch (_) { /* private mode / quota */ }
}

/** Zoom max : ~4× la densité native du plan (assez pour inspecter). */
function maxZoomLevel() {
    const img = document.getElementById('map-image');
    const base = Number(window.baseMapWidth) || 800;
    if (img?.naturalWidth > 0 && base > 0) {
        const oneToOne = (img.naturalWidth / base) * 100;
        return Math.min(8000, Math.max(400, Math.round(oneToOne * 4)));
    }
    return 2000;
}

function applyZoom(nextLevel, { clientX = null, clientY = null, persist = true } = {}) {
    const area = document.getElementById('map-scroll-area');
    const wrapper = document.getElementById('map-content-wrapper');
    if (!wrapper) return;

    const maxZ = maxZoomLevel();
    const next = Math.max(ZOOM_MIN, Math.min(maxZ, Number(nextLevel) || 100));
    if (!Number.isFinite(next) || Math.abs(next - zoomLevel) < 0.05) {
        updateZoomControlsUi();
        return;
    }

    let ox = 0;
    let oy = 0;
    let contentX = 0;
    let contentY = 0;
    let oldW = 1;
    let oldH = 1;
    if (area) {
        const rect = area.getBoundingClientRect();
        ox = clientX != null ? (clientX - rect.left) : area.clientWidth / 2;
        oy = clientY != null ? (clientY - rect.top) : area.clientHeight / 2;
        oldW = Math.max(area.scrollWidth, 1);
        oldH = Math.max(area.scrollHeight, 1);
        contentX = area.scrollLeft + ox;
        contentY = area.scrollTop + oy;
    }

    zoomLevel = next;
    if (persist) persistMapView();
    appliquerTransformations();

    if (area) {
        const newW = Math.max(area.scrollWidth, 1);
        const newH = Math.max(area.scrollHeight, 1);
        area.scrollLeft = contentX * (newW / oldW) - ox;
        area.scrollTop = contentY * (newH / oldH) - oy;
    }
}

function updateZoomControlsUi() {
    const maxZ = maxZoomLevel();
    const z = Math.round(Number(zoomLevel) || 100);
    const label = document.getElementById('zoom-level-label');
    if (label) label.textContent = `${z} %`;

    const btnIn = document.querySelector('#map-controls [data-map-action="zoom-in"]');
    const btnOut = document.querySelector('#map-controls [data-map-action="zoom-out"]');
    const btnFit = document.querySelector('#map-controls [data-map-action="zoom-fit"]');
    if (btnIn) {
        btnIn.disabled = z >= maxZ - 0.5;
        btnIn.title = `Zoom + (${z} %)`;
    }
    if (btnOut) {
        btnOut.disabled = z <= ZOOM_MIN + 0.5;
        btnOut.title = `Zoom − (${z} %)`;
    }
    if (btnFit) {
        btnFit.disabled = Math.abs(z - 100) < 1;
        btnFit.title = 'Ajuster le plan à l’écran';
    }
}

window.changerZoom = function(delta) {
    if (typeof delta === 'number' && Number.isFinite(delta) && Math.abs(delta) !== 1) {
        applyZoom(zoomLevel + delta);
        return;
    }
    applyZoom(delta < 0 ? zoomLevel / ZOOM_BTN_FACTOR : zoomLevel * ZOOM_BTN_FACTOR);
};
window.zoomIn = function() { applyZoom(zoomLevel * ZOOM_BTN_FACTOR); };
window.zoomOut = function() { applyZoom(zoomLevel / ZOOM_BTN_FACTOR); };

/** Recalcule la largeur « plein écran » du plan (fit contain). */
function recalculateBaseMapWidth() {
    const img = document.getElementById('map-image');
    const area = document.getElementById('map-scroll-area');
    if (!img?.naturalWidth || !area) return false;
    const areaW = Math.max(area.clientWidth - 8, 100);
    const areaH = Math.max(area.clientHeight - 8, 100);
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const areaRatio = areaW / areaH;
    if (imgRatio > areaRatio) window.baseMapWidth = areaW;
    else window.baseMapWidth = areaH * imgRatio;
    return true;
}

function centerMapInViewport() {
    const area = document.getElementById('map-scroll-area');
    if (!area) return;
    requestAnimationFrame(() => {
        area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
        area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
    });
}

/** Revient à 100 % : plan qui occupe tout l’espace visible. */
window.zoomFit = function() {
    if (!recalculateBaseMapWidth()) return;
    if (Math.abs(zoomLevel - 100) < 0.05) {
        appliquerTransformations();
        centerMapInViewport();
        return;
    }
    applyZoom(100);
    centerMapInViewport();
};

window.changerRotation = function(delta) {
    rotationDeg += delta;
    persistMapView();
    appliquerTransformations();
};

function appliquerTransformations() {
    const wrapper = document.getElementById('map-content-wrapper');
    const img = document.getElementById('map-image');
    if (!wrapper) return;
    const base = Number(window.baseMapWidth) || 800;
    const z = Number.isFinite(zoomLevel) ? zoomLevel : 100;
    const newWidth = Math.max(40, base * (z / 100));
    wrapper.style.width = `${newWidth}px`;
    wrapper.style.minWidth = `${newWidth}px`;
    wrapper.style.maxWidth = 'none';
    wrapper.style.flexShrink = '0';
    if (img) {
        img.style.width = '100%';
        img.style.maxWidth = 'none';
        img.style.height = 'auto';
    }
    wrapper.style.transform = `rotate(${rotationDeg}deg)`;
    updateZoomControlsUi();
}

function setZoomLevel(level, { persist = true, anchorClientX = null, anchorClientY = null } = {}) {
    applyZoom(level, {
        clientX: anchorClientX,
        clientY: anchorClientY,
        persist,
    });
}

function bindMapControlButtons() {
    const root = document.getElementById('map-controls');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const run = (action) => {
        if (action === 'zoom-in') window.zoomIn();
        else if (action === 'zoom-out') window.zoomOut();
        else if (action === 'zoom-fit') window.zoomFit();
        else if (action === 'rotate') window.changerRotation(90);
    };

    root.querySelectorAll('[data-map-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            run(btn.getAttribute('data-map-action'));
        });
    });

    // Empêche le pan de la carte d’avaler le geste sur les contrôles
    root.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
    });
}

// --- PAN (souris + tactile) + PLACEMENT ARBRE ---
const scrollArea = document.getElementById('map-scroll-area');
const mapImage = document.getElementById('map-image');
let isDownMap = false, startMapX, startMapY, scrollLeft, scrollTop, hasDraggedMap = false;
let mapPointerStart = null;
let placedThisGesture = false;
let pinchStartDist = 0;
let pinchStartZoom = 100;

function coordsOnMap(e, img) {
    const rect = img.getBoundingClientRect();
    // Compense la rotation CSS du wrapper pour retrouver la position sur l'image
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const rad = -rotationDeg * (Math.PI / 180);
    const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
    // Utiliser la taille affichée (même espace que localX/Y). Zoom = largeur CSS, OK.
    // En rotation, on se base sur offsetWidth/Height (boîte locale non tournée).
    const w = img.offsetWidth || rect.width;
    const h = img.offsetHeight || rect.height;
    if (!w || !h) return { x: NaN, y: NaN };
    const x = ((localX + w / 2) / w) * 100;
    const y = ((localY + h / 2) / h) * 100;
    return {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
    };
}

function placerNouvelArbre(e) {
    if (!modeAjout) return;
    if (hasDraggedMap) return;
    if (!mapImage || mapImage.classList.contains('hidden')) return;
    if (e.target.classList.contains('tree-marker') || e.target.closest('.tree-marker')) return;

    const { x, y } = coordsOnMap(e, mapImage);
    clearTooltip();
    desactiverModeAjout();
    ouvrirModalArbre({ x_percent: x, y_percent: y, sante: 'Bonne' });
}

scrollArea.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.target.classList.contains('tree-marker')) return;
    if (e.target.closest('#empty-map-state')) return;
    if (e.target.closest('#map-controls') || e.target.closest('#add-mode-hint')) return;

    mapPointerStart = { x: e.clientX, y: e.clientY };
    hasDraggedMap = false;
    placedThisGesture = false;

    // Mode ajout / placement repères : pas de pan (évite setPointerCapture qui casse le clic)
    if (modeAjout) {
        isDownMap = false;
        return;
    }

    isDownMap = true;
    scrollArea.classList.add('is-dragging');
    startMapX = e.clientX;
    startMapY = e.clientY;
    scrollLeft = scrollArea.scrollLeft;
    scrollTop = scrollArea.scrollTop;
    try { scrollArea.setPointerCapture(e.pointerId); } catch (_) {}
});

scrollArea.addEventListener('pointermove', (e) => {
    // Ne marquer un drag que pendant un vrai pan (pas en mode placement)
    if (isDownMap && mapPointerStart) {
        const dx = e.clientX - mapPointerStart.x;
        const dy = e.clientY - mapPointerStart.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDraggedMap = true;
    }

    if (!isDownMap) return;
    if (hasDraggedMap) e.preventDefault();
    const walkX = e.clientX - startMapX;
    const walkY = e.clientY - startMapY;
    if (hasDraggedMap) {
        scrollArea.scrollLeft = scrollLeft - walkX;
        scrollArea.scrollTop = scrollTop - walkY;
    }
});

function endMapPointer(e) {
    const wasDragging = hasDraggedMap;
    const inPick = modeAjout;
    isDownMap = false;
    scrollArea.classList.remove('is-dragging');
    mapPointerStart = null;

    if (!inPick || wasDragging || placedThisGesture) return;
    if (!e || typeof e.clientX !== 'number') return;
    if (mapImage.classList.contains('hidden')) return;

    placedThisGesture = true;
    placerNouvelArbre(e);
}

scrollArea.addEventListener('pointerup', endMapPointer);
scrollArea.addEventListener('pointercancel', () => {
    isDownMap = false;
    hasDraggedMap = false;
    mapPointerStart = null;
    scrollArea.classList.remove('is-dragging');
});

// Pinch-to-zoom mobile
function touchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}
scrollArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        isDownMap = false;
        hasDraggedMap = true;
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = zoomLevel;
    }
}, { passive: true });
scrollArea.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchStartDist) return;
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    const ratio = dist / pinchStartDist;
    setZoomLevel(pinchStartZoom * ratio, { persist: false });
}, { passive: false });
scrollArea.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        if (pinchStartDist) persistMapView();
        pinchStartDist = 0;
    }
}, { passive: true });

// Molette : zoom vers le curseur (pratique sur ordinateur)
scrollArea.addEventListener('wheel', (e) => {
    if (mapImage.classList.contains('hidden')) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoomLevel(zoomLevel * factor, {
        persist: true,
        anchorClientX: e.clientX,
        anchorClientY: e.clientY,
    });
}, { passive: false });

// Fallback souris si le navigateur n'a pas livré le placement au pointerup
mapImage.addEventListener('click', function(e) {
    if (!modeAjout || hasDraggedMap || placedThisGesture) return;
    placedThisGesture = true;
    e.stopPropagation();
    placerNouvelArbre(e);
});
document.getElementById('map-content-wrapper')?.addEventListener('click', function(e) {
    if (!modeAjout || hasDraggedMap || placedThisGesture) return;
    if (e.target.closest('button')) return;
    placedThisGesture = true;
    placerNouvelArbre(e);
});

// --- MODE AJOUT ---
window.toggleModeAjout = function() {
    modeAjout = !modeAjout;
    const btn = document.getElementById('btn-add-mode');
    const hint = document.getElementById('add-mode-hint');
    const wrapper = document.getElementById('map-content-wrapper');
    const addLabel = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn-label">Ajouter un arbre</span>';
    const cancelLabel = '<span class="btn-label">Annuler</span>';
    if (modeAjout) {
        if (btn) {
            btn.classList.add('is-cancel');
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-ghost');
            btn.innerHTML = cancelLabel;
        }
        hint?.classList.add('show');
        hint?.classList.remove('hidden');
        wrapper?.classList.add('add-mode');
        showToast('Cliquez sur le plan pour placer un arbre');
    } else {
        if (btn) {
            btn.classList.remove('is-cancel');
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-ghost');
            btn.innerHTML = addLabel;
        }
        hint?.classList.remove('show');
        hint?.classList.add('hidden');
        wrapper?.classList.remove('add-mode');
    }
}

window.ouvrirChoixAjoutArbre = function() { window.toggleModeAjout(); }
function desactiverModeAjout() { if (modeAjout) toggleModeAjout(); }

// --- DRAG MARQUEURS ---
// Souris : drag immédiat. Tactile : appui long (~0,4 s) pour déplacer, sinon pan / ouverture fiche.
const MARKER_LONG_PRESS_MS = 420;
const MARKER_PAN_SLOP_PX = 10;

let isDraggingMarker = false;
let markerHasMoved = false;
let currentDragMarker = null;
let currentDragArbre = null;
let startClientX, startClientY, startXPercent, startYPercent, startMapW, startMapH;
let markerLongPressTimer = null;
let markerPressPending = null;

function isTouchLikePointer(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
}

function clearMarkerLongPress() {
    if (markerLongPressTimer) {
        clearTimeout(markerLongPressTimer);
        markerLongPressTimer = null;
    }
    markerPressPending = null;
}

function beginMarkerDragSession(e, arbre, marker) {
    isDraggingMarker = true;
    markerHasMoved = false;
    currentDragMarker = marker;
    currentDragArbre = arbre;
    marker.classList.add('is-dragging-marker', 'is-lifting');
    clearTooltip();
    startClientX = e.clientX;
    startClientY = e.clientY;
    startXPercent = arbre.x_percent;
    startYPercent = arbre.y_percent;
    const img = document.getElementById('map-image');
    startMapW = img.offsetWidth;
    startMapH = img.offsetHeight;
    try { marker.setPointerCapture(e.pointerId); } catch (_) {}
    try { navigator.vibrate?.(25); } catch (_) {}
}

function handOffMarkerToMapPan(e) {
    const pending = markerPressPending;
    clearMarkerLongPress();
    isDraggingMarker = false;
    markerHasMoved = false;
    currentDragMarker = null;
    currentDragArbre = null;

    if (pending?.marker) {
        try { pending.marker.releasePointerCapture(pending.pointerId); } catch (_) {}
    }

    if (modeAjout) return;

    isDownMap = true;
    hasDraggedMap = true;
    mapPointerStart = { x: e.clientX, y: e.clientY };
    startMapX = e.clientX;
    startMapY = e.clientY;
    scrollLeft = scrollArea.scrollLeft;
    scrollTop = scrollArea.scrollTop;
    scrollArea.classList.add('is-dragging');
    try { scrollArea.setPointerCapture(e.pointerId); } catch (_) {}
}

window.initMarkerDrag = function(e, arbre, marker) {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();

    if (isTouchLikePointer(e)) {
        // Pas de drag immédiat : appui long requis. Capture pour suivre le doigt hors du point.
        clearMarkerLongPress();
        markerPressPending = {
            arbre,
            marker,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
        };
        try { marker.setPointerCapture(e.pointerId); } catch (_) {}
        markerLongPressTimer = setTimeout(() => {
            const pending = markerPressPending;
            if (!pending || pending.marker !== marker) return;
            markerLongPressTimer = null;
            markerPressPending = null;
            beginMarkerDragSession(
                { clientX: pending.startX, clientY: pending.startY, pointerId: pending.pointerId },
                pending.arbre,
                pending.marker
            );
        }, MARKER_LONG_PRESS_MS);
        return;
    }

    e.preventDefault();
    clearMarkerLongPress();
    beginMarkerDragSession(e, arbre, marker);
};

window.onMarkerDrag = function(e) {
    if (markerPressPending && !isDraggingMarker) {
        const dx = e.clientX - markerPressPending.startX;
        const dy = e.clientY - markerPressPending.startY;
        if (Math.abs(dx) > MARKER_PAN_SLOP_PX || Math.abs(dy) > MARKER_PAN_SLOP_PX) {
            handOffMarkerToMapPan(e);
        }
        return;
    }

    if (!isDraggingMarker || !currentDragMarker) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;

    if (!markerHasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        markerHasMoved = true;
        clearTooltip();
        currentDragMarker.classList.add('is-lifting');
        currentDragMarker.style.zIndex = '50';
    }

    if (markerHasMoved) {
        const rad = -rotationDeg * (Math.PI / 180);
        const rotatedDx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const rotatedDy = dx * Math.sin(rad) + dy * Math.cos(rad);
        let newX = startXPercent + (rotatedDx / startMapW) * 100;
        let newY = startYPercent + (rotatedDy / startMapH) * 100;
        if (isNaN(newX) || isNaN(newY)) return;
        newX = Math.max(0, Math.min(100, newX));
        newY = Math.max(0, Math.min(100, newY));
        currentDragMarker.style.left = `${newX}%`;
        currentDragMarker.style.top = `${newY}%`;
        currentDragArbre.temp_x = newX;
        currentDragArbre.temp_y = newY;
    }
};

window.stopMarkerDrag = async function(e) {
    // Tap court sur tactile → ouvrir la fiche (pas de déplacement)
    if (markerPressPending && !isDraggingMarker) {
        const { arbre, marker, pointerId } = markerPressPending;
        clearMarkerLongPress();
        try { marker.releasePointerCapture(pointerId); } catch (_) {}
        // Coupe le click synthétique Android/iOS sous le doigt
        try { e?.preventDefault?.(); } catch (_) { /* ok */ }
        clearTooltip();
        lastPointerWasTouch = true;
        ouvrirModalArbre(arbre);
        return;
    }

    if (!isDraggingMarker || !currentDragMarker) return;
    const marker = currentDragMarker;
    const arbre = currentDragArbre;
    const moved = markerHasMoved;

    isDraggingMarker = false;
    try { marker.releasePointerCapture(e.pointerId); } catch (_) {}
    marker.classList.remove('is-lifting', 'is-dragging-marker');
    marker.style.zIndex = '';

    currentDragMarker = null;
    currentDragArbre = null;
    markerHasMoved = false;

    if (moved) {
        const newX = arbre.temp_x;
        const newY = arbre.temp_y;
        arbre.x_percent = newX;
        arbre.y_percent = newY;
        const patch = { x_percent: newX, y_percent: newY };
        if (isOnline()) {
            await supabase.from('arbres').update(patch).eq('id', arbre.id);
        }
    } else {
        clearTooltip();
        ouvrirModalArbre(arbre);
    }
};

window.cancelMarkerDrag = function(e) {
    clearMarkerLongPress();
    if (!isDraggingMarker || !currentDragMarker) return;
    isDraggingMarker = false;
    try { currentDragMarker.releasePointerCapture(e.pointerId); } catch (_) {}
    currentDragMarker.classList.remove('is-lifting', 'is-dragging-marker');
    currentDragMarker.style.left = `${startXPercent}%`;
    currentDragMarker.style.top = `${startYPercent}%`;
    currentDragMarker = null;
    currentDragArbre = null;
    markerHasMoved = false;
};

// --- INIT ---
function setOfflineBanner(offline) {
    const el = document.getElementById('offline-banner');
    if (!el) return;
    el.classList.toggle('show', offline);
    el.classList.toggle('hidden', !offline);
}

async function initialiserApp() {
    showLoader(true);
    initModalsDismiss();
    bindMapControlButtons();
    bindArbreAutosave();
    bindPhotoPickers();
    preloadHeicConverter();
    setOfflineBanner(!isOnline());
    onConnectivityChange(async (online) => {
        setOfflineBanner(!online);
        if (online) {
            showToast('Connexion rétablie');
            await fetchCategories();
            await fetchProvenances();
            await fetchArbres();
            await configurerCarte();
        } else {
            showToast('Hors ligne — lecture du cache', 'warn');
        }
    });
    try {
        if (!isOnline()) {
            const snap = loadSnapshot();
            if (snap) {
                toutesLesCategories = snap.categories || [];
                toutesLesProvenances = snap.provenances || [];
                tousLesArbres = snap.arbres || [];
                tousLesSuivisGlobaux = snap.suivis || [];
                majSelectsCategories();
                majSelectsProvenances();
                appliquerFiltres();
                majDashboard();
                showToast('Données locales chargées', 'warn');
            }
        }
        if (isOnline()) {
            await fetchCategories();
            await fetchProvenances();
            await fetchArbres();
        }
        await configurerCarte();
        document.body.dataset.view = 'plan';
    } finally {
        showLoader(false);
    }
}

function setMapEmpty(isEmpty) {
    const img = document.getElementById('map-image');
    const emptyState = document.getElementById('empty-map-state');
    const pad = document.getElementById('map-inner-pad');
    const controls = document.getElementById('map-controls');
    const legend = document.getElementById('map-legend');
    if (isEmpty) {
        img.classList.add('hidden');
        emptyState.classList.add('is-visible');
        emptyState.classList.remove('hidden');
        pad.classList.add('hidden');
        controls.classList.add('hidden');
        legend.classList.add('hidden');
    } else {
        img.classList.remove('hidden');
        emptyState.classList.remove('is-visible');
        emptyState.classList.add('hidden');
        pad.classList.remove('hidden');
        controls.classList.remove('hidden');
    }
}

async function getPlanVersion() {
    try {
        const { data: files, error } = await supabase.storage.from(BUCKET_NAME).list('', { limit: 100 });
        if (error) throw error;
        const file = (files || []).find((f) => f.name === FILE_NAME);
        if (file?.updated_at) return new Date(file.updated_at).getTime();
    } catch (e) {
        console.warn('Version du plan indisponible', e);
    }
    return null;
}

async function configurerCarte(forceReload = false) {
    const img = document.getElementById('map-image');
    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(FILE_NAME);

    let version = forceReload ? Date.now() : await getPlanVersion();
    if (!version) version = Date.now();
    const nextSrc = `${data.publicUrl}?v=${version}`;

    img.onerror = function() { setMapEmpty(true); };
    img.onload = function() {
        setMapEmpty(false);
        recalculateBaseMapWidth();
        zoomLevel = Math.max(ZOOM_MIN, Math.min(maxZoomLevel(), zoomLevel));
        appliquerTransformations();
        appliquerFiltres();
        majLegende();
    };

    const current = img.getAttribute('src') || '';
    if (!forceReload && current === nextSrc && img.complete && img.naturalWidth > 0) {
        img.onload();
        return;
    }
    img.src = nextSrc;
}

window.chargerNouvelleImage = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!assertOnline('changement de plan')) return;
    const btn = document.getElementById('btn-change-map');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '…';
    try {
        const compressed = await compressImage(file, 2400, 0.85);
        const { error } = await supabase.storage.from(BUCKET_NAME).upload(FILE_NAME, compressed, {
            cacheControl: '60',
            upsert: true,
            contentType: 'image/jpeg',
        });
        if (error) throw error;
        await configurerCarte(true);
        showToast('Plan mis à jour');
    } catch (e) {
        console.error(e);
        showToast(e?.message || 'Impossible d’enregistrer le plan', 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
        event.target.value = '';
    }
};

// --- CATEGORIES ---
async function fetchCategories() {
    try {
        const { data, error } = await supabase.from('categories').select('*');
        if (!error) {
            toutesLesCategories = data || [];
            majSelectsCategories();
            majLegende();
        }
    } catch (e) {
        console.error("La table categories n'existe pas encore.");
    }
}

function majSelectsCategories() {
    const formSelect = document.getElementById('form-categorie');
    const filterSelect = document.getElementById('filter-cat');
    const prevForm = formSelect.value;
    const prevFilter = filterSelect.value;
    formSelect.innerHTML = '';
    filterSelect.innerHTML = '';
    formSelect.appendChild(new Option('Aucune', ''));
    filterSelect.appendChild(new Option('Toutes les catégories', 'ALL'));
    toutesLesCategories.forEach(cat => {
        formSelect.appendChild(new Option(cat.nom, cat.nom));
        filterSelect.appendChild(new Option(cat.nom, cat.nom));
    });
    if ([...formSelect.options].some(o => o.value === prevForm)) formSelect.value = prevForm;
    if ([...filterSelect.options].some(o => o.value === prevFilter)) filterSelect.value = prevFilter;
}

function majLegende() {
    // Légende retirée : elle masquait une partie du plan
}

window.fermerModalCategorie = function() {
    document.getElementById('modal-categorie').classList.add('hidden');
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-ancien-nom').value = '';
    document.getElementById('cat-nom').value = '';
    document.getElementById('cat-couleur').value = '#10b981';
}

window.sauvegarderCategorie = async function() {
    const id = document.getElementById('cat-id').value;
    const ancienNom = document.getElementById('cat-ancien-nom').value;
    const nom = document.getElementById('cat-nom').value.trim();
    const couleur = document.getElementById('cat-couleur').value;
    if (!nom) return showToast('Le nom est obligatoire', 'warn');

    const revenirGestion = !!id || document.getElementById('modal-gestion-categories').dataset.reopen === '1';

    try {
        if (id) {
            const { error } = await supabase.from('categories').update({ nom, couleur }).eq('id', id);
            if (error) throw error;
            if (ancienNom && ancienNom !== nom) {
                await supabase.from('arbres').update({ categorie: nom }).eq('categorie', ancienNom);
                await fetchArbres();
            }
        } else {
            const { error } = await supabase.from('categories').insert([{ nom, couleur }]);
            if (error) throw error;
        }
        fermerModalCategorie();
        await fetchCategories();
        document.getElementById('form-categorie').value = nom;
        appliquerFiltres();
        showToast(id ? 'Catégorie mise à jour' : 'Catégorie créée');
        if (revenirGestion) ouvrirGestionCategories();
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de la sauvegarde de la catégorie', 'danger');
    }
}

window.ouvrirGestionCategories = function() {
    fermerSidebar();
    document.getElementById('modal-gestion-categories').dataset.reopen = '1';
    const list = document.getElementById('liste-categories');
    list.innerHTML = '';
    if (!toutesLesCategories.length) {
        list.innerHTML = '<p class="empty-hint">Aucune catégorie.</p>';
    } else {
        toutesLesCategories.forEach(cat => {
            const row = document.createElement('div');
            row.className = 'cat-row';
            const swatch = document.createElement('span');
            swatch.className = 'cat-swatch';
            swatch.style.background = cat.couleur || '#1f6b4f';
            const label = document.createElement('span');
            label.className = 'cat-label';
            label.textContent = cat.nom;
            const actions = document.createElement('div');
            actions.className = 'cat-actions';
            const btnEdit = document.createElement('button');
            btnEdit.type = 'button';
            btnEdit.className = 'btn-text btn-text--ok';
            btnEdit.textContent = 'Modifier';
            btnEdit.addEventListener('click', () => ouvrirFormulaireCategorie(cat));
            const btnDel = document.createElement('button');
            btnDel.type = 'button';
            btnDel.className = 'btn-text btn-text--danger';
            btnDel.textContent = 'Supprimer';
            btnDel.addEventListener('click', () => supprimerCategorie(cat.id, cat.nom));
            actions.append(btnEdit, btnDel);
            row.append(swatch, label, actions);
            list.appendChild(row);
        });
    }
    document.getElementById('modal-gestion-categories').classList.remove('hidden');
}

window.fermerGestionCategories = function() {
    document.getElementById('modal-gestion-categories').classList.add('hidden');
}

window.ouvrirFormulaireCategorie = function(cat = null) {
    const fromGestion = !document.getElementById('modal-gestion-categories').classList.contains('hidden');
    document.getElementById('modal-gestion-categories').classList.add('hidden');
    document.getElementById('modal-gestion-categories').dataset.reopen = fromGestion || cat ? '1' : '0';
    if (cat) {
        document.getElementById('modal-categorie-title').textContent = 'Modifier la catégorie';
        document.getElementById('btn-save-categorie').textContent = 'Enregistrer';
        document.getElementById('cat-id').value = cat.id;
        document.getElementById('cat-ancien-nom').value = cat.nom;
        document.getElementById('cat-nom').value = cat.nom;
        document.getElementById('cat-couleur').value = cat.couleur || '#10b981';
    } else {
        document.getElementById('modal-categorie-title').textContent = 'Nouvelle Catégorie';
        document.getElementById('btn-save-categorie').textContent = 'Créer';
        document.getElementById('cat-id').value = '';
        document.getElementById('cat-ancien-nom').value = '';
        document.getElementById('cat-nom').value = '';
        document.getElementById('cat-couleur').value = '#10b981';
    }
    document.getElementById('modal-categorie').classList.remove('hidden');
}

window.supprimerCategorie = async function(id, nom) {
    const ok = await confirmAction({
        title: 'Supprimer la catégorie',
        message: `Supprimer « ${nom} » ? Les arbres concernés garderont le nom en texte libre.`,
        confirmLabel: 'Supprimer',
        danger: true,
    });
    if (!ok) return;
    await supabase.from('categories').delete().eq('id', id);
    await fetchCategories();
    ouvrirGestionCategories();
    appliquerFiltres();
    showToast('Catégorie supprimée');
}

async function fetchProvenances() {
    try {
        const { data, error } = await supabase.from('provenances').select('*');
        if (!error) {
            toutesLesProvenances = data || [];
            majSelectsProvenances();
        }
    } catch (e) {
        console.error("La table provenances n'existe pas encore.");
    }
}

function majSelectsProvenances() {
    const formSelect = document.getElementById('form-provenance');
    const prev = formSelect.value;
    formSelect.innerHTML = '';
    formSelect.appendChild(new Option('Inconnue', ''));
    toutesLesProvenances.forEach(prov => {
        formSelect.appendChild(new Option(prov.nom, prov.nom));
    });
    if ([...formSelect.options].some(o => o.value === prev)) formSelect.value = prev;
}

window.fermerModalProvenance = function() {
    document.getElementById('modal-provenance').classList.add('hidden');
    document.getElementById('prov-nom').value = '';
}

window.sauvegarderNouvelleProvenance = async function() {
    const nom = document.getElementById('prov-nom').value.trim();
    if (!nom) return showToast('Le nom est obligatoire', 'warn');
    try {
        await supabase.from('provenances').insert([{ nom }]);
        fermerModalProvenance();
        await fetchProvenances();
        document.getElementById('form-provenance').value = nom;
        showToast('Provenance ajoutée');
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de la création de la provenance', 'danger');
    }
}

// --- FETCH ARBRES ---
async function fetchArbres() {
    try {
        const resArbres = await supabase.from('arbres').select('*');
        const resSuivis = await supabase.from('suivi_arbres').select('*').order('date_suivi', { ascending: false });

        if (resArbres.error) {
            console.error(resArbres.error);
            showToast('Erreur de connexion avec la base de données', 'danger');
            return;
        }

        tousLesArbres = resArbres.data || [];
        tousLesSuivisGlobaux = resSuivis.data || [];

        tousLesArbres.forEach(arbre => {
            const mesSuivis = tousLesSuivisGlobaux.filter(s => s.arbre_id === arbre.id);
            arbre.taille_actuelle_brute = mesSuivis.length > 0 && mesSuivis[0].taille ? mesSuivis[0].taille : arbre.taille;

            const initCm = parseTailleToCm(arbre.taille);
            const actCm = parseTailleToCm(arbre.taille_actuelle_brute);
            arbre.croissance_cm = (initCm !== null && actCm !== null && actCm > initCm) ? (actCm - initCm) : 0;

            if (!arbre.sante) arbre.sante = 'Bonne';

            let totalRecolte = 0;
            mesSuivis.forEach(s => { if (s.recolte_kg) totalRecolte += parseFloat(s.recolte_kg); });
            arbre.recolte_totale = totalRecolte;

            const dernier = mesSuivis.length > 0 ? mesSuivis[0] : null;
            arbre.dernier_suivi = dernier ? dernier.date_suivi : null;
            if (arbre.dernier_suivi) {
                const diffMs = Date.now() - new Date(arbre.dernier_suivi).getTime();
                arbre.jours_sans_suivi = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            } else {
                arbre.jours_sans_suivi = 99999;
            }
        });

        cacheSnapshot({
            categories: toutesLesCategories,
            provenances: toutesLesProvenances,
            arbres: tousLesArbres,
            suivis: tousLesSuivisGlobaux
        });
        appliquerFiltres();
        majDashboard();
    } catch (e) {
        console.error(e);
        const snap = loadSnapshot();
        if (snap && !tousLesArbres.length) {
            toutesLesCategories = snap.categories || [];
            toutesLesProvenances = snap.provenances || [];
            tousLesArbres = snap.arbres || [];
            tousLesSuivisGlobaux = snap.suivis || [];
            majSelectsCategories();
            majSelectsProvenances();
            appliquerFiltres();
            majDashboard();
            showToast('Affichage depuis le cache', 'warn');
        }
    }
}

function getArbresFiltres() {
    const fCat = document.getElementById('filter-cat').value;
    const fSante = document.getElementById('filter-sante').value;
    const fSearch = document.getElementById('filter-search').value.toLowerCase();

    return tousLesArbres.filter(a => {
        const matchCat = fCat === 'ALL' || a.categorie === fCat;
        const matchSante = fSante === 'ALL' || a.sante === fSante;
        const matchSearch = !fSearch || (a.espece && a.espece.toLowerCase().includes(fSearch));
        return matchCat && matchSante && matchSearch;
    });
}

window.appliquerFiltres = function() {
    const arbresFiltres = getArbresFiltres();
    document.getElementById('filter-count').textContent =
        `${arbresFiltres.length} / ${tousLesArbres.length} arbre${tousLesArbres.length > 1 ? 's' : ''}`;
    afficherMarqueurs(arbresFiltres);
    afficherTableau(arbresFiltres);
}

function getSanteLabel(sante) {
    if (sante === 'Bonne') return 'Bonne';
    if (sante === 'Moyenne') return 'Moyenne';
    if (sante === 'Malade') return 'Malade';
    if (sante === 'Mort') return 'Mort';
    return 'Bonne';
}

function getSanteDot(sante) {
    const colors = { Bonne: 'dot-ok', Moyenne: 'dot-mid', Malade: 'dot-bad', Mort: 'dot-dead' };
    return `<span class="dot ${colors[sante] || colors.Bonne}"></span>`;
}

function afficherMarqueurs(arbresList = tousLesArbres) {
    clearTooltip();
    const container = document.getElementById('map-content-wrapper');
    document.querySelectorAll('.tree-marker').forEach(e => e.remove());

    arbresList.forEach(arbre => {
        if (arbre.x_percent !== null && !isNaN(arbre.x_percent) && arbre.y_percent !== null && !isNaN(arbre.y_percent)) {
            const marker = document.createElement('div');
            marker.className = 'tree-marker';

            const catObj = toutesLesCategories.find(c => c.nom === arbre.categorie);
            if (catObj) {
                marker.style.background = `linear-gradient(135deg, ${catObj.couleur} 0%, #00000030 100%)`;
                marker.style.backgroundColor = catObj.couleur;
            }

            if (arbre.sante === 'Malade') marker.classList.add('marker-malade');
            if (arbre.sante === 'Mort') marker.classList.add('marker-mort');

            marker.setAttribute('data-id', arbre.id);
            marker.setAttribute('aria-label', arbre.espece || 'Arbre');
            if (arbreSelectionne && arbreSelectionne.id === arbre.id) marker.classList.add('active');
            marker.style.left = `${arbre.x_percent}%`;
            marker.style.top = `${arbre.y_percent}%`;

            marker.addEventListener('pointerdown', (e) => initMarkerDrag(e, arbre, marker));
            marker.addEventListener('pointermove', onMarkerDrag);
            marker.addEventListener('pointerup', stopMarkerDrag);
            marker.addEventListener('pointercancel', cancelMarkerDrag);

            marker.onmouseenter = () => {
                if (isDraggingMarker) return;
                afficherTooltipArbre(arbre, marker);
            };
            marker.onmouseleave = () => { clearTooltip(); };
            container.appendChild(marker);
        }
    });
}

let sortCol = null;
let sortAsc = true;
window.trierTableau = function(col) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = true; }
    tousLesArbres.sort((a, b) => {
        let valA = a[col] || '';
        let valB = b[col] || '';
        if (col === 'date_plantation' || col === 'dernier_suivi') {
            valA = valA ? new Date(valA).getTime() : 0;
            valB = valB ? new Date(valB).getTime() : 0;
        } else if (col === 'croissance_cm' || col === 'recolte_totale' || col === 'jours_sans_suivi') {
            valA = valA || 0;
            valB = valB || 0;
        } else {
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
        }
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });
    appliquerFiltres();
}

function afficherTableau(arbresList) {
    const tbody = document.getElementById('table-body');
    const cards = document.getElementById('inventory-cards');
    tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';

    if (arbresList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="padding:2rem;text-align:center;color:var(--ink-soft)">Aucun arbre trouvé.</td></tr>';
        if (cards) cards.innerHTML = '<p class="empty-hint empty-hint--box">Aucun arbre trouvé.</p>';
        return;
    }

    const frag = document.createDocumentFragment();
    const cardsFrag = document.createDocumentFragment();

    arbresList.forEach(arbre => {
        const tr = document.createElement('tr');
        tr.onclick = (e) => { if (e.target.tagName !== 'IMG') ouvrirModalArbre(arbre); };

        const dateFormatee = arbre.date_plantation ? new Date(arbre.date_plantation).toLocaleDateString('fr-FR') : '-';
        const safeUrl = arbre.image_url ? escapeHtml(arbre.image_url) : '';
        const photoHtml = arbre.image_url
            ? `<img src="${safeUrl}" alt="" class="thumb" loading="lazy" width="40" height="40" onclick="ouvrirLightbox('${safeUrl}')">`
            : `<div class="thumb-empty">N/A</div>`;

        let evolutionHtml = '-';
        if (arbre.croissance_cm > 0) {
            evolutionHtml = `<span class="pill pill-ok">+ ${arbre.croissance_cm} cm</span>`;
        }

        const catBadge = arbre.categorie
            ? `<span class="pill">${escapeHtml(arbre.categorie)}</span>`
            : '-';
        const provBadge = arbre.provenance
            ? `<span style="color:var(--ink-soft);font-size:0.8rem">${escapeHtml(arbre.provenance)}</span>`
            : '-';
        const santeBadge = `${getSanteDot(arbre.sante)}${escapeHtml(getSanteLabel(arbre.sante))}`;
        const recolteHtml = arbre.recolte_totale > 0
            ? `<span class="pill pill-harvest">${arbre.recolte_totale} kg</span>`
            : '-';

        let suiviHtml = '<span style="color:#94a3b8;font-size:0.75rem">Jamais</span>';
        if (arbre.dernier_suivi) {
            const dateSuivi = new Date(arbre.dernier_suivi).toLocaleDateString('fr-FR');
            const jours = arbre.jours_sans_suivi === 99999 ? '' : ` · ${arbre.jours_sans_suivi} j`;
            suiviHtml = `<span style="color:var(--ink-soft);font-size:0.75rem">${dateSuivi}${jours}</span>`;
        }

        tr.innerHTML = `
            <td class="col-photo" onclick="event.stopPropagation()">${photoHtml}</td>
            <td style="font-weight:700;color:var(--forest-deep)">${escapeHtml(arbre.espece || 'Inconnue')}</td>
            <td>${catBadge}</td>
            <td>${provBadge}</td>
            <td>${santeBadge}</td>
            <td style="color:var(--ink-soft)">${dateFormatee}</td>
            <td>${suiviHtml}</td>
            <td style="font-weight:600;color:var(--moss)">${escapeHtml(arbre.taille_actuelle_brute || '-')}</td>
            <td>${evolutionHtml}</td>
            <td>${recolteHtml}</td>
            <td style="color:var(--ink-soft);max-width:150px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(arbre.notes || '-')}</td>
        `;
        frag.appendChild(tr);

        if (cards) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'inv-card';
            card.addEventListener('click', () => ouvrirModalArbre(arbre));
            const photoCard = arbre.image_url
                ? `<img src="${safeUrl}" alt="" class="inv-card-photo" loading="lazy">`
                : `<div class="inv-card-photo inv-card-photo--empty" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3c.5 3 2 5 4 6.5C18.5 11 20 13 20 16a8 8 0 11-16 0c0-3 1.5-5 4-6.5C10 8 11.5 6 12 3z"/></svg></div>`;
            const meta = [];
            if (arbre.categorie) meta.push(escapeHtml(arbre.categorie));
            if (arbre.taille_actuelle_brute) meta.push(escapeHtml(arbre.taille_actuelle_brute));
            card.innerHTML = `
                ${photoCard}
                <div class="inv-card-body">
                    <div class="inv-card-top">
                        <strong>${escapeHtml(arbre.espece || 'Inconnue')}</strong>
                        <span class="inv-card-sante">${santeBadge}</span>
                    </div>
                    <p class="inv-card-meta">${meta.join(' · ') || '—'}</p>
                    <div class="inv-card-foot">
                        ${arbre.croissance_cm > 0 ? `<span class="pill pill-ok">+${arbre.croissance_cm} cm</span>` : ''}
                        ${arbre.recolte_totale > 0 ? `<span class="pill pill-harvest">${arbre.recolte_totale} kg</span>` : ''}
                        <span class="inv-card-suivi">${arbre.dernier_suivi ? new Date(arbre.dernier_suivi).toLocaleDateString('fr-FR') : 'Jamais suivi'}</span>
                    </div>
                </div>
            `;
            cardsFrag.appendChild(card);
        }
    });
    tbody.appendChild(frag);
    if (cards) cards.appendChild(cardsFrag);
}

// --- EXPORT ---
function telechargerFichier(contenu, nom, type) {
    const blob = new Blob([contenu], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
}

function csvEscape(val) {
    const s = val == null ? '' : String(val);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

window.exporterCSV = function() {
    fermerSidebar();
    const rows = getArbresFiltres();
    const headers = ['espece', 'categorie', 'provenance', 'sante', 'date_plantation', 'dernier_suivi', 'jours_sans_suivi', 'taille_initiale', 'taille_actuelle', 'croissance_cm', 'recolte_kg', 'notes', 'x_percent', 'y_percent', 'lat', 'lng'];
    const lines = [headers.join(';')];
    rows.forEach(a => {
        lines.push([
            a.espece, a.categorie, a.provenance, a.sante, a.date_plantation,
            a.dernier_suivi, a.jours_sans_suivi === 99999 ? '' : a.jours_sans_suivi,
            a.taille, a.taille_actuelle_brute, a.croissance_cm, a.recolte_totale,
            a.notes, a.x_percent, a.y_percent, a.lat, a.lng
        ].map(csvEscape).join(';'));
    });
    telechargerFichier(lines.join('\n'), `inventaire_arbres_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
}

// --- DASHBOARD ---
function majDashboard() {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js non chargé');
        return;
    }

    document.getElementById('stat-total').textContent = tousLesArbres.length;
    const aSurveiller = tousLesArbres.filter(a => a.sante === 'Malade' || a.sante === 'Mort');
    document.getElementById('stat-malades').textContent = aSurveiller.length;

    const croissances = tousLesArbres.map(a => a.croissance_cm || 0);
    const maxCroissance = croissances.length ? Math.max(...croissances) : 0;
    const bestTree = tousLesArbres.find(a => a.croissance_cm === maxCroissance);
    document.getElementById('stat-croissance').textContent =
        (maxCroissance > 0 && bestTree) ? `+${maxCroissance} cm (${bestTree.espece})` : '-';

    let totalHarvest = 0;
    tousLesArbres.forEach(a => totalHarvest += (a.recolte_totale || 0));
    document.getElementById('stat-recolte').textContent = totalHarvest > 0 ? `${totalHarvest.toFixed(1)} kg` : '0 kg';

    const catCounts = {};
    tousLesArbres.forEach(a => {
        const c = a.categorie || 'Non classé';
        catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const catLabels = Object.keys(catCounts);
    const catData = Object.values(catCounts);
    const catColors = catLabels.map(l => {
        if (l === 'Non classé') return '#cbd5e1';
        const f = toutesLesCategories.find(c => c.nom === l);
        return f ? f.couleur : '#10b981';
    });

    if (chartCatInstance) chartCatInstance.destroy();
    chartCatInstance = new Chart(document.getElementById('chartCategories').getContext('2d'), {
        type: 'doughnut',
        data: { labels: catLabels, datasets: [{ data: catData, backgroundColor: catColors, borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    const santeCounts = { Bonne: 0, Moyenne: 0, Malade: 0, Mort: 0 };
    tousLesArbres.forEach(a => { santeCounts[a.sante] = (santeCounts[a.sante] || 0) + 1; });

    if (chartSanteInstance) chartSanteInstance.destroy();
    chartSanteInstance = new Chart(document.getElementById('chartSante').getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Bonne', 'Moyenne', 'Malade', 'Mort'],
            datasets: [{
                data: [santeCounts.Bonne, santeCounts.Moyenne, santeCounts.Malade, santeCounts.Mort],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#475569'],
                borderWidth: 1
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    // Récoltes groupées par id d'arbre (évite les doublons de noms)
    const recoltesParAnnee = {};
    const arbresProducteurs = new Map();
    const years = new Set();

    tousLesSuivisGlobaux.forEach(s => {
        if (s.recolte_kg && parseFloat(s.recolte_kg) > 0) {
            const annee = new Date(s.date_suivi).getFullYear().toString();
            years.add(annee);
            const arbre = tousLesArbres.find(a => a.id === s.arbre_id);
            const key = s.arbre_id;
            const nomArbre = arbre ? (arbre.espece || 'Inconnu') : 'Inconnu';
            arbresProducteurs.set(key, nomArbre);

            if (!recoltesParAnnee[annee]) recoltesParAnnee[annee] = {};
            recoltesParAnnee[annee][key] = (recoltesParAnnee[annee][key] || 0) + parseFloat(s.recolte_kg);
        }
    });

    const sortedYears = Array.from(years).sort();
    const colorPalette = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'];

    const recoltesDatasets = Array.from(arbresProducteurs.entries()).map(([id, nomArbre], index) => ({
        label: nomArbre,
        data: sortedYears.map(y => recoltesParAnnee[y]?.[id] || 0),
        backgroundColor: colorPalette[index % colorPalette.length],
        borderWidth: 0,
        borderRadius: 4
    }));

    if (chartRecoltesInstance) chartRecoltesInstance.destroy();
    chartRecoltesInstance = new Chart(document.getElementById('chartRecoltes').getContext('2d'), {
        type: 'bar',
        data: {
            labels: sortedYears.length > 0 ? sortedYears : ['Aucune récolte'],
            datasets: recoltesDatasets.length > 0 ? recoltesDatasets : [{ label: 'Vide', data: [0], backgroundColor: '#e2e8f0' }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Kilos (kg)' } }
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(context) { return context.dataset.label + ': ' + context.raw + ' kg'; }
                    }
                }
            }
        }
    });
}

// --- HISTORIQUE ---
function majGraphiqueCroissance(arbre, suivis) {
    const container = document.getElementById('chart-container');
    let dataPoints = [];
    const cmInit = parseTailleToCm(arbre.taille);
    if (cmInit && (arbre.date_plantation || arbre.created_at)) {
        dataPoints.push({ x: arbre.date_plantation || arbre.created_at, y: cmInit });
    }
    suivis.forEach(s => {
        const cm = parseTailleToCm(s.taille);
        if (cm && s.date_suivi) dataPoints.push({ x: s.date_suivi, y: cm });
    });
    dataPoints.sort((a, b) => new Date(a.x) - new Date(b.x));

    if (dataPoints.length < 2) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    const labels = dataPoints.map(dp => new Date(dp.x).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
    const data = dataPoints.map(dp => dp.y);

    if (growthChartInstance) growthChartInstance.destroy();
    const ctx = document.getElementById('growthChart').getContext('2d');
    growthChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Taille (cm)',
                data,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#059669',
                pointRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: false, title: { display: true, text: 'Cm' } } }
        }
    });
}

function majGaleriePhotos(arbre, suivis) {
    const gal = document.getElementById('arbre-galerie');
    if (!gal) return;

    const photos = [];
    if (arbre?.image_url) {
        photos.push({ url: arbre.image_url, label: 'Portrait' });
    }
    (suivis || []).forEach((s) => {
        if (!s.image_url) return;
        const dateF = s.date_suivi
            ? new Date(s.date_suivi).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
            : 'Suivi';
        photos.push({ url: s.image_url, label: dateF });
    });

    if (!photos.length) {
        gal.classList.add('hidden');
        gal.innerHTML = '';
        return;
    }

    gal.classList.remove('hidden');
    gal.innerHTML = `
        <p class="stat-label">Photos <span class="galerie-count">${photos.length}</span></p>
        <div class="galerie-grid">
            ${photos.map((p) => {
                const safe = escapeHtml(p.url);
                return `<button type="button" class="galerie-thumb" onclick="ouvrirLightbox('${safe}')" title="${escapeHtml(p.label)}">
                    <img src="${safe}" alt="${escapeHtml(p.label)}" loading="lazy" width="72" height="72">
                    <span>${escapeHtml(p.label)}</span>
                </button>`;
            }).join('')}
        </div>
    `;
}

async function fetchHistorique(arbreId) {
    const listContainer = document.getElementById('historique-list');
    listContainer.innerHTML = '<p class="empty-hint">Chargement…</p>';

    const mesSuivis = tousLesSuivisGlobaux.filter(s => s.arbre_id === arbreId);
    majGraphiqueCroissance(arbreSelectionne, mesSuivis);
    majGaleriePhotos(arbreSelectionne, mesSuivis);

    if (mesSuivis.length === 0) {
        listContainer.innerHTML = `<p class="empty-hint empty-hint--box">Aucun suivi enregistré.</p>`;
        return;
    }

    listContainer.innerHTML = mesSuivis.map(suivi => {
        const dateF = new Date(suivi.date_suivi).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
        const safeImg = suivi.image_url ? escapeHtml(suivi.image_url) : '';
        const thumbHtml = suivi.image_url
            ? `<img src="${safeImg}" alt="" class="thumb-lg" loading="lazy" width="56" height="56" onclick="ouvrirLightbox('${safeImg}')">`
            : `<div class="thumb-empty-lg">N/A</div>`;

        const badgeRecolte = suivi.recolte_kg
            ? `<span class="pill pill-harvest">${escapeHtml(suivi.recolte_kg)} kg</span>`
            : '';

        return `
            <div class="suivi-card">
                ${thumbHtml}
                <div class="suivi-body">
                    <div class="suivi-meta">
                        <span class="suivi-date">${dateF}</span>
                        ${suivi.taille ? `<span class="pill pill-ok">${escapeHtml(suivi.taille)}</span>` : ''}
                        ${badgeRecolte}
                    </div>
                    <p class="suivi-notes">${suivi.notes ? escapeHtml(suivi.notes) : '<em>Aucun commentaire</em>'}</p>
                </div>
                <div class="suivi-actions">
                    <button type="button" class="btn-icon-sm" onclick="editerSuivi('${escapeHtml(suivi.id)}')" title="Modifier">✎</button>
                    <button type="button" class="btn-icon-sm btn-icon-sm--danger" onclick="supprimerSuivi('${escapeHtml(suivi.id)}')" title="Supprimer">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

window.ouvrirFormulaireSuivi = function() {
    if (!arbreSelectionne?.id) {
        showToast('Ouvrez d’abord la fiche d’un arbre', 'warn');
        return;
    }
    document.getElementById('suivi-form').reset();
    clearPhotoInputs('suivi-photo');
    pendingSuiviPhotoFile = null;
    const nameEl = document.getElementById('suivi-photo-name');
    if (nameEl) nameEl.textContent = 'Ajouter une photo';
    document.getElementById('suivi-photo-tile')?.classList.remove('has-file');
    document.getElementById('suivi-id').value = '';
    document.getElementById('suivi-arbre-id').value = arbreSelectionne.id;
    document.getElementById('suivi-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('suivi-modal-title').textContent = "Nouveau point d'étape";
    document.getElementById('suivi-modal').classList.remove('hidden');
}

window.editerSuivi = function(suiviId) {
    const suivi = tousLesSuivisGlobaux.find(s => s.id === suiviId);
    if (!suivi) return;
    document.getElementById('suivi-form').reset();
    clearPhotoInputs('suivi-photo');
    pendingSuiviPhotoFile = null;
    const nameEl = document.getElementById('suivi-photo-name');
    if (nameEl) nameEl.textContent = 'Ajouter une photo';
    document.getElementById('suivi-photo-tile')?.classList.remove('has-file');
    document.getElementById('suivi-id').value = suivi.id;
    document.getElementById('suivi-arbre-id').value = suivi.arbre_id;
    document.getElementById('suivi-date').value = suivi.date_suivi;
    document.getElementById('suivi-taille').value = suivi.taille || '';
    document.getElementById('suivi-recolte').value = suivi.recolte_kg || '';
    document.getElementById('suivi-notes').value = suivi.notes || '';
    document.getElementById('suivi-modal-title').textContent = "Modifier l'étape";
    document.getElementById('suivi-modal').classList.remove('hidden');
}
window.fermerFormulaireSuivi = function() {
    document.getElementById('suivi-modal').classList.add('hidden');
}

window.sauvegarderSuivi = async function(e) {
    e.preventDefault();
    if (!assertOnline('suivi')) return;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    btnSubmit.textContent = '…';
    btnSubmit.disabled = true;

    const id = document.getElementById('suivi-id').value;
    const photoFile = pendingSuiviPhotoFile || firstSelectedFile('suivi-photo');
    const suiviExistant = id ? tousLesSuivisGlobaux.find(s => s.id === id) : null;
    let finalImageUrl = suiviExistant ? suiviExistant.image_url : null;

    try {
        if (photoFile) {
            finalImageUrl = await uploadPhoto(photoFile, 'suivi');
            pendingSuiviPhotoFile = null;
            clearPhotoInputs('suivi-photo');
        }

        const donneesSuivi = {
            arbre_id: document.getElementById('suivi-arbre-id').value,
            date_suivi: document.getElementById('suivi-date').value,
            taille: document.getElementById('suivi-taille').value || null,
            recolte_kg: document.getElementById('suivi-recolte').value ? parseFloat(document.getElementById('suivi-recolte').value) : null,
            notes: document.getElementById('suivi-notes').value || null,
            image_url: finalImageUrl
        };

        if (id) await supabase.from('suivi_arbres').update(donneesSuivi).eq('id', id);
        else await supabase.from('suivi_arbres').insert([donneesSuivi]);

        fermerFormulaireSuivi();
        await fetchArbres();
        await fetchHistorique(arbreSelectionne.id);
        showToast(id ? 'Suivi mis à jour' : 'Suivi enregistré');
    } catch (err) {
        console.error(err);
        showToast('Erreur lors de la sauvegarde du suivi', 'danger');
    } finally {
        btnSubmit.textContent = 'Enregistrer';
        btnSubmit.disabled = false;
    }
}

window.supprimerSuivi = async function(suiviId) {
    const ok = await confirmAction({
        title: 'Supprimer le suivi',
        message: 'Voulez-vous vraiment supprimer ce point d’étape ?',
        confirmLabel: 'Supprimer',
        danger: true,
    });
    if (!ok) return;
    await supabase.from('suivi_arbres').delete().eq('id', suiviId);
    await fetchArbres();
    await fetchHistorique(arbreSelectionne.id);
    showToast('Suivi supprimé');
}

// --- MODALE ARBRE ---
/** Après un tap tactile, le navigateur renvoie souvent un click synthétique
 *  aux mêmes coords — sur la fiche déjà ouverte (photo +, selects…). */
let ghostClickGuardUntil = 0;
let ghostClickGuardTimer = null;
let lastPointerWasTouch = false;

document.addEventListener('pointerdown', (e) => {
    lastPointerWasTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
}, true);

function armGhostClickGuard(ms = 550) {
    ghostClickGuardUntil = Date.now() + ms;
    const nodes = [
        document.getElementById('arbre-modal'),
        document.getElementById('arbre-modal-overlay'),
        document.getElementById('arbre-modal-content'),
    ];
    nodes.forEach((el) => el?.classList.add('suppress-ghost-click'));
    clearTimeout(ghostClickGuardTimer);
    ghostClickGuardTimer = setTimeout(() => {
        nodes.forEach((el) => el?.classList.remove('suppress-ghost-click'));
        ghostClickGuardUntil = 0;
    }, ms);
}

function isGhostClickGuardActive() {
    return Date.now() < ghostClickGuardUntil;
}

window.ouvrirModalArbre = function(donnees) {
    try {
    clearTooltip();
    if (lastPointerWasTouch) armGhostClickGuard(550);

    const isNew = !donnees.id;
    arbreSelectionne = isNew ? null : donnees;
    // Marqueur actif seulement (évite de tout redessiner → flash)
    document.querySelectorAll('.tree-marker').forEach(m => {
        m.classList.toggle('active', arbreSelectionne && m.getAttribute('data-id') === String(arbreSelectionne.id));
    });

    document.getElementById('arbre-form').reset();
    clearPhotoInputs('form-photo');
    pendingArbrePhotoFile = null;
    suppressArbreAutosave = true;

    document.getElementById('panel-title').textContent = isNew ? 'Nouveau point' : "Détails de l'arbre";
    document.getElementById('form-id').value = donnees.id || '';
    document.getElementById('form-x').value = donnees.x_percent ?? '';
    document.getElementById('form-y').value = donnees.y_percent ?? '';
    document.getElementById('form-espece').value = donnees.espece || '';
    document.getElementById('form-date').value = donnees.date_plantation || '';
    document.getElementById('form-taille').value = donnees.taille || '';
    document.getElementById('form-notes').value = donnees.notes || '';

    if (document.getElementById('form-categorie')) document.getElementById('form-categorie').value = donnees.categorie || '';
    if (document.getElementById('form-provenance')) document.getElementById('form-provenance').value = donnees.provenance || '';
    if (document.getElementById('form-sante')) document.getElementById('form-sante').value = donnees.sante || 'Bonne';

    const preview = document.getElementById('form-photo-preview');
    const placeholder = document.getElementById('form-photo-placeholder');
    const photoBox = document.getElementById('form-photo-box');
    if (donnees.image_url) {
        preview.src = donnees.image_url;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        photoBox?.classList.add('has-photo');
    } else {
        preview.classList.add('hidden');
        preview.src = '';
        placeholder.classList.remove('hidden');
        photoBox?.classList.remove('has-photo');
    }

    const btnDelete = document.getElementById('btn-delete-arbre');
    const secHistorique = document.getElementById('section-historique');

    if (isNew) {
        btnDelete.classList.add('hidden');
        secHistorique.classList.add('hidden');
        document.getElementById('chart-container').classList.add('hidden');
        const gal = document.getElementById('arbre-galerie');
        if (gal) { gal.classList.add('hidden'); gal.innerHTML = ''; }
    } else {
        btnDelete.classList.remove('hidden');
        secHistorique.classList.remove('hidden');
        fetchHistorique(donnees.id);
    }

    syncArbreSaveUi(isNew);

    document.getElementById('arbre-modal-overlay').classList.remove('hidden');
    document.getElementById('arbre-modal').classList.remove('hidden');
    requestAnimationFrame(() => {
        document.getElementById('arbre-modal-content').classList.add('is-open');
        suppressArbreAutosave = false;
    });
    } catch (err) {
        suppressArbreAutosave = false;
        console.error('ouvrirModalArbre', err);
        showToast('Impossible d’ouvrir la fiche arbre', 'danger');
    }
}

window.fermerModalArbre = function() {
    clearTooltip();
    clearTimeout(arbreAutosaveTimer);
    pendingArbrePhotoFile = null;
    suppressArbreAutosave = true;
    const content = document.getElementById('arbre-modal-content');
    content.classList.remove('is-open');

    setTimeout(() => {
        document.getElementById('arbre-modal-overlay').classList.add('hidden');
        document.getElementById('arbre-modal').classList.add('hidden');
        suppressArbreAutosave = false;
    }, 200);

    arbreSelectionne = null;
    document.querySelectorAll('.tree-marker.active').forEach(m => m.classList.remove('active'));
}

function firstSelectedFile(...ids) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el?.files?.length) return el.files[0];
    }
    return null;
}

let pendingArbrePhotoFile = null;
let pendingSuiviPhotoFile = null;
let suppressArbreAutosave = false;
let arbreAutosaveTimer = null;
let arbreSaveInFlight = false;
let arbreSaveQueued = false;

function clearPhotoInputs(...ids) {
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function setArbreSaveStatus(text, state = '') {
    const el = document.getElementById('arbre-save-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-saving', 'is-saved', 'is-error');
    if (state) el.classList.add(state);
}

function syncArbreSaveUi(isNew) {
    const btnSave = document.getElementById('btn-save-arbre');
    const status = document.getElementById('arbre-save-status');
    if (isNew) {
        btnSave?.classList.remove('hidden');
        status?.classList.add('hidden');
    } else {
        btnSave?.classList.add('hidden');
        status?.classList.remove('hidden');
        setArbreSaveStatus('Enregistrement automatique');
    }
}

function scheduleArbreAutosave() {
    if (suppressArbreAutosave) return;
    const id = document.getElementById('form-id')?.value;
    if (!id) return;
    setArbreSaveStatus('Modification…', 'is-saving');
    clearTimeout(arbreAutosaveTimer);
    arbreAutosaveTimer = setTimeout(() => {
        persisterArbre({ silent: true, source: 'autosave' });
    }, 650);
}

function bindArbreAutosave() {
    const form = document.getElementById('arbre-form');
    if (!form || form.dataset.autosaveBound === '1') return;
    form.dataset.autosaveBound = '1';
    const onEdit = (e) => {
        if (e.target?.id === 'form-photo') return;
        scheduleArbreAutosave();
    };
    form.addEventListener('input', onEdit);
    form.addEventListener('change', onEdit);
}

/** Samsung/Android : label[for] ouvre le sélecteur nativement (plus fiable que input.click()). */
function bindPhotoPickers() {
    if (document.body.dataset.photoPickersBound === '1') return;
    document.body.dataset.photoPickersBound = '1';

    const wire = (btnId, inputId, onFile) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!input) return;

        // Avant ouverture : vider pour pouvoir resélectionner le même fichier
        // (le File n’existe pas encore — sans danger)
        const onOpenIntent = (e) => {
            if (isGhostClickGuardActive()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            try { input.value = ''; } catch (_) { /* ignore */ }
            // label[for] ouvre nativement ; bouton = click programmatique
            const isLabel = btn && (btn.tagName === 'LABEL' || btn.getAttribute('for') === inputId);
            if (!isLabel) {
                e.preventDefault();
                e.stopPropagation();
                input.click();
            }
        };
        btn?.addEventListener('click', onOpenIntent);
        input.addEventListener('change', (ev) => onFile(ev));
    };

    wire('btn-pick-arbre-photo', 'form-photo', (e) => window.previewMainPhoto(e));
    wire('suivi-photo-tile', 'suivi-photo', (e) => window.previewSuiviPhoto(e));
}

window.previewMainPhoto = async function(event) {
    const input = event.target;
    const raw = input.files?.[0];
    if (!raw) return;

    pendingArbrePhotoFile = raw;

    try {
        // PRIORITÉ : cloner en mémoire avant tout (preview, compression, clear input)
        setArbreSaveStatus('Lecture de la photo…', 'is-saving');
        const prepared = await preparePhotoForUpload(raw);
        pendingArbrePhotoFile = prepared;

        try { input.value = ''; } catch (_) { /* ok */ }

        const readyUrl = URL.createObjectURL(prepared);
        const preview = document.getElementById('form-photo-preview');
        preview.src = readyUrl;
        preview.classList.remove('hidden');
        document.getElementById('form-photo-placeholder').classList.add('hidden');
        document.getElementById('form-photo-box')?.classList.add('has-photo');

        if (document.getElementById('form-id')?.value) {
            setArbreSaveStatus('Envoi de la photo…', 'is-saving');
            const ok = await persisterArbre({ silent: true, source: 'photo' });
            if (!ok && pendingArbrePhotoFile) {
                setArbreSaveStatus('Échec — retapez + pour réessayer', 'is-error');
            }
        } else {
            setArbreSaveStatus('');
            showToast('Photo prête — enregistrez l’arbre');
        }
    } catch (err) {
        console.error(err);
        pendingArbrePhotoFile = null;
        setArbreSaveStatus('Échec photo', 'is-error');
        showToast(friendlyPhotoError(err), 'danger');
    }
};

window.previewSuiviPhoto = async function(event) {
    const input = event.target;
    const raw = input.files?.[0];
    const nameEl = document.getElementById('suivi-photo-name');
    const tile = document.getElementById('suivi-photo-tile');
    if (!raw) {
        pendingSuiviPhotoFile = null;
        if (nameEl) nameEl.textContent = 'Ajouter une photo';
        tile?.classList.remove('has-file');
        return;
    }
    try {
        if (nameEl) nameEl.textContent = 'Préparation…';
        pendingSuiviPhotoFile = await preparePhotoForUpload(raw);
        try { input.value = ''; } catch (_) { /* ok */ }
        if (nameEl) nameEl.textContent = raw.name || 'Photo sélectionnée';
        tile?.classList.add('has-file');
    } catch (err) {
        console.error(err);
        pendingSuiviPhotoFile = null;
        if (nameEl) nameEl.textContent = 'Ajouter une photo';
        tile?.classList.remove('has-file');
        showToast(friendlyPhotoError(err), 'danger');
    }
};

async function persisterArbre({ silent = false, source = 'manual' } = {}) {
    if (!assertOnline('enregistrement')) return false;

    // Photo / manuel : attendre la fin d’un autre save (évite faux « échec » + UI bloquée)
    if (arbreSaveInFlight) {
        if (source === 'photo' || source === 'manual') {
            const t0 = Date.now();
            while (arbreSaveInFlight && Date.now() - t0 < 20000) {
                await new Promise((r) => setTimeout(r, 100));
            }
            if (arbreSaveInFlight) {
                arbreSaveQueued = true;
                if (silent) setArbreSaveStatus('En attente…', 'is-saving');
                return false;
            }
        } else {
            arbreSaveQueued = true;
            return false;
        }
    }
    arbreSaveInFlight = true;

    const btnSubmit = document.getElementById('btn-save-arbre');
    const originalText = btnSubmit?.textContent || 'Enregistrer l\'arbre';
    if (!silent && btnSubmit) {
        btnSubmit.textContent = '…';
        btnSubmit.disabled = true;
    }
    if (silent) {
        setArbreSaveStatus(source === 'photo' ? 'Envoi de la photo…' : 'Enregistrement…', 'is-saving');
    }

    const id = document.getElementById('form-id').value;
    const photoFile = pendingArbrePhotoFile || firstSelectedFile('form-photo');
    let finalImageUrl = arbreSelectionne ? arbreSelectionne.image_url : null;

    const espece = document.getElementById('form-espece').value.trim();
    if (!espece) {
        if (!silent) showToast('Indiquez une espèce', 'warn');
        else setArbreSaveStatus('Espèce requise', 'is-error');
        if (btnSubmit) { btnSubmit.textContent = originalText; btnSubmit.disabled = false; }
        arbreSaveInFlight = false;
        return false;
    }

    let xVal = parseFloat(document.getElementById('form-x').value);
    let yVal = parseFloat(document.getElementById('form-y').value);
    if (Number.isNaN(xVal) || Number.isNaN(yVal)) {
        if (!silent) showToast('Position invalide — replacez l’arbre sur le plan', 'danger');
        else setArbreSaveStatus('Position invalide', 'is-error');
        if (btnSubmit) { btnSubmit.textContent = originalText; btnSubmit.disabled = false; }
        arbreSaveInFlight = false;
        return false;
    }

    try {
        if (photoFile) {
            finalImageUrl = await uploadPhoto(photoFile, 'arbre');
            pendingArbrePhotoFile = null;
            clearPhotoInputs('form-photo');
        }

        const donneesArbre = {
            espece,
            date_plantation: document.getElementById('form-date').value || null,
            taille: document.getElementById('form-taille').value || null,
            notes: document.getElementById('form-notes').value || null,
            sante: document.getElementById('form-sante').value || 'Bonne',
            x_percent: xVal,
            y_percent: yVal,
            image_url: finalImageUrl,
            categorie: document.getElementById('form-categorie').value || null,
            provenance: document.getElementById('form-provenance').value || null
        };

        let returnedTree = null;
        if (id) {
            const { data, error } = await supabase.from('arbres').update(donneesArbre).eq('id', id).select();
            if (error) throw error;
            returnedTree = data && data[0];
        } else {
            const { data, error } = await supabase.from('arbres').insert([donneesArbre]).select();
            if (error) throw error;
            returnedTree = data && data[0];
            if (!returnedTree) {
                await fetchArbres();
                returnedTree = tousLesArbres.find(a =>
                    a.espece === espece &&
                    Math.abs((a.x_percent || 0) - xVal) < 0.01 &&
                    Math.abs((a.y_percent || 0) - yVal) < 0.01
                ) || null;
            }
        }

        await fetchArbres();

        if (returnedTree) {
            arbreSelectionne = returnedTree;
            if (!id) {
                suppressArbreAutosave = true;
                document.getElementById('form-id').value = returnedTree.id;
                document.getElementById('panel-title').textContent = "Détails de l'arbre";
                syncArbreSaveUi(false);
                document.getElementById('section-historique')?.classList.remove('hidden');
                document.getElementById('btn-delete-arbre')?.classList.remove('hidden');
                fetchHistorique(returnedTree.id);
                suppressArbreAutosave = false;
            }
        }

        if (silent) {
            setArbreSaveStatus(source === 'photo' ? 'Photo enregistrée' : 'Enregistré', 'is-saved');
            if (source === 'photo') showToast('Photo enregistrée');
        } else {
            if (btnSubmit) btnSubmit.textContent = 'Sauvegardé';
            showToast(id ? 'Arbre mis à jour' : 'Arbre ajouté');
            setTimeout(() => {
                if (btnSubmit) {
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                }
            }, 1200);
            if (!id && !returnedTree) fermerModalArbre();
        }

        if (id && returnedTree) fetchHistorique(id);
        return true;
    } catch (err) {
        console.error(err);
        const msg = friendlyPhotoError(err);
        showToast(msg, 'danger');
        if (silent) setArbreSaveStatus('Échec envoi — retapez + ou modifiez un champ', 'is-error');
        if (btnSubmit) {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
        // Garder pendingArbrePhotoFile pour un nouvel essai (autosave / + )
        if (source === 'photo') arbreSaveQueued = false;
        return false;
    } finally {
        arbreSaveInFlight = false;
        if (arbreSaveQueued) {
            arbreSaveQueued = false;
            scheduleArbreAutosave();
        }
    }
}

window.sauvegarderArbre = async function(e) {
    e.preventDefault();
    await persisterArbre({ silent: false, source: 'manual' });
};

window.supprimerArbre = async function() {
    if (!arbreSelectionne) return;
    const ok = await confirmAction({
        title: 'Supprimer l’arbre',
        message: `Supprimer « ${arbreSelectionne.espece} » et tout son historique ? Cette action est définitive.`,
        confirmLabel: 'Supprimer',
        danger: true,
    });
    if (!ok) return;
    await supabase.from('arbres').delete().eq('id', arbreSelectionne.id);
    fermerModalArbre();
    fetchArbres();
    showToast('Arbre supprimé');
}

// --- NAVIGATION ---
const viewTitles = {
    plan: 'Plan de la parcelle',
    table: 'Inventaire et Croissance',
    dashboard: 'Tableau de bord'
};

window.switchView = function(view) {
    clearTooltip();
    fermerSidebar();
    // Libère la navigation mobile si une fiche est ouverte
    const arbreModal = document.getElementById('arbre-modal');
    if (arbreModal && !arbreModal.classList.contains('hidden')) fermerModalArbre();
    const suiviModal = document.getElementById('suivi-modal');
    if (suiviModal && !suiviModal.classList.contains('hidden')) fermerFormulaireSuivi();
    vueCourante = view;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    const titles = {
        plan: 'Plan',
        table: 'Inventaire',
        dashboard: 'Tableau de bord'
    };
    const titlesDesktop = {
        plan: 'Plan de la parcelle',
        table: 'Inventaire et croissance',
        dashboard: 'Tableau de bord'
    };

    ['plan', 'table', 'dashboard'].forEach((v) => {
        const el = document.getElementById(`view-${v}`);
        if (!el) return;
        el.classList.toggle('is-visible', v === view);
        document.getElementById(`btn-${v}`)?.classList.toggle('is-active', v === view);
    });

    document.querySelectorAll('#mobile-tabbar .tabbar-btn[data-view]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-view') === view);
    });

    document.getElementById('view-title').textContent = isMobile
        ? (titles[view] || titles.plan)
        : (titlesDesktop[view] || titlesDesktop.plan);
    document.body.dataset.view = view;

    const planActions = document.getElementById('plan-actions');
    const filtresBar = document.getElementById('filtres-bar');

    if (view === 'plan') {
        planActions?.classList.remove('hidden');
        filtresBar?.classList.remove('hidden');
    } else if (view === 'table') {
        planActions?.classList.add('hidden');
        filtresBar?.classList.remove('hidden');
    } else {
        planActions?.classList.add('hidden');
        filtresBar?.classList.add('hidden');
    }
}

initialiserApp();
