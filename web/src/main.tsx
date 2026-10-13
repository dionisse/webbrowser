import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './design/global.css';
import './design/ui.css';
import './features/shell/shell.css';
import './features/shell/panels.css';

const container = document.getElementById('root');
if (!container) throw new Error('Nimbus: conteneur racine absent');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
