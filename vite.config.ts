import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {rewritePublicPaths} from './vite.rewritePublic';

// Despliegue en DonWeb (cPanel/Ferozo) subido por FileZilla, ya sea en la raíz
// (public_html/) o en una subcarpeta (public_html/boda/):
//   - base:'./'  -> assets relativos a la carpeta donde esté index.html
//   - rewritePublicPaths() -> arregla las rutas absolutas que trae framer-home.html
// Si preferís rutas absolutas explícitas, cambiá './' por '/boda/'.
export default defineConfig(() => {
  return {
    // En DEV (servidor local con server.ts) se sirve en la raíz; en BUILD se usa
    // './' para que el mismo dist/ funcione en public_html/ o en public_html/boda/.
    base: process.env.VITE_BASE ?? (process.env.NODE_ENV === 'development' ? '/' : './'),
    plugins: [react(), tailwindcss(), rewritePublicPaths()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
