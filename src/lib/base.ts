/**
 * Helpers de enrutado para despliegue en subcarpeta (ej. DonWeb:
 *   public_html/boda/  ->  https://tudominio.com/boda/)
 *
 * Vite define `import.meta.env.BASE_URL` a partir de `base` en vite.config.ts.
 * Con base:'./' el mismo build funciona en la raíz del dominio o en una
 * subcarpeta, sin tocar nada más. A partir de ahí:
 *   - apiBase()   -> URL base de la API (api.php) relativa a esa base
 *   - assetUrl()  -> URL absoluta de un recurso local (/favicon.svg, /assets/...)
 *
 * Se concatenan SIEMPRE rutas terminadas en "/" (nunca `${x}/ruta`) para que
 * funcione tanto en dev ('/') como en build ('./').
 */

const trimTrailing = (s: string) => s.replace(/\/+$/, "");

/** Base pública de la app, siempre con barra inicial y final. Ej: '/' o '/boda/' */
export function publicBase(): string {
  const raw = (import.meta.env.BASE_URL as string | undefined) || "/";
  // Con base:'./' Vite emite './'; lo resolvemos contra la URL actual.
  const abs = new URL(raw, window.location.href);
  let pathname = decodeURIComponent(abs.pathname);
  if (!pathname.endsWith("/")) pathname += "/";
  return pathname;
}

/** Modo de enrutado forzado por env: 'query' usa api.php?_route=..., default PATH_INFO. */
const forcedQueryMode = (): boolean =>
  (import.meta.env.VITE_API_ROUTE_MODE as string | undefined) === "query";

/**
 * ¿Estamos en desarrollo local donde NO hay backend PHP?
 * Criterios (cualquiera basta):
 *   - import.meta.env.DEV: true solo con `vite`/dev server, NUNCA en el build
 *     de producción. Es la señal más fiable: no depende de que server.ts
 *     haya logrado inyectar window.PHP_ENABLED en el HTML.
 *   - window.PHP_ENABLED === false: respaldo por si alguien sirve el código
 *     fuente sin el flag de Vite.
 * En producción (build de DonWeb) ambas señales son falsas -> siempre api.php.
 */
declare global {
  interface Window { PHP_ENABLED?: boolean }
}

function devWithoutPhp(): boolean {
  if (import.meta.env.DEV) return true;
  return typeof window !== "undefined" && window.PHP_ENABLED === false;
}

