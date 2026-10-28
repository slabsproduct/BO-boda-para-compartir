import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import {
  initSqliteDatabase,
  getInvitationsSqlite,
  getInvitationByCodeSqlite,
  saveInvitationSqlite,
  deleteInvitationSqlite,
  generateSqlDump
} from "./src/db/sqlite";

// ... (TODAS TUS INTERFACES Guest, Invitation, SimulatedEmail se quedan IGUAL) ...
interface Guest {
  name: string;
  isAttending: boolean;
  dietaryRestrictions: string;
  notes?: string;
  needsTransport?: boolean;
  transportLocation?: string;
}

interface Invitation {
  code: string;
  names: string;
  passes: number;
  status: 'pending' | 'confirmed' | 'declined';
  updatedAt?: string;
  youtubeEmail?: string;
  guests: Guest[];
}

interface SimulatedEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
}

// AJUSTE 1: Rutas absolutas más seguras para contenedores Docker
const DATA_DIR = path.join(process.cwd(), "src", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SQLITE_FILE = path.join(DATA_DIR, "wedding.sqlite");
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

// ... (TUS FUNCIONES readInvitations, writeInvitations, readEmails, writeEmail se quedan IGUAL) ...
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
  await initSqliteDatabase().catch(err => console.error("SQLite init error:", err));

  const app = express();
  // AJUSTE 2: Puerto dinámico (Cloud Run usa 8080, local usa 5000)
  const PORT = Number(process.env.PORT ?? 5000);

  app.use(express.json());

  // ... (TODAS TUS RUTAS /api/... se quedan EXACTAMENTE IGUAL, no las toques) ...
  app.get("/api/admin/rsvps", async (req, res) => {
    try {
      const sqliteInvs = await getInvitationsSqlite();
      if (sqliteInvs && sqliteInvs.length > 0) return res.json(sqliteInvs);
    } catch (e) { console.warn("Falling back to json db", e); }
    res.json(readInvitations());
  });

  app.get("/api/rsvp/:code", async (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    try {
      const sqliteInv = await getInvitationByCodeSqlite(code);
      if (sqliteInv) return res.json({ success: true, invitation: sqliteInv });
    } catch (e) { console.warn("SQLite query fallback", e); }

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

    let invitation: Invitation | null = null;
    try { invitation = await getInvitationByCodeSqlite(code); } catch (e) { console.warn("SQLite get error", e); }

    if (!invitation) {
      invitation = readInvitations().find(i => i.code.toUpperCase() === code) || null;
    }

    if (invitation) {
      invitation.guests = guests;
      invitation.status = status;
      invitation.youtubeEmail = typeof youtubeEmail === "string" && youtubeEmail.trim() ? youtubeEmail.trim() : invitation.youtubeEmail;
      invitation.updatedAt = new Date().toISOString();

      await saveInvitationSqlite(invitation).catch(err => console.error("SQLite save error", err));

      const invitations = readInvitations();
      const index = invitations.findIndex(i => i.code.toUpperCase() === code);
      if (index !== -1) invitations[index] = invitation;
      else invitations.push(invitation);
      writeInvitations(invitations);

      const attendingCount = guests.filter((g: any) => g.isAttending).length;
      const emailBody = `¡Hola ${invitation.names}!\n\nHemos recibido tu confirmación...\n\nCon cariño,\nMari & Simón 💍`;

      writeEmail({
        id: Math.random().toString(36).substr(2, 9),
        to: `invitados_${code.toLowerCase()}@boda-marisimon.com`,
        subject: `Confirmación de RSVP: ${invitation.names}`,
        body: emailBody,
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, invitation });
    } else {
      res.status(404).json({ success: false, error: "Invitación no encontrada." });
    }
  });

  app.get("/api/admin/db/status", async (req, res) => {
    try {
      const sqliteInvs = await getInvitationsSqlite();
      const sqliteExists = fs.existsSync(SQLITE_FILE);
      res.json({
        engine: "SQLite 3",
        sqliteFile: SQLITE_FILE,
        sqliteSize: sqliteExists ? (fs.statSync(SQLITE_FILE).size / 1024).toFixed(1) + " KB" : "0 KB",
        totalInvitations: sqliteInvs.length
      });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get("/api/admin/db/download-sqlite", (req, res) => {
    if (fs.existsSync(SQLITE_FILE)) res.download(SQLITE_FILE, "wedding.sqlite");
    else res.status(404).json({ error: "Archivo SQLite no encontrado." });
  });

  app.get("/api/admin/db/download-sql", async (req, res) => {
    try {
      const sql = await generateSqlDump();
      res.setHeader("Content-Type", "application/sql");
      res.setHeader("Content-Disposition", 'attachment; filename="boda_donweb_dump.sql"');
      res.send(sql);
    } catch (err) { res.status(500).json({ error: String(err) }); }
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

    await saveInvitationSqlite(newInvitation).catch(err => console.error("SQLite save error", err));
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

    if (updatedCode !== targetCode) await deleteInvitationSqlite(targetCode).catch(() => {});
    await saveInvitationSqlite(updatedInvitation).catch(err => console.error("SQLite save error", err));

    invitations[index] = updatedInvitation;
    writeInvitations(invitations);
    res.json({ success: true, invitation: updatedInvitation });
  });

  app.delete("/api/admin/rsvps/:code", async (req, res) => {
    const code = req.params.code.toUpperCase();
    await deleteInvitationSqlite(code).catch(err => console.error("SQLite delete error", err));
    writeInvitations(readInvitations().filter(i => i.code.toUpperCase() !== code));
    res.json({ success: true });
  });

  // Servir archivos estáticos públicos (favicon, etc.)
  app.use(express.static(path.join(process.cwd(), "public")));

  // AJUSTE 3: Lógica de producción vs desarrollo más robusta para Cloud Run
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    console.log("🛠️  Iniciando en modo DESARROLLO con Vite...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
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