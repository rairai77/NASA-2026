import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import './design.css';
import './shell.css';
import './panels.css';
import './globe.css';
import './responsive.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
