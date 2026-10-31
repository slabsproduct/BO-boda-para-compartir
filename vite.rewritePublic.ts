import type { Plugin } from 'vite';

/**
 * Reescribe rutas locales ("/assets/...", "/scripts/...", "/fonts/...",
 * "/framer/...", "/favicon.svg", "/framer-home.html" y las relativas
 * "assets/images/x.png") que aparecen LITERALMENTE dentro de los recursos
 * públicos —principalmente public/framer-home.html, exportado desde Framer con
 * rutas absolutas— para que queden relativas a la BASE de la app.
 *
 * ¿Por qué? Al desplegar en una subcarpeta (public_html/boda/) esas rutas
 * apuntarían a la raíz del dominio y darían 404. Con `base: './'` Vite no toca
 * los archivos de public/, así que los reescribimos nosotros al construir.
 * Las URLs externas (https://framerusercontent.com, data:, //cdn) se conservan.
 *
 * Se opera como string literal porque todo eso vive dentro de HTML/JS minificado
 * (atributos src/srcset/poster, new URL('/x', base), fetch('/x')…), donde no hay
 * forma segura de parsear AST.
 */
const PUBLIC_ABS_PATHS = [
  '/assets/',
  '/scripts/',
  '/fonts/',
  '/framer/',
  '/favicon.svg',
  '/framer-home.html',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rutas absolutas locales -> prefijo + ruta sin la barra inicial.
const RE_ABS = new RegExp(
  String.raw`(?<![\w./-])(${PUBLIC_ABS_PATHS.map(escapeRegExp).join('|')})`,
  'g',
);

// Atributos con rutas relativas dentro de framer-home.html ("assets/...", "Recurso 4.svg").
const RE_ATTR_REL = /\b(src|srcset|poster)\s*=\s*"([^"]+)"/gi;

function rewriteAbsolute(content: string, prefix: string): string {
  return content.replace(RE_ABS, (_m, p1: string) => prefix + p1.slice(1));
}

function rewriteRelativeAttrs(
  content: string,
  prefix: string,
  exists: (rel: string) => boolean,
): string {
  return content.replace(RE_ATTR_REL, (match, attr: string, value: string) => {
    const isSrcset = attr.toLowerCase() === 'srcset';
    const parts = value.split(isSrcset ? ',' : ' ');
    let changed = false;
    const newValue = parts
      .map((part) => {
        const tokens = part.trim().split(/\s+/);
        const url = tokens[0];
        if (!url || /^(https?:|data:|blob:|\/\/|#|\/)/i.test(url)) return part;
        let decoded = url;
        try {
          decoded = decodeURIComponent(url);
        } catch {
          /* conservar el valor original */
        }
        if (!exists(decoded)) return part;
        changed = true;
        return [prefix + decoded.replace(/^\.?\//, ''), ...tokens.slice(1)].join(' ');
      })
      .join(isSrcset ? ',' : ' ');
    return changed ? `${attr}="${newValue}"` : match;
  });
}

export function rewritePublicPaths(): Plugin {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

  let base = '/';
  let publicDir = '';
  let outDir = '';

  const setBase = (resolvedBase: string) => {
    base = resolvedBase === './' ? '/' : resolvedBase;
    if (!base.startsWith('/')) base = '/' + base;
    if (!base.endsWith('/')) base += '/';
  };

  const isTextAsset = (name: string) => /\.(html?|js|mjs|css|svg|json)$/i.test(name);

  return {
    name: 'rewrite-public-paths',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      setBase(config.base);
      publicDir = path.resolve(config.root, config.publicDir || 'public');
      outDir = path.resolve(config.root, (config.build && config.build.outDir) || 'dist');
    },

    writeBundle() {
      if (base === '/') return; // despliegue en la raíz: nada que reubicar

      const copiedRoots = ['assets', 'scripts', 'fonts', 'framer'];
      const existsInPublic = (rel: string) => {
        try {
          return fs.existsSync(path.join(publicDir, rel));
        } catch {
          return false;
        }
      };

      const files: string[] = [];
      const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (isTextAsset(entry.name)) files.push(full);
        }
      };
      walk(outDir);

      let count = 0;
      for (const file of files) {
        const rel = path.relative(outDir, file).split(path.sep).join('/');
        // Solo los archivos copiados desde public/: el bundle de Vite ya usa
        // rutas correctas generadas según `base`.
        const isCopiedPublic =
          rel === 'framer-home.html' || copiedRoots.some((r) => rel.startsWith(r + '/'));
        if (!isCopiedPublic) continue;

        const text = fs.readFileSync(file, 'utf8');
        let next = rewriteAbsolute(text, base);
        if (rel === 'framer-home.html') next = rewriteRelativeAttrs(next, base, existsInPublic);
        if (next !== text) {
          fs.writeFileSync(file, next, 'utf8');
          count++;
        }
      }
      this.info(`[rewrite-public-paths] base="${base}" → ${count} archivo(s) de public/ reescritos.`);
    },
  };
}
