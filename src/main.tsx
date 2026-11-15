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
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
