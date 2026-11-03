import express from "express";
import path from "path";
import fs from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import net from "net";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import type { Invitation, Guest, SimulatedEmail } from "./src/types";

let shuttingDown = false;
let phpChild: ChildProcess | null = null;

// DATA_DIR configurable via env (Docker/Cloud Run: /app/data); por defecto src/data en dev local
const DATA_DIR = process.env.BODA_DATA_DIR ?? path.join(process.cwd(), "src", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const EMAILS_PATH = path.join(DATA_DIR, "emails.json");

// Helper to ensure database files exist
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(DB_PATH)) {
    const defaultData = {
      invitations: [
        {
          code: "MARISIMON",
          names: "Mariángel & Simón",
          passes: 2,
          status: "pending",
          guests: [
            { name: "Mariángel", isAttending: true, dietaryRestrictions: "none" },
            { name: "Simón", isAttending: true, dietaryRestrictions: "none" }
          ]
        }
      ]
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2), "utf8");
  }

  if (!fs.existsSync(EMAILS_PATH)) {
    fs.writeFileSync(EMAILS_PATH, JSON.stringify([], null, 2), "utf8");
  }
}

function readInvitations(): Invitation[] {
  ensureDb();
  try {
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data).invitations || [];
  } catch (err) {
    console.error("Error reading db.json", err);
    return [];
  }
}

function writeInvitations(invitations: Invitation[]) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify({ invitations }, null, 2), "utf8");
}

function readEmails(): SimulatedEmail[] {
  ensureDb();
  try {
    const data = fs.readFileSync(EMAILS_PATH, "utf8");
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

function writeEmail(email: SimulatedEmail) {
  const emails = readEmails();
  emails.unshift(email);
  fs.writeFileSync(EMAILS_PATH, JSON.stringify(emails, null, 2), "utf8");
}

function escapeEmailHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

async function sendBrevoRsvpNotification(invitation: Invitation): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.BODA_BREVO_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };

  const statusLabel = invitation.status === "declined"
    ? "Rechazada"
    : invitation.status === "confirmed" ? "Confirmada" : "Pendiente";
  const guestRows = invitation.guests.map((guest) => {
    const dietary = guest.dietaryRestrictions && guest.dietaryRestrictions !== "none"
      ? guest.dietaryRestrictions : "Ninguna";
    const transport = guest.needsTransport
      ? "Sí — desde la boda en Potrerillos hasta Mendoza Capital"
      : "No";
    return `<tr><td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(guest.name)}</td>`
      + `<td style="padding:8px;border:1px solid #ddd">${guest.isAttending ? "Sí" : "No"}</td>`
      + `<td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(dietary)}</td>`
      + `<td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(transport)}</td>`
      + `<td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(guest.notes || "Sin comentarios")}</td></tr>`;
  }).join("");
  const htmlContent = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#363B1F">`
    + `<h2>Nueva respuesta de invitación: ${escapeEmailHtml(statusLabel)}</h2>`
    + `<p><strong>Código:</strong> ${escapeEmailHtml(invitation.code)}<br>`
    + `<strong>Invitación:</strong> ${escapeEmailHtml(invitation.names)}<br>`
    + `<strong>Pases:</strong> ${invitation.passes}</p>`
    + `<table style="border-collapse:collapse;width:100%"><thead><tr>`
    + `<th style="padding:8px;border:1px solid #ddd;text-align:left">Invitado</th>`
    + `<th style="padding:8px;border:1px solid #ddd;text-align:left">Asiste</th>`
    + `<th style="padding:8px;border:1px solid #ddd;text-align:left">Restricciones</th>`
    + `<th style="padding:8px;border:1px solid #ddd;text-align:left">Transporte</th>`
    + `<th style="padding:8px;border:1px solid #ddd;text-align:left">Comentarios</th>`
    + `</tr></thead><tbody>${guestRows}</tbody></table>`
    + (invitation.youtubeEmail
      ? `<p><strong>Email para el live:</strong> ${escapeEmailHtml(invitation.youtubeEmail)}</p>` : "")
    + `<p><strong>Actualizado:</strong> ${escapeEmailHtml(invitation.updatedAt || new Date().toISOString())}</p>`
    + `</body></html>`;
  const textGuests = invitation.guests.map((guest) => {
    const dietary = guest.dietaryRestrictions && guest.dietaryRestrictions !== "none"
      ? guest.dietaryRestrictions : "Ninguna";
    const transport = guest.needsTransport
      ? "Sí — desde la boda en Potrerillos hasta Mendoza Capital"
      : "No";
    return `- ${guest.name}: asistencia ${guest.isAttending ? "sí" : "no"}; restricciones: ${dietary}; transporte: ${transport}; comentarios: ${guest.notes || "Sin comentarios"}`;
  }).join("\n");
  const textContent = `Nueva respuesta de invitación: ${statusLabel}\n`
    + `Código: ${invitation.code}\nInvitación: ${invitation.names}\nPases: ${invitation.passes}\n\n`
    + textGuests
    + (invitation.youtubeEmail ? `\n\nEmail para el live: ${invitation.youtubeEmail}` : "")
    + `\n\nActualizado: ${invitation.updatedAt || new Date().toISOString()}`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Mari & Simón", email: "bodamariysimon@gmail.com" },
        to: [{ email: "pmariangel98@gmail.com" }],
        subject: `Nueva respuesta RSVP: ${statusLabel}`,
        htmlContent,
        textContent,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      console.error(`[brevo] El API respondió HTTP ${response.status}: ${details}`);
      return { sent: false, reason: "api_rejected" };
    }
    return { sent: true };
  } catch (error) {
    console.error("[brevo] No se pudo enviar el aviso RSVP.", error);
    return { sent: false, reason: "request_failed" };
  }
}

