import { registerServiceWorker } from './lib/offline.js';
import './app.js';

registerServiceWorker();

if (window.matchMedia('(display-mode: standalone)').matches) {
  document.documentElement.classList.add('is-pwa');
}
