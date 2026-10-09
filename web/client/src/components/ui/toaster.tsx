import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return <Sonner position="bottom-right" theme="system" closeButton richColors />;
}

export { toast } from 'sonner';