async function startServer() {
  ensureDb();

  // AJUSTE 2: Puerto dinámico (Cloud Run usa 8080, local usa 5000)
  const isProduction = process.env.NODE_ENV === "production";
  const PORT = Number(process.env.PORT ?? 5000);

  // --- Desarrollo local: usar SIEMPRE las rutas /api/* de Express, que leen
  // los mismos datos precargados (src/data/db.json y src/data/emails.json).
  // El backend PHP (api.php) solo corre en producción (DonWeb/cPanel). Antes
  // intentábamos levantar un `php -S` embebido en dev, pero si el binario php
  // no está instalado (o falla al arrancar) el admin crasheaba con errores
  // tipo "HTTP 200 en /api.php/admin/emails". Ahora eso no ocurre nunca.
  let phpAvailable = false;
  let phpServerUrl: URL | null = null;
  if (!isProduction && process.env.BODA_DEV_PHP === "1") {
    // Modo opcional SOLO para quien quiera probar api.php localmente:
    // exportá BODA_DEV_PHP=1 y tené PHP instalado. Si no, se usa Express.
    try {
      const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
      phpAvailable = probe.status === 0;
    } catch {
      phpAvailable = false;
    }

    if (phpAvailable) {
      // Puerto libre efímero para el servidor PHP embebido.
      const port = await new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const p = (srv.address() as net.AddressInfo).port;
          srv.close(() => resolve(p));
        });
      });
      const docRoot = process.cwd(); // api.php vive en la raíz del proyecto
      phpChild = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", docRoot], {
        cwd: docRoot,
        env: { ...process.env, BODA_DATA_DIR: DATA_DIR },
        stdio: ["ignore", "ignore", "inherit"],
      });
      phpChild.on("exit", (code) => {
        if (!shuttingDown) console.warn(`⚠️  Servidor PHP embebido terminó (code ${code}); el admin usará /api/* de Express.`);
        phpAvailable = false;
        phpChild = null;
      });
      phpServerUrl = new URL(`http://127.0.0.1:${port}`);
      // Esperar a que PHP levante (máx. ~3s) con una sonda real.
      const deadline = Date.now() + 3000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(phpServerUrl.toString());
          if (r.ok || r.status === 404) { up = true; break; }
        } catch {
          await new Promise((res) => setTimeout(res, 150));
        }
      }
      if (!up) {
        console.warn("⚠️  No se pudo iniciar el servidor PHP embebido; usando /api/* de Express.");
        phpAvailable = false;
        phpChild?.kill();
        phpChild = null;
      } else {
        console.log(`🐘 Backend PHP embebido disponible en ${phpServerUrl.toString()} (api.php)`);
      }
    } else {
      console.log("ℹ️  Dev local: el frontend usará las rutas /api/* de server.ts (mismos datos JSON precargados).");
    }
  }

  const app = express();

  app.use(express.json());
  app.get("/api/admin/rsvps", (req, res) => {
    res.json(readInvitations());
  });

  app.get("/api/rsvp/:code", (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const invitation = readInvitations().find(i => i.code.toUpperCase() === code);
    if (invitation) {
      res.json({ success: true, invitation });
    } else {
      res.status(404).json({ success: false, error: "El código de invitación no es válido." });
    }
  });

  app.post("/api/rsvp/:code", async (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const { guests, status, youtubeEmail } = req.body;

    if (!guests || !Array.isArray(guests)) {
      return res.status(400).json({ success: false, error: "Datos de invitados inválidos." });
    }
    if (status !== "confirmed" && status !== "declined") {
      return res.status(400).json({ success: false, error: "Estado de confirmación inválido." });
    }

    const invitation = readInvitations().find(i => i.code.toUpperCase() === code) || null;

    if (invitation) {
      invitation.guests = invitation.guests.map((guest, index) => ({
        ...guest,
        ...guests[index],
        name: guest.name
      }));
      invitation.status = status;
      invitation.youtubeEmail = typeof youtubeEmail === "string" && youtubeEmail.trim() ? youtubeEmail.trim() : invitation.youtubeEmail;
      invitation.updatedAt = new Date().toISOString();

      const invitations = readInvitations();
      const index = invitations.findIndex(i => i.code.toUpperCase() === code);
      if (index !== -1) invitations[index] = invitation;
      else invitations.push(invitation);
      writeInvitations(invitations);

      const attendingCount = guests.filter((g: any) => g.isAttending).length;
      const emailBody = `¡Hola ${invitation.names}!\n\nHemos recibido tu confirmación...\n\nCon cariño,\nMari & Simón 💍`;

      writeEmail({
        to: `invitados_${code.toLowerCase()}@boda-marisimon.com`,
        toName: invitation.names,
        subject: `Confirmación de RSVP: ${invitation.names}`,
        body: emailBody,
        timestamp: new Date().toISOString()
      });

      const notification = await sendBrevoRsvpNotification(invitation);
      if (!notification.sent) {
        console.error(`[rsvp] Se guardó la respuesta ${code}, pero no se envió el aviso Brevo (${notification.reason}).`);
      }
      res.json({ success: true, invitation, notification });
    } else {
      res.status(404).json({ success: false, error: "Invitación no encontrada." });
    }
  });

  // Estado de la base de datos: motor único JSON atómico (compatible con cPanel/DonWeb vía api.php)
  app.get("/api/admin/db/status", (req, res) => {
    try {
      const exists = fs.existsSync(DB_PATH);
      res.json({
        engine: "JSON atómico",
        dbFile: DB_PATH,
        dbSize: exists ? (fs.statSync(DB_PATH).size / 1024).toFixed(1) + " KB" : "0 KB",
        totalInvitations: readInvitations().length
      });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // Descarga de respaldo: volcado completo de db.json
  app.get("/api/admin/db/download-backup", (req, res) => {
    if (fs.existsSync(DB_PATH)) res.download(DB_PATH, "db.json");
    else res.status(404).json({ error: "Archivo de datos no encontrado." });
  });

  app.get("/api/admin/emails", (req, res) => res.json(readEmails()));
  app.delete("/api/admin/emails", (req, res) => {
    fs.writeFileSync(EMAILS_PATH, JSON.stringify([], null, 2), "utf8");
    res.json({ success: true });
  });

  app.post("/api/admin/rsvps", async (req, res) => {
    const { code, names, passes, guests: submittedGuests } = req.body;
    if (!code || !names || !passes) return res.status(400).json({ success: false, error: "Faltan datos." });

    const passCount = parseInt(passes, 10);
    if (!Number.isInteger(passCount) || passCount < 1) {
      return res.status(400).json({ success: false, error: "La cantidad de pases no es válida." });
    }
    if (submittedGuests !== undefined && (
      !Array.isArray(submittedGuests) ||
      submittedGuests.length !== passCount ||
      submittedGuests.some((guest: unknown) =>
        !guest || typeof guest !== "object" || !("name" in guest) ||
        typeof guest.name !== "string" || !guest.name.trim()
      )
    )) {
      return res.status(400).json({ success: false, error: "Ingresá el nombre completo de cada invitado." });
    }

    const guests: Guest[] = Array.from({ length: passCount }, (_, idx) => ({
      name: submittedGuests
        ? submittedGuests[idx].name.trim()
        : idx === 0 ? names.split(" & ")[0] : `Acompañante ${idx}`,
      isAttending: null,
      dietaryRestrictions: "none"
    }));

    const newInvitation: Invitation = {
      code: code.trim().toUpperCase(),
      names: names.trim(),
      passes: passCount,
      status: "pending",
      guests,
      updatedAt: new Date().toISOString()
    };

    const invitations = readInvitations();
    const existingIndex = invitations.findIndex(i => i.code.toUpperCase() === newInvitation.code);
    if (existingIndex !== -1) invitations[existingIndex] = newInvitation;
    else invitations.push(newInvitation);
    writeInvitations(invitations);

    res.json({ success: true, invitation: newInvitation });
  });

  app.put("/api/admin/rsvps/:code", async (req, res) => {
    const targetCode = req.params.code.toUpperCase();
    const { code, names, passes, status, guests } = req.body;
    const invitations = readInvitations();
    const index = invitations.findIndex(i => i.code.toUpperCase() === targetCode);

    if (index === -1) return res.status(404).json({ success: false, error: "No encontrada." });

    const updatedCode = (code ? code.trim().toUpperCase() : targetCode);
    if (updatedCode !== targetCode && invitations.some((inv, idx) => idx !== index && inv.code.toUpperCase() === updatedCode)) {
      return res.status(400).json({ success: false, error: "Código en uso." });
    }

    const current = invitations[index];
    const newPasses = passes !== undefined ? parseInt(passes, 10) : current.passes;
    let updatedGuests: Guest[] = guests || current.guests || [];
    
    if (updatedGuests.length < newPasses) {
      for (let i = updatedGuests.length; i < newPasses; i++) {
        updatedGuests.push({ name: `Acompañante ${i + 1}`, isAttending: null, dietaryRestrictions: "none" });
      }
    } else if (updatedGuests.length > newPasses) {
      updatedGuests = updatedGuests.slice(0, newPasses);
    }

    const updatedInvitation: Invitation = {
      ...current, code: updatedCode, names: names !== undefined ? names.trim() : current.names,
      passes: newPasses, status: status !== undefined ? status : current.status,
      guests: updatedGuests, updatedAt: new Date().toISOString()
    };

    invitations[index] = updatedInvitation;
    writeInvitations(invitations);
    res.json({ success: true, invitation: updatedInvitation });
  });

  app.delete("/api/admin/rsvps/:code", (req, res) => {
    const code = req.params.code.toUpperCase();
    writeInvitations(readInvitations().filter(i => i.code.toUpperCase() !== code));
    res.json({ success: true });
  });

  // Servir archivos estáticos públicos (favicon, etc.)
  app.use(express.static(path.join(process.cwd(), "public")));

  // AJUSTE 3: Lógica de producción vs desarrollo más robusta para Cloud Run

  if (!isProduction) {
    console.log("🛠️  Iniciando en modo DESARROLLO con Vite...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      // 'spa': Vite sirve index.html en / y hace fallback de las rutas del
      // cliente. Las rutas /api/* y el proxy /api.php se registraron ANTES en
      // Express, así que nunca llegan a este fallback (no hay error 404/HTML).
      appType: "spa",
    });

    // Proxy dev: cualquier request a /api.php[/...] se reenvía al servidor PHP
    // embebido (si está disponible). Así el frontend usa exactamente la misma
    // URL ('/api.php/admin/emails') en dev local que en DonWeb.
    app.use("/api.php", async (req, res) => {
      if (!phpServerUrl) {
        return res.status(502).json({
          error: "PHP no disponible en este sistema. El frontend debe usar /api/* de Express.",
        });
      }
      try {
        const target = new URL(phpServerUrl.toString());
        target.pathname = "/api.php";
        target.search = req.originalUrl.includes("?")
          ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
          : "";
        const init: RequestInit = { method: req.method };
        if (["POST", "PUT", "DELETE"].includes(req.method)) {
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify(req.body ?? {});
        }
        const upstream = await fetch(target, init);
        res.status(upstream.status);
        const ct = upstream.headers.get("content-type");
        if (ct) res.set("content-type", ct);
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.status(502).json({ error: String(err) });
      }
    });

    // Nota: en dev el frontend SIEMPRE usa /api/* de Express (base.ts detecta
    // import.meta.env.DEV), así que no hace falta inyectar window.PHP_ENABLED
    // ni ningún hack de middlewares aquí. El proxy /api.php de arriba queda
    // disponible solo por si se levanta PHP manualmente con BODA_DEV_PHP=1.

    app.use(vite.middlewares);
  } else {
    console.log("🚀 Iniciando en modo PRODUCCIÓN sirviendo carpeta 'dist'...");
    const distPath = path.join(process.cwd(), "dist");
    
    // Servir archivos estáticos generados por Vite
    app.use(express.static(distPath));
    
    // Catch-all para que React/Vite maneje las rutas
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // AJUSTE 4: Escuchar en 0.0.0.0 (Obligatorio para Docker/Cloud Run)
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Servidor corriendo exitosamente en http://0.0.0.0:${PORT}`);
    console.log(`📦 Entorno: ${isProduction ? "PRODUCCIÓN" : "DESARROLLO"}`);
  });
}

startServer();