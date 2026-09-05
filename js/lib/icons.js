const paths = {
  tree: '<path d="M12 3c.5 3 2 5 4 6.5C18.5 11 20 13 20 16a8 8 0 11-16 0c0-3 1.5-5 4-6.5C10 8 11.5 6 12 3z"/><path d="M12 14v7"/>',
  map: '<path d="M9 20l-5.447-2.724A2 2 0 013 15.382V6.618a2 2 0 011.553-1.947L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A2 2 0 0021 18.382V9.618a2 2 0 00-1.553-1.947L15 6m0 11V6m0 0L9 2"/>',
  table: '<path d="M3 6h18M3 10h18M3 14h18M3 18h18"/>',
  chart: '<path d="M4 19V5M4 19h16M8 17V10M12 17V7M16 17v-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  rotate: '<path d="M3 12a9 9 0 0115.5-6.36M21 3v6h-6"/><path d="M21 12a9 9 0 01-15.5 6.36M3 21v-6h6"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  download: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 18h16"/>',
  save: '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  tags: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2v-9a2 2 0 012-2z"/><circle cx="12" cy="13" r="3.5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.3L2.8 18a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"/>',
  leaf: '<path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14z"/><path d="M5 19c3-3 7-5 12-6"/>',
  wifiOff: '<path d="M2 8.8A15 15 0 0112 5c2.2 0 4.3.5 6.2 1.3M4.9 12.3A10 10 0 0112 10c1.3 0 2.6.3 3.8.7M8.5 15.5a5 5 0 013.5-1.3c.6 0 1.2.1 1.7.3M12 19h.01M3 3l18 18"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 15l-5-5-8 8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
};

export function icon(name, className = 'icon') {
  const d = paths[name] || paths.leaf;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
