import { supabase, BUCKET_NAME, FILE_NAME } from './lib/supabase.js';
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

async function compressImage(file, maxSize = 1600, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return file;
    try {
        const bitmap = await createImageBitmap(file);
        let { width, height } = bitmap;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) return file;
        const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    } catch (e) {
        console.warn('Compression impossible, envoi brut', e);
        return file;
    }
}

async function uploadPhoto(file, prefix) {
    const compressed = await compressImage(file);
    const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
    const { error } = await supabase.storage.from('photos').upload(fileName, compressed, { cacheControl: '3600', contentType: 'image/jpeg' });
    if (error) throw error;
    return supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
}

// --- ZOOM / ROTATION ---
let zoomLevel = parseInt(localStorage.getItem('mapZoom'), 10);
if (!Number.isFinite(zoomLevel)) zoomLevel = 100;
let rotationDeg = parseInt(localStorage.getItem('mapRotation'), 10);
if (!Number.isFinite(rotationDeg)) rotationDeg = 0;

function persistMapView() {
    try {
        localStorage.setItem('mapZoom', String(zoomLevel));
        localStorage.setItem('mapRotation', String(rotationDeg));
    } catch (_) { /* private mode / quota */ }
}

function maxZoomLevel() {
    return 2000;
}

window.changerZoom = function(delta) {
    const next = Math.max(50, Math.min(maxZoomLevel(), zoomLevel + delta));
    if (next === zoomLevel) return;
    const area = document.getElementById('map-scroll-area');
    let anchor = null;
    if (area && area.scrollWidth > 0 && area.scrollHeight > 0) {
        anchor = {
            xRatio: (area.scrollLeft + area.clientWidth / 2) / area.scrollWidth,
            yRatio: (area.scrollTop + area.clientHeight / 2) / area.scrollHeight,
        };
    }
    zoomLevel = next;
    persistMapView();
    appliquerTransformations();
    if (anchor && area) {
        // Laisser le layout appliquer la nouvelle largeur avant de recentrer
        requestAnimationFrame(() => {
            area.scrollLeft = anchor.xRatio * area.scrollWidth - area.clientWidth / 2;
            area.scrollTop = anchor.yRatio * area.scrollHeight - area.clientHeight / 2;
        });
    }
};
window.changerRotation = function(delta) {
    rotationDeg += delta;
    persistMapView();
    appliquerTransformations();
};
function appliquerTransformations() {
    const wrapper = document.getElementById('map-content-wrapper');
    if (!wrapper) return;
    const base = Number(window.baseMapWidth) || 800;
    const newWidth = Math.max(40, base * (zoomLevel / 100));
    wrapper.style.width = `${newWidth}px`;
    wrapper.style.maxWidth = 'none';
    wrapper.style.transform = `rotate(${rotationDeg}deg)`;
}

function setZoomLevel(level, { persist = true } = {}) {
    zoomLevel = Math.max(50, Math.min(maxZoomLevel(), level));
    if (persist) persistMapView();
    appliquerTransformations();
}