/** Ruta PHP cruda según el modo de enrutado (PATH_INFO vs ?_route=). */
function apiPathFor(route: string): string {
  const r = route.replace(/^\//, "");
  return publicBase() + (forcedQueryMode() ? "api.php?_route=" + encodeURIComponent("/" + r) : "api.php/" + r);
}

/** Ruta Express equivalente (backend Node de server.ts, solo existe en dev). */
function expressPathFor(route: string): string {
  const r = route.replace(/^\//, "").replace(/^api\/?/, "");
  return publicBase().replace(/\/+$/, "") + "/api/" + r;
}

/**
 * URL de una ruta de API. Elige automáticamente el backend disponible:
 *   - Producción (DonWeb): siempre api.php (PATH_INFO o ?_route= según env).
 *   - Desarrollo local sin PHP: '/api/...' de server.ts, que lee los mismos
 *     datos precargados (src/data/db.json y src/data/emails.json).
 * Así se evita el error "HTTP 200 en /api.php/admin/..." cuando el dev server
 * no puede ejecutar PHP y respondía el index.html del SPA.
 */
export function apiUrl(route: string): string {
  const r = route.replace(/^\//, "");
  return devWithoutPhp() ? expressPathFor(r) : apiPathFor(r);
}

/** Base de la API para concatenar rutas (mismo criterio que apiUrl). */
export function apiBase(): string {
  if (devWithoutPhp()) return publicBase().replace(/\/+$/, "") + "/api/";
  return publicBase() + (forcedQueryMode() ? "api.php?_route=" : "api.php/");
}

/**
 * ¿El backend devumió un HTML en vez de JSON? (tp. el SPA fallback del dev
 * server respondiendo index.html con status 200 ante una ruta inexistente).
 */
function looksLikeHtml(text: string, contentType: string): boolean {
  if (contentType.includes("json")) return false;
  const head = text.slice(0, 512).toLowerCase();
  return (
    contentType.includes("html") ||
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head>")
  );
}

/**
 * fetch de solo-lectura con tolerancia a fallos de entorno:
 *   - Si la URL primaria responde JSON -> se usa tal cual.
 *   - Si falla (red, 4xx/5xx, o devolvió HTML como si fuera JSON) y hay
 *     `fallbackUrl`, se reintenta contra el backend alternativo (Express en
 *     dev / api.php en producción) ANTES de mostrar errores al usuario.
 * Así el back-office no revienta cuando el dev server local intercepta
 * `/api.php/*` o inyecta el index.html del SPA con HTTP 200.
 */
export async function fetchJsonWithFallback<T = any>(
  primaryUrl: string,
  fallbackUrl?: string,
  init: RequestInit = {}
): Promise<T> {
  const attempt = async (url: string): Promise<T> => {
    const res = await fetch(url, { cache: "no-store", ...init });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    const text = await res.text();
    if (looksLikeHtml(text, ct)) {
      throw new Error(`Respuesta no-JSON (HTML) en ${url}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`JSON inválido en ${url}`);
    }
  };

  try {
    return await attempt(primaryUrl);
  } catch (errPrimary) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      console.warn(
        `[api] "${primaryUrl}" falló (${String(errPrimary)}); reintentando vía "${fallbackUrl}".`
      );
      return await attempt(fallbackUrl);
    }
    throw errPrimary;
  }
}

/** Par (URL primaria, URL alternativa) para una misma ruta lógica. */
export function apiUrlPair(route: string): { primary: string; fallback: string } {
  const r = route.replace(/^\//, "");
  const php = apiPathFor(r);
  const express = expressPathFor(r);
  // En dev sin PHP lo primario es Express; en producción lo primario es PHP.
  return devWithoutPhp()
    ? { primary: express, fallback: php }
    : { primary: php, fallback: express };
}

/**
 * URL de la vista RSVP local (misma app, query ?view=rsvp). Sustituye al link
 * externo hardcodeado por Framer (https://bodamariysimon.online/form) en el
 * botón "Confirmar asistencia" del header.
 */
export function rsvpViewUrl(): string {
  const base = publicBase();
  const idx = window.location.href.indexOf(base);
  // Página raíz de la app (index.html) + ?view=rsvp, aunque estemos en /boda/.
  const root = idx >= 0 ? window.location.href.slice(0, idx + base.length) : base;
  return root + "?view=rsvp";
}

/** URL de un recurso estático local ("/favicon.svg", "/assets/images/x.gif", ...) */
export function assetUrl(path: string): string {
  return publicBase() + trimTrailing(path).replace(/^\/+/, "");
}

/** URL de la home de Framer (iframe) conservando su cache-buster. */
export function framerHomeUrl(): string {
  return assetUrl("/framer-home.html") + "?revision=20261104-device-video-loading";
}

/**
 * Reescribe URLs de recursos locales que viven DENTRO de la página iframeada
 * (public/framer-home.html usa rutas absolutas "/assets/..."). En una
 * subcarpeta esas rutas apuntarían fuera de la app, así que se re-ubican a la
 * base de la app. Las externas (https://, data:, //cdn) se dejan intactas.
 */
export function rewriteLocalAssetUrl(src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|\/\/|#)/i.test(src)) return src;
  if (src.startsWith("/")) return assetUrl(src);
  // relativas ("assets/images/x.png"): resolver contra la carpeta de la app,
  // ya que framer-home.html se sirve desde ahí.
  return publicBase() + src.replace(/^\.?\//, "");
}
