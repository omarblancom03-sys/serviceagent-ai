import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { SesionProvider } from './auth/SesionContext';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SesionProvider>
        <App />
      </SesionProvider>
    </BrowserRouter>
  </StrictMode>,
);