function bindMapControlButtons() {
    const root = document.getElementById('map-controls');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    let lastTs = 0;
    const run = (action) => {
        const now = Date.now();
        if (now - lastTs < 350) return;
        lastTs = now;
        if (action === 'zoom-in') window.changerZoom(25);
        else if (action === 'zoom-out') window.changerZoom(-25);
        else if (action === 'rotate') window.changerRotation(90);
    };
    root.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const btn = e.target.closest('[data-map-action]');
        if (!btn || !root.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        run(btn.getAttribute('data-map-action'));
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
    if (e.target.closest('#map-controls') || e.target.closest('#map-legend') || e.target.closest('#add-mode-hint')) return;

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
.window.toggleModeAjout = function() {
    modeAjout = !modeAjout;
    const btn = document.getElementById('btn-add-mode');
    const dockBtn = document.getElementById('btn-add-dock');
    const hint = document.getElementById('add-mode-hint');
    const wrapper = document.getElementById('map-content-wrapper');
    const addLabel = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn-label">Ajouter un arbre</span>';
    const cancelLabel = '<span class="btn-label">Annuler</span>';
    if (modeAjout) {
        [btn, dockBtn].forEach((el) => {
            if (!el) return;
            el.classList.add('is-cancel');
            el.classList.remove('btn-primary');
            el.classList.add('btn-ghost');
            el.innerHTML = cancelLabel;
        });
        hint?.classList.add('show');
        hint?.classList.remove('hidden');
        wrapper?.classList.add('add-mode');
        showToast('Cliquez sur le plan pour placer un arbre');
    } else {
        [btn, dockBtn].forEach((el) => {
            if (!el) return;
            el.classList.remove('is-cancel');
            el.classList.add('btn-primary');
            el.classList.remove('btn-ghost');
            el.innerHTML = addLabel;
        });
        hint?.classList.remove('show');
        hint?.classList.add('hidden');
        wrapper?.classList.remove('add-mode');
    }
}

window.ouvrirChoixAjoutArbre = function() { window.toggleModeAjout(); }
function desactiverModeAjout() { if (modeAjout) toggleModeAjout(); }

// --- DRAG MARQUEURS ---
let isDraggingMarker = false;
let markerHasMoved = false;
let currentDragMarker = null;
let currentDragArbre = null;
let startClientX, startClientY, startXPercent, startYPercent, startMapW, startMapH;

window.initMarkerDrag = function(e, arbre, marker) {
    e.stopPropagation();
    e.preventDefault();
    isDraggingMarker = true;
    markerHasMoved = false;
    currentDragMarker = marker;
    currentDragArbre = arbre;
    marker.classList.add('is-dragging-marker');
    clearTooltip();
    startClientX = e.clientX;
    startClientY = e.clientY;
    startXPercent = arbre.x_percent;
    startYPercent = arbre.y_percent;
    const img = document.getElementById('map-image');
    startMapW = img.offsetWidth;
    startMapH = img.offsetHeight;
    try { marker.setPointerCapture(e.pointerId); } catch (_) {}
}

window.onMarkerDrag = function(e) {
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
}

window.stopMarkerDrag = async function(e) {
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
}

window.cancelMarkerDrag = function(e) {
    if (!isDraggingMarker || !currentDragMarker) return;
    isDraggingMarker = false;
    try { currentDragMarker.releasePointerCapture(e.pointerId); } catch (_) {}
    currentDragMarker.classList.remove('is-lifting', 'is-dragging-marker');
    currentDragMarker.style.left = `${startXPercent}%`;
    currentDragMarker.style.top = `${startYPercent}%`;
    currentDragMarker = null;
    currentDragArbre = null;
    markerHasMoved = false;
}

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
        const area = document.getElementById('map-scroll-area');
        const areaW = Math.max(area.clientWidth - 8, 100);
        const areaH = Math.max(area.clientHeight - 8, 100);
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const areaRatio = areaW / areaH;
        if (imgRatio > areaRatio) window.baseMapWidth = areaW;
        else window.baseMapWidth = areaH * imgRatio;
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
    const box = document.getElementById('map-legend');
    const items = document.getElementById('legend-items');
    if (!box || !items) return;
    if (!toutesLesCategories.length || document.getElementById('map-image').classList.contains('hidden')) {
        box.classList.add('hidden');
        return;
    }
    items.innerHTML = toutesLesCategories.map(cat => `
        <div class="legend-row">
            <span class="legend-swatch" style="background:${escapeHtml(cat.couleur || '#1f6b4f')}"></span>
            <span>${escapeHtml(cat.nom)}</span>
        </div>
    `).join('') + `
        <div class="legend-row legend-divider">
            <span class="legend-swatch legend-swatch--alert"></span>
            <span>Malade</span>
        </div>
    `;
    box.classList.remove('hidden');
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
    document.getElementById('suivi-form').reset();
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
    const photoInput = document.getElementById('suivi-photo');
    const suiviExistant = id ? tousLesSuivisGlobaux.find(s => s.id === id) : null;
    let finalImageUrl = suiviExistant ? suiviExistant.image_url : null;

    try {
        if (photoInput.files.length > 0) {
            finalImageUrl = await uploadPhoto(photoInput.files[0], 'suivi');
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
window.ouvrirModalArbre = function(donnees) {
    try {
    clearTooltip();
    const isNew = !donnees.id;
    arbreSelectionne = isNew ? null : donnees;
    // Marqueur actif seulement (évite de tout redessiner → flash)
    document.querySelectorAll('.tree-marker').forEach(m => {
        m.classList.toggle('active', arbreSelectionne && m.getAttribute('data-id') === String(arbreSelectionne.id));
    });

    document.getElementById('arbre-form').reset();
    document.getElementById('form-photo').value = '';

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
    if (donnees.image_url) {
        preview.src = donnees.image_url;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        preview.classList.add('hidden');
        preview.src = '';
        placeholder.classList.remove('hidden');
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

    document.getElementById('arbre-modal-overlay').classList.remove('hidden');
    document.getElementById('arbre-modal').classList.remove('hidden');
    requestAnimationFrame(() => {
        document.getElementById('arbre-modal-content').classList.add('is-open');
    });
    } catch (err) {
        console.error('ouvrirModalArbre', err);
        showToast('Impossible d’ouvrir la fiche arbre', 'danger');
    }
}

window.fermerModalArbre = function() {
    clearTooltip();
    const content = document.getElementById('arbre-modal-content');
    content.classList.remove('is-open');

    setTimeout(() => {
        document.getElementById('arbre-modal-overlay').classList.add('hidden');
        document.getElementById('arbre-modal').classList.add('hidden');
    }, 200);

    arbreSelectionne = null;
    document.querySelectorAll('.tree-marker.active').forEach(m => m.classList.remove('active'));
}

window.previewMainPhoto = function(event) {
    if (event.target.files.length > 0) {
        const src = URL.createObjectURL(event.target.files[0]);
        document.getElementById('form-photo-preview').src = src;
        document.getElementById('form-photo-preview').classList.remove('hidden');
        document.getElementById('form-photo-placeholder').classList.add('hidden');
    }
}

window.sauvegarderArbre = async function(e) {
    e.preventDefault();
    if (!assertOnline('enregistrement')) return;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = '…';
    btnSubmit.disabled = true;

    const id = document.getElementById('form-id').value;
    const photoInput = document.getElementById('form-photo');
    let finalImageUrl = arbreSelectionne ? arbreSelectionne.image_url : null;

    const espece = document.getElementById('form-espece').value.trim();
    if (!espece) {
        showToast('Indiquez une espèce', 'warn');
        btnSubmit.textContent = originalText;
        btnSubmit.disabled = false;
        return;
    }

    let xVal = parseFloat(document.getElementById('form-x').value);
    let yVal = parseFloat(document.getElementById('form-y').value);
    if (Number.isNaN(xVal) || Number.isNaN(yVal)) {
        showToast('Position invalide — replacez l’arbre sur le plan', 'danger');
        btnSubmit.textContent = originalText;
        btnSubmit.disabled = false;
        return;
    }

    try {
        if (photoInput.files.length > 0) {
            finalImageUrl = await uploadPhoto(photoInput.files[0], 'arbre');
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
            // Si RLS empêche le SELECT après insert, on recharge la liste
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
        btnSubmit.textContent = 'Sauvegardé';
        showToast(id ? 'Arbre mis à jour' : 'Arbre ajouté');
        setTimeout(() => { btnSubmit.textContent = originalText; btnSubmit.disabled = false; }, 1200);

        if (!id && returnedTree) ouvrirModalArbre(returnedTree);
        else if (id && returnedTree) {
            arbreSelectionne = returnedTree;
            fetchHistorique(id);
        } else if (!id) {
            fermerModalArbre();
        }
    } catch (err) {
        console.error(err);
        const msg = err?.message || err?.error_description || 'Erreur de sauvegarde';
        showToast(msg, 'danger');
        btnSubmit.textContent = originalText;
        btnSubmit.disabled = false;
    }
}

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
