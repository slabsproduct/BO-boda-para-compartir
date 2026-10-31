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

async function startServer() {
  ensureDb();

  // AJUSTE 2: Puerto dinámico (Cloud Run usa 8080, local usa 5000)
  const isProduction = process.env.NODE_ENV === "production";
  const PORT = Number(process.env.PORT ?? 5000);

  // --- Desarrollo local: detectar si existe el binario php para servir api.php
  // (si no hay PHP, el frontend usa automáticamente las rutas /api/* de Express,
  // que leen los mismos datos: src/data/db.json y src/data/emails.json).
  let phpAvailable = false;
  let phpServerUrl: URL | null = null;
  if (!isProduction) {
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
      console.log("ℹ️  PHP no está disponible en este sistema; el frontend usará las rutas /api/* de server.ts (mismos datos JSON).");
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

    const invitation = readInvitations().find(i => i.code.toUpperCase() === code) || null;

    if (invitation) {
      invitation.guests = guests;
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

      res.json({ success: true, invitation });
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
    const { code, names, passes } = req.body;
    if (!code || !names || !passes) return res.status(400).json({ success: false, error: "Faltan datos." });

    const guests: Guest[] = Array.from({ length: parseInt(passes, 10) }, (_, idx) => ({
      name: idx === 0 ? names.split(" & ")[0] : `Acompañante ${idx}`,
      isAttending: true,
      dietaryRestrictions: "none"
    }));

    const newInvitation: Invitation = {
      code: code.trim().toUpperCase(),
      names: names.trim(),
      passes: parseInt(passes, 10),
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
        updatedGuests.push({ name: `Acompañante ${i + 1}`, isAttending: true, dietaryRestrictions: "none" });
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
      appType: "custom", // custom: server.ts maneja las rutas; no se sirve index.html en /api.php/*
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

    // Inyecta window.PHP_ENABLED para que base.ts elija api.php o /api/* sin sondas.
    vite.middlewares.use((req, res, next) => {
      const url = (req as any).originalUrl || req.url || "";
      if (url === "/" || url.startsWith("/?") || url.startsWith("/index.html")) {
        const origEnd = res.end.bind(res);
        let patched = false;
        (res as any).end = ((chunk?: any, ...args: any[]): any => {
          if (!patched && typeof chunk === "string" && chunk.includes("<head>")) {
            patched = true;
            chunk = chunk.replace(
              "<head>",
              `<head><script>window.PHP_ENABLED=${phpAvailable};</script>`
            );
          }
          return origEnd(chunk, ...args);
        });
      }
      next();
    });

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