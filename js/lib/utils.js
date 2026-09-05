import { supabase } from './supabase.js';

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseTailleToCm(val) {
  if (!val) return null;
  const s = val.toString().toLowerCase().replace(/,/g, '.').trim();
  let match;
  if (s.includes('m') && !s.includes('cm')) {
    match = s.match(/([0-9.,]+)\s*m\s*([0-9]*)/);
    if (match) {
      const m = parseFloat(match[1]) || 0;
      const cm = parseInt(match[2], 10) || 0;
      if (s.includes('.') || s.includes(',')) return Math.round(m * 100);
      return m * 100 + cm;
    }
  } else {
    match = s.match(/([0-9.,]+)/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

export async function compressImage(file, maxSize = 1600, quality = 0.82) {
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
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('Compression impossible, envoi brut', e);
    return file;
  }
}

export async function uploadPhoto(file, prefix) {
  const compressed = await compressImage(file);
  const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
  const { error } = await supabase.storage
    .from('photos')
    .upload(fileName, compressed, { cacheControl: '3600', contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
}

export function telechargerFichier(contenu, nom, type) {
  const blob = new Blob([contenu], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

export function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function showToast(message, tone = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--show'));
  setTimeout(() => {
    el.classList.remove('toast--show');
    setTimeout(() => el.remove(), 280);
  }, 2800);
}

/** Dialogue de confirmation non-bloquant (remplace window.confirm). */
export function confirmAction({
  title = 'Confirmer',
  message = '',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = true,
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const btnOk = document.getElementById('confirm-ok');
    const btnCancel = document.getElementById('confirm-cancel');
    if (!modal || !btnOk || !btnCancel) {
      resolve(window.confirm(message || title));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnOk.textContent = confirmLabel;
    btnCancel.textContent = cancelLabel;
    btnOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';

    const finish = (ok) => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey, true);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onOverlay = (e) => { if (e.target === modal) finish(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(false);
    };

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey, true);
    modal.classList.remove('hidden');
    btnOk.focus();
  });
}
