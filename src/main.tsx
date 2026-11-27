import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// Brand typography: Inter for UI, Poppins for display, Vazirmatn so Persian/Arabic text looks great.
import '@fontsource-variable/inter';
import '@fontsource-variable/vazirmatn';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { recoverFromMissingChunks } from '@/lib/appUpdate';
import { watchInstallPrompt } from '@/lib/install';
import { registerServiceWorker } from '@/lib/push/client';
import App from './App.tsx';
import './index.css';

// Notifications (and push with the app closed) run through the service worker.
registerServiceWorker();
// If a deploy removed a file this copy still needs, move to the new version.
recoverFromMissingChunks();
// Lets the menu offer "Install app" where the browser supports it.
watchInstallPrompt();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
