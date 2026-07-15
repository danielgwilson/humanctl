import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@humanctl/ui/styles/app.css';

import { HumanctlViewport } from './viewport';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HumanctlViewport />
  </StrictMode>,
);
