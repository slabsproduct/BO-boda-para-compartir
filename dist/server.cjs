var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_net = __toESM(require("net"), 1);
var import_vite = require("vite");
var shuttingDown = false;
var phpChild = null;
var DATA_DIR = process.env.BODA_DATA_DIR ?? import_path.default.join(process.cwd(), "src", "data");
var DB_PATH = import_path.default.join(DATA_DIR, "db.json");
var EMAILS_PATH = import_path.default.join(DATA_DIR, "emails.json");
function ensureDb() {
  if (!import_fs.default.existsSync(DATA_DIR)) {
    import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!import_fs.default.existsSync(DB_PATH)) {
    const defaultData = {
      invitations: [
        {
          code: "MARISIMON",
          names: "Mari\xE1ngel & Sim\xF3n",
          passes: 2,
          status: "pending",
          guests: [
            { name: "Mari\xE1ngel", isAttending: true, dietaryRestrictions: "none" },
            { name: "Sim\xF3n", isAttending: true, dietaryRestrictions: "none" }
          ]
        }
      ]
    };
    import_fs.default.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2), "utf8");
  }
  if (!import_fs.default.existsSync(EMAILS_PATH)) {
    import_fs.default.writeFileSync(EMAILS_PATH, JSON.stringify([], null, 2), "utf8");
  }
}
function readInvitations() {
  ensureDb();
  try {
    const data = import_fs.default.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data).invitations || [];
  } catch (err) {
    console.error("Error reading db.json", err);
    return [];
  }
}
function writeInvitations(invitations) {
  ensureDb();
  import_fs.default.writeFileSync(DB_PATH, JSON.stringify({ invitations }, null, 2), "utf8");
}
function readEmails() {
  ensureDb();
  try {
    const data = import_fs.default.readFileSync(EMAILS_PATH, "utf8");
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}
function writeEmail(email) {
  const emails = readEmails();
  emails.unshift(email);
  import_fs.default.writeFileSync(EMAILS_PATH, JSON.stringify(emails, null, 2), "utf8");
}
function escapeEmailHtml(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}
async function sendBrevoRsvpNotification(invitation) {
  const apiKey = process.env.BODA_BREVO_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  const statusLabel = invitation.status === "declined" ? "Rechazada" : invitation.status === "confirmed" ? "Confirmada" : "Pendiente";
  const guestRows = invitation.guests.map((guest) => {
    const dietary = guest.dietaryRestrictions && guest.dietaryRestrictions !== "none" ? guest.dietaryRestrictions : "Ninguna";
    const transport = guest.needsTransport ? "S\xED \u2014 desde la boda en Potrerillos hasta Mendoza Capital" : "No";
    return `<tr><td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(guest.name)}</td><td style="padding:8px;border:1px solid #ddd">${guest.isAttending ? "S\xED" : "No"}</td><td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(dietary)}</td><td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(transport)}</td><td style="padding:8px;border:1px solid #ddd">${escapeEmailHtml(guest.notes || "Sin comentarios")}</td></tr>`;
  }).join("");
  const htmlContent = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#363B1F"><h2>Nueva respuesta de invitaci\xF3n: ${escapeEmailHtml(statusLabel)}</h2><p><strong>C\xF3digo:</strong> ${escapeEmailHtml(invitation.code)}<br><strong>Invitaci\xF3n:</strong> ${escapeEmailHtml(invitation.names)}<br><strong>Pases:</strong> ${invitation.passes}</p><table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:8px;border:1px solid #ddd;text-align:left">Invitado</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Asiste</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Restricciones</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Transporte</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Comentarios</th></tr></thead><tbody>${guestRows}</tbody></table>` + (invitation.youtubeEmail ? `<p><strong>Email para el live:</strong> ${escapeEmailHtml(invitation.youtubeEmail)}</p>` : "") + `<p><strong>Actualizado:</strong> ${escapeEmailHtml(invitation.updatedAt || (/* @__PURE__ */ new Date()).toISOString())}</p></body></html>`;
  const textGuests = invitation.guests.map((guest) => {
    const dietary = guest.dietaryRestrictions && guest.dietaryRestrictions !== "none" ? guest.dietaryRestrictions : "Ninguna";
    const transport = guest.needsTransport ? "S\xED \u2014 desde la boda en Potrerillos hasta Mendoza Capital" : "No";
    return `- ${guest.name}: asistencia ${guest.isAttending ? "s\xED" : "no"}; restricciones: ${dietary}; transporte: ${transport}; comentarios: ${guest.notes || "Sin comentarios"}`;
  }).join("\n");
  const textContent = `Nueva respuesta de invitaci\xF3n: ${statusLabel}
C\xF3digo: ${invitation.code}
Invitaci\xF3n: ${invitation.names}
Pases: ${invitation.passes}

` + textGuests + (invitation.youtubeEmail ? `

Email para el live: ${invitation.youtubeEmail}` : "") + `

Actualizado: ${invitation.updatedAt || (/* @__PURE__ */ new Date()).toISOString()}`;
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "Mari & Sim\xF3n", email: "bodamariysimon@gmail.com" },
        to: [{ email: "pmariangel98@gmail.com" }],
        subject: `Nueva respuesta RSVP: ${statusLabel}`,
        htmlContent,
        textContent
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      console.error(`[brevo] El API respondi\xF3 HTTP ${response.status}: ${details}`);
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
  const isProduction = process.env.NODE_ENV === "production";
  const PORT = Number(process.env.PORT ?? 5e3);
  let phpAvailable = false;
  let phpServerUrl = null;
  if (!isProduction && process.env.BODA_DEV_PHP === "1") {
    try {
      const probe = (0, import_child_process.spawnSync)("php", ["-v"], { encoding: "utf8" });
      phpAvailable = probe.status === 0;
    } catch {
      phpAvailable = false;
    }
    if (phpAvailable) {
      const port = await new Promise((resolve, reject) => {
        const srv = import_net.default.createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
      });
      const docRoot = process.cwd();
      phpChild = (0, import_child_process.spawn)("php", ["-S", `127.0.0.1:${port}`, "-t", docRoot], {
        cwd: docRoot,
        env: { ...process.env, BODA_DATA_DIR: DATA_DIR },
        stdio: ["ignore", "ignore", "inherit"]
      });
      phpChild.on("exit", (code) => {
        if (!shuttingDown) console.warn(`\u26A0\uFE0F  Servidor PHP embebido termin\xF3 (code ${code}); el admin usar\xE1 /api/* de Express.`);
        phpAvailable = false;
        phpChild = null;
      });
      phpServerUrl = new URL(`http://127.0.0.1:${port}`);
      const deadline = Date.now() + 3e3;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(phpServerUrl.toString());
          if (r.ok || r.status === 404) {
            up = true;
            break;
          }
        } catch {
          await new Promise((res) => setTimeout(res, 150));
        }
      }
      if (!up) {
        console.warn("\u26A0\uFE0F  No se pudo iniciar el servidor PHP embebido; usando /api/* de Express.");
        phpAvailable = false;
        phpChild?.kill();
        phpChild = null;
      } else {
        console.log(`\u{1F418} Backend PHP embebido disponible en ${phpServerUrl.toString()} (api.php)`);
      }
    } else {
      console.log("\u2139\uFE0F  Dev local: el frontend usar\xE1 las rutas /api/* de server.ts (mismos datos JSON precargados).");
    }
  }
  const app = (0, import_express.default)();
  app.use(import_express.default.json());
  app.get("/api/admin/rsvps", (req, res) => {
    res.json(readInvitations());
  });
  app.get("/api/rsvp/:code", (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const invitation = readInvitations().find((i) => i.code.toUpperCase() === code);
    if (invitation) {
      res.json({ success: true, invitation });
    } else {
      res.status(404).json({ success: false, error: "El c\xF3digo de invitaci\xF3n no es v\xE1lido." });
    }
  });
  app.post("/api/rsvp/:code", async (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const { guests, status, youtubeEmail } = req.body;
    if (!guests || !Array.isArray(guests)) {
      return res.status(400).json({ success: false, error: "Datos de invitados inv\xE1lidos." });
    }
    if (status !== "confirmed" && status !== "declined") {
      return res.status(400).json({ success: false, error: "Estado de confirmaci\xF3n inv\xE1lido." });
    }
    const invitation = readInvitations().find((i) => i.code.toUpperCase() === code) || null;
    if (invitation) {
      invitation.guests = invitation.guests.map((guest, index2) => ({
        ...guest,
        ...guests[index2],
        name: guest.name
      }));
      invitation.status = status;
      invitation.youtubeEmail = typeof youtubeEmail === "string" && youtubeEmail.trim() ? youtubeEmail.trim() : invitation.youtubeEmail;
      invitation.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const invitations = readInvitations();
      const index = invitations.findIndex((i) => i.code.toUpperCase() === code);
      if (index !== -1) invitations[index] = invitation;
      else invitations.push(invitation);
      writeInvitations(invitations);
      const attendingCount = guests.filter((g) => g.isAttending).length;
      const emailBody = `\xA1Hola ${invitation.names}!

Hemos recibido tu confirmaci\xF3n...

Con cari\xF1o,
Mari & Sim\xF3n \u{1F48D}`;
      writeEmail({
        to: `invitados_${code.toLowerCase()}@boda-marisimon.com`,
        toName: invitation.names,
        subject: `Confirmaci\xF3n de RSVP: ${invitation.names}`,
        body: emailBody,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const notification = await sendBrevoRsvpNotification(invitation);
      if (!notification.sent) {
        console.error(`[rsvp] Se guard\xF3 la respuesta ${code}, pero no se envi\xF3 el aviso Brevo (${notification.reason}).`);
      }
      res.json({ success: true, invitation, notification });
    } else {
      res.status(404).json({ success: false, error: "Invitaci\xF3n no encontrada." });
    }
  });
  app.get("/api/admin/db/status", (req, res) => {
    try {
      const exists = import_fs.default.existsSync(DB_PATH);
      res.json({
        engine: "JSON at\xF3mico",
        dbFile: DB_PATH,
        dbSize: exists ? (import_fs.default.statSync(DB_PATH).size / 1024).toFixed(1) + " KB" : "0 KB",
        totalInvitations: readInvitations().length
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.get("/api/admin/db/download-backup", (req, res) => {
    if (import_fs.default.existsSync(DB_PATH)) res.download(DB_PATH, "db.json");
    else res.status(404).json({ error: "Archivo de datos no encontrado." });
  });
  app.get("/api/admin/emails", (req, res) => res.json(readEmails()));
  app.delete("/api/admin/emails", (req, res) => {
    import_fs.default.writeFileSync(EMAILS_PATH, JSON.stringify([], null, 2), "utf8");
    res.json({ success: true });
  });
  app.post("/api/admin/rsvps", async (req, res) => {
    const { code, names, passes, guests: submittedGuests } = req.body;
    if (!code || !names || !passes) return res.status(400).json({ success: false, error: "Faltan datos." });
    const passCount = parseInt(passes, 10);
    if (!Number.isInteger(passCount) || passCount < 1) {
      return res.status(400).json({ success: false, error: "La cantidad de pases no es v\xE1lida." });
    }
    if (submittedGuests !== void 0 && (!Array.isArray(submittedGuests) || submittedGuests.length !== passCount || submittedGuests.some(
      (guest) => !guest || typeof guest !== "object" || !("name" in guest) || typeof guest.name !== "string" || !guest.name.trim()
    ))) {
      return res.status(400).json({ success: false, error: "Ingres\xE1 el nombre completo de cada invitado." });
    }
    const guests = Array.from({ length: passCount }, (_, idx) => ({
      name: submittedGuests ? submittedGuests[idx].name.trim() : idx === 0 ? names.split(" & ")[0] : `Acompa\xF1ante ${idx}`,
      isAttending: null,
      dietaryRestrictions: "none"
    }));
    const newInvitation = {
      code: code.trim().toUpperCase(),
      names: names.trim(),
      passes: passCount,
      status: "pending",
      guests,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const invitations = readInvitations();
    const existingIndex = invitations.findIndex((i) => i.code.toUpperCase() === newInvitation.code);
    if (existingIndex !== -1) invitations[existingIndex] = newInvitation;
    else invitations.push(newInvitation);
    writeInvitations(invitations);
    res.json({ success: true, invitation: newInvitation });
  });
  app.put("/api/admin/rsvps/:code", async (req, res) => {
    const targetCode = req.params.code.toUpperCase();
    const { code, names, passes, status, guests } = req.body;
    const invitations = readInvitations();
    const index = invitations.findIndex((i) => i.code.toUpperCase() === targetCode);
    if (index === -1) return res.status(404).json({ success: false, error: "No encontrada." });
    const updatedCode = code ? code.trim().toUpperCase() : targetCode;
    if (updatedCode !== targetCode && invitations.some((inv, idx) => idx !== index && inv.code.toUpperCase() === updatedCode)) {
      return res.status(400).json({ success: false, error: "C\xF3digo en uso." });
    }
    const current = invitations[index];
    const newPasses = passes !== void 0 ? parseInt(passes, 10) : current.passes;
    let updatedGuests = guests || current.guests || [];
    if (updatedGuests.length < newPasses) {
      for (let i = updatedGuests.length; i < newPasses; i++) {
        updatedGuests.push({ name: `Acompa\xF1ante ${i + 1}`, isAttending: null, dietaryRestrictions: "none" });
      }
    } else if (updatedGuests.length > newPasses) {
      updatedGuests = updatedGuests.slice(0, newPasses);
    }
    const updatedInvitation = {
      ...current,
      code: updatedCode,
      names: names !== void 0 ? names.trim() : current.names,
      passes: newPasses,
      status: status !== void 0 ? status : current.status,
      guests: updatedGuests,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    invitations[index] = updatedInvitation;
    writeInvitations(invitations);
    res.json({ success: true, invitation: updatedInvitation });
  });
  app.delete("/api/admin/rsvps/:code", (req, res) => {
    const code = req.params.code.toUpperCase();
    writeInvitations(readInvitations().filter((i) => i.code.toUpperCase() !== code));
    res.json({ success: true });
  });
  app.use(import_express.default.static(import_path.default.join(process.cwd(), "public")));
  if (!isProduction) {
    console.log("\u{1F6E0}\uFE0F  Iniciando en modo DESARROLLO con Vite...");
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      // 'spa': Vite sirve index.html en / y hace fallback de las rutas del
      // cliente. Las rutas /api/* y el proxy /api.php se registraron ANTES en
      // Express, así que nunca llegan a este fallback (no hay error 404/HTML).
      appType: "spa"
    });
    app.use("/api.php", async (req, res) => {
      if (!phpServerUrl) {
        return res.status(502).json({
          error: "PHP no disponible en este sistema. El frontend debe usar /api/* de Express."
        });
      }
      try {
        const target = new URL(phpServerUrl.toString());
        target.pathname = "/api.php";
        target.search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
        const init = { method: req.method };
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
    app.use(vite.middlewares);
  } else {
    console.log("\u{1F680} Iniciando en modo PRODUCCI\xD3N sirviendo carpeta 'dist'...");
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u2705 Servidor corriendo exitosamente en http://0.0.0.0:${PORT}`);
    console.log(`\u{1F4E6} Entorno: ${isProduction ? "PRODUCCI\xD3N" : "DESARROLLO"}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
