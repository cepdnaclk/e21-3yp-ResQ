import React from 'react';
import { createRoot } from 'react-dom/client';

const App = () => {
  return <h1>ResQ Web Dashboard (TODO)</h1>;
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
} else {
  console.error('Root container not found');
}
