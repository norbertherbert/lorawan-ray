import { ThemeInit } from '../.flowbite-react/init';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

const rootElement = document.getElementById('root');
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 15_000,
    },
  },
});

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <ThemeInit />
    <App />
  </QueryClientProvider>,
);
