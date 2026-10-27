import '@fontsource/orbitron/latin-500.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { loadSave, resumeSave } from './app/game-session';
import { settings } from './app/settings';
import { setLanguage } from './i18n';
import { normalizeRoomCode } from './net/transport';
import { App } from './ui/app';
import { gameScreen } from './ui/game-screen';
import { lobbyScreen } from './ui/lobby';
import { joinScreen, startScreen } from './ui/menus';

setLanguage(settings.lang);
document.documentElement.dataset.quality = settings.quality;

// Echte Viewport-Höhe (mobile Browserleisten) als CSS-Variable.
const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
setVh();
window.addEventListener('resize', setVh);

// Doppeltipp-Zoom und Pinch auf der Seite unterbinden (das Spielfeld zoomt selbst).
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

const app = new App(document.getElementById('app')!);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.installPrompt = e as Event & { prompt(): Promise<void> };
});

if (import.meta.env.PROD) registerSW({ immediate: true });

// Einladungslink ?room=XXXXX
const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
if (roomParam) history.replaceState(null, '', location.pathname);
const room = roomParam ? normalizeRoomCode(roomParam) : null;
const save = loadSave();

// Mit Einladungslink nur als Gast fortsetzen – sonst neu beitreten.
if (save && (!room || (room === save.room && save.role === 'guest')) && navigator.onLine) {
  // Gleicher Raum (z. B. nach Neuladen) → Spiel direkt fortsetzen.
  const s = resumeSave(save);
  app.setSession(s);
  app.go(s.ctrl.phase === 'lobby' ? lobbyScreen : gameScreen);
} else if (room) {
  app.go((a) => joinScreen(a, room));
} else {
  app.go(startScreen);
}

// Für Tests/Debugging in der Konsole erreichbar.
(window as unknown as { neonfleet: App }).neonfleet = app;
