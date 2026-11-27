import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initAuth } from './auth.ts';
import App from './App.tsx';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
initAuth()
  .then(() => root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  ))
  .catch((e) => root.render(<div className="fatal">Impossible de démarrer l'application : {String(e)}</div>));
