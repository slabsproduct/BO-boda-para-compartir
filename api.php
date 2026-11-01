<?php
/**
 * api.php — Backend para hosting compartido (DonWeb cPanel / Ferozo, sin Node.js)
 *
 * Reemplaza al servidor Express (server.ts) manejando las mismas rutas de API:
 *   GET    /api/rsvp/:code
 *   POST   /api/rsvp/:code
 *   GET    /api/admin/rsvps
 *   POST   /api/admin/rsvps
 *   PUT    /api/admin/rsvps/:code
 *   DELETE /api/admin/rsvps/:code
 *   GET    /api/admin/db/status
 *   GET    /api/admin/db/download-backup   (descarga db.json como respaldo)
 *   GET    /api/admin/db/download-sql      (dump .sql para migración futura)
 *   GET    /api/admin/emails
 *   DELETE /api/admin/emails
 *
 * Persistencia: data/db.json y data/emails.json junto a este archivo (creados
 * automáticamente con datos iniciales si faltan; se puede reubicar el directorio
 * con la variable de entorno BODA_DATA_DIR). Escritura atómica: temp file +
 * flock + rename. Las escrituras se serializan con flock sobre un lockfile para
 * simular una cola entre requests concurrentes de PHP (cada request es un
 * proceso separado en hosting compartido).
 *
 * Uso en cPanel: subir junto con el build (dist/) y enrutar /api/* a este archivo
 * mediante .htaccess (ver comentario al final del archivo).
 */

// ---------------------------------------------------------------------------
// Configuración de rutas (respecto a la ubicación de este archivo)
// ---------------------------------------------------------------------------
define("DATA_DIR", getenv("BODA_DATA_DIR") ?: (__DIR__ . "/data"));
define('DB_PATH', DATA_DIR . '/db.json');
define('EMAILS_PATH', DATA_DIR . '/emails.json');
define('LOCK_DB', DATA_DIR . '/.db.lock');
define('LOCK_EMAILS', DATA_DIR . '/.emails.lock');

// Defaults idénticos a ensureDb() de server.ts
const DEFAULT_DB = array(
  'invitations' => array(
    array(
      'code' => 'MARISIMON',
      'names' => 'Mariángel & Simón',
      'passes' => 2,
      'status' => 'pending',
      'guests' => array(
        array('name' => 'Mariángel', 'isAttending' => true, 'dietaryRestrictions' => 'none'),
        array('name' => 'Simón', 'isAttending' => true, 'dietaryRestrictions' => 'none'),
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Helpers de E/S atómica y serializada
// ---------------------------------------------------------------------------
function ensure_data_dir() {
  if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
  }
}

/** Lectura simple (con lock compartido): lecturas pueden ser paralelas. */
function read_json_raw($path, $default) {
  if (!file_exists($path)) return $default;
  $fp = @fopen($path, 'rb');
  if (!$fp) return $default;
  flock($fp, LOCK_SH);
  $contents = stream_get_contents($fp);
  flock($fp, LOCK_UN);
  fclose($fp);
  $data = json_decode($contents, true);
  return is_null($data) ? $default : $data;
}

/**
 * Ejecuta $callback sobre los datos persistentes con lectura/escritura atómica
 * y serializada (transacción):
 *   1. flock(exclusive) sobre un lockfile -> cola de requests concurrentes
 *   2. lee el JSON actual DENTRO de la sección crítica
 *   3. $callback devuelve el nuevo contenido, o un centinela para abortar
 *   4. escribe en un temp file + fsync + rename (nunca queda un db.json roto)
 *
 * $callback puede devolver:
 *   - array             -> se persiste; resultado: array('OK', nuevoContenido)
 *   - SKIP_WRITE        -> no se escribe; resultado: array('SKIP', datosActuales)
 *   - SENTINEL_DUPLICATE-> no se escribe; resultado: array('DUPLICATE', datosActuales)
 */
define('SKIP_WRITE', "\0boda_skip");
define('SENTINEL_DUPLICATE', "\0boda_dup");

function with_locked_write($lockPath, $dataPath, $default, callable $callback) {
  ensure_data_dir();
  $lp = @fopen($lockPath, 'c');
  if ($lp === false) {
    throw new RuntimeException('No se pudo abrir el lockfile: ' . $lockPath);
  }
  flock($lp, LOCK_EX); // espera por turnos: serializa escrituras
  try {
    $current = read_json_raw($dataPath, $default);
    $result = call_user_func($callback, $current);
    if ($result === SKIP_WRITE) {
      return array('SKIP', $current); // operación sin cambio (p.ej. 404)
    }
    if ($result === SENTINEL_DUPLICATE) {
      return array('DUPLICATE', $current);
    }
    $json = json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = $dataPath . '.tmp.' . getmypid() . '.' . bin2hex(random_bytes(4));
    $tp = @fopen($tmp, 'wb');
    if ($tp === false) {
      throw new RuntimeException('No se pudo crear el archivo temporal de escritura.');
    }
    fwrite($tp, $json);
    if (function_exists('fsync')) { @fsync($tp); } else { @fflush($tp); }
    fclose($tp);
    if (!@rename($tmp, $dataPath)) {   // rename es atómico en el mismo filesystem
      @unlink($tmp);
      throw new RuntimeException('No se pudo reemplazar el archivo de datos.');
    }
    @chmod($dataPath, 0644);
    return array("OK", $result);
  } finally {
    flock($lp, LOCK_UN);
    fclose($lp);
  }
}

// ---------------------------------------------------------------------------
// Modelo de datos (equivalente a las interfaces de server.ts)
// ---------------------------------------------------------------------------
function read_invitations() {
  $db = read_json_raw(DB_PATH, DEFAULT_DB);
  return isset($db['invitations']) && is_array($db['invitations']) ? $db['invitations'] : array();
}

function read_emails() {
  return read_json_raw(EMAILS_PATH, array());
}

function find_index_by_code(array $invitations, $code) {
  foreach ($invitations as $i => $inv) {
    if (strtoupper(trim($inv['code'])) === $code) return $i;
  }
  return -1;
}

function normalize_guests($guests) {
  if (!is_array($guests)) return array();
  $out = array();
  foreach ($guests as $g) {
    if (!is_array($g)) continue;
    $ng = array(
      'name' => isset($g['name']) ? strval($g['name']) : '',
      'isAttending' => !empty($g['isAttending']),
      'dietaryRestrictions' => isset($g['dietaryRestrictions']) ? strval($g['dietaryRestrictions']) : 'none',
    );
    if (array_key_exists('notes', $g))               $ng['notes'] = strval($g['notes']);
    if (array_key_exists('needsTransport', $g))      $ng['needsTransport'] = !empty($g['needsTransport']);
    if (array_key_exists('transportLocation', $g))   $ng['transportLocation'] = strval($g['transportLocation']);
    $out[] = $ng;
  }
  return $out;
}

// ---------------------------------------------------------------------------
// Respuestas JSON
// ---------------------------------------------------------------------------
function json_response($payload, $status = 200) {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($payload, JSON_UNESCAPED_UNICODE);
  exit;
}

// ---------------------------------------------------------------------------
// Router: obtiene la sub-ruta /api/... sea por PATH_INFO o por query ?_=...
// ---------------------------------------------------------------------------
$rawPath = '';
if (!empty($_SERVER['PATH_INFO'])) {
  $rawPath = $_SERVER['PATH_INFO'];
} elseif (!empty($_GET['_route'])) {
  $rawPath = '/' . trim(strval($_GET['_route']), '/');
} else {
  $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
  $self = $_SERVER['SCRIPT_NAME'];
  if (strpos($uri, $self) === 0) {
    $rawPath = substr($uri, strlen($self));
  } else {
    $pos = strpos($uri, '/api/');
    $rawPath = $pos !== false ? substr($uri, $pos + strlen('/api')) : '';
  }
}
$path = '/' . trim($rawPath, '/');
$method = strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET');

$body = array();
if ($method === 'POST' || $method === 'PUT') {
  $rawBody = file_get_contents('php://input');
  $decoded = json_decode($rawBody, true);
  if (is_array($decoded)) $body = $decoded;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
try {
  // ===== /api/rsvp/:code =====================================================
  if (preg_match('#^/rsvp/([^/]+)$#', $path, $m)) {
    $code = strtoupper(trim(urldecode($m[1])));

    if ($method === 'GET') {
      $invitation = null;
      foreach (read_invitations() as $inv) {
        if (strtoupper(trim($inv['code'])) === $code) { $invitation = $inv; break; }
      }
      if ($invitation) json_response(array('success' => true, 'invitation' => $invitation));
      json_response(array('success' => false, 'error' => 'El código de invitación no es válido.'), 404);
    }

    if ($method === 'POST') {
      if (!isset($body['guests']) || !is_array($body['guests'])) {
        json_response(array('success' => false, 'error' => 'Datos de invitados inválidos.'), 400);
      }
      $guests = normalize_guests($body['guests']);
      $status = isset($body['status']) ? strval($body['status']) : 'pending';
      $youtubeEmail = (isset($body['youtubeEmail']) && is_string($body['youtubeEmail']) && trim($body['youtubeEmail']) !== '')
        ? trim($body['youtubeEmail']) : null;

      list($status_, $updated) = with_locked_write(LOCK_DB, DB_PATH, DEFAULT_DB, function ($current) use ($code, $guests, $status, $youtubeEmail) {
        $invitations = isset($current['invitations']) && is_array($current['invitations']) ? $current['invitations'] : array();
        $idx = find_index_by_code($invitations, $code);
        if ($idx === -1) return SKIP_WRITE; // no existe -> 404
        $invitation = $invitations[$idx];
        $invitation['guests'] = $guests;
        $invitation['status'] = $status;
        if (!is_null($youtubeEmail)) $invitation['youtubeEmail'] = $youtubeEmail;
        $invitation['updatedAt'] = gmdate('Y-m-d\TH:i:s.') . sprintf('%03d', intval((microtime(true) * 1000) % 1000)) . 'Z';
        $invitations[$idx] = $invitation;
        $current['invitations'] = $invitations;
        return $current;
      });

      if ($status_ !== 'OK') {
        json_response(array('success' => false, 'error' => 'Invitación no encontrada.'), 404);
      }
      $idx = find_index_by_code($updated['invitations'], $code);
      $invitation = $updated['invitations'][$idx];

      // Email simulado (mismo formato que server.ts)
      $attendingCount = 0;
      foreach ($invitation['guests'] as $g) { if (!empty($g['isAttending'])) $attendingCount++; }
      $emailBody = "¡Hola {$invitation['names']}!\n\nHemos recibido tu confirmación...\n\nCon cariño,\nMari & Simón 💍";
      $email = array(
        'id' => substr(md5(uniqid(mt_rand(), true)), 0, 9),
        'to' => 'invitados_' . strtolower($code) . '@boda-marisimon.com',
        'subject' => 'Confirmación de RSVP: ' . $invitation['names'],
        'body' => $emailBody,
        'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
      );
      with_locked_write(LOCK_EMAILS, EMAILS_PATH, array(), function ($emails) use ($email) {
        if (!is_array($emails)) $emails = array();
        array_unshift($emails, $email);
        return $emails;
      });

      json_response(array('success' => true, 'invitation' => $invitation));
    }

    json_response(array('success' => false, 'error' => 'Método no permitido.'), 405);
  }

  // ===== /api/admin/rsvps ====================================================
  if ($path === '/admin/rsvps') {
    if ($method === 'GET') {
      // Aceptamos tanto el objeto completo {"invitations":[...]} como el array
      // plano [...] que devuelve server.ts en desarrollo, para que el Admin
      // funcione igual en ambos backends.
      $inv = read_invitations();
      if (isset($_GET['format']) && $_GET['format'] === 'object') {
        json_response(array('invitations' => $inv));
      }
      json_response($inv);
    }
    if ($method === 'POST') {
      $code = isset($body['code']) ? strtoupper(trim(strval($body['code']))) : '';
      $names = isset($body['names']) ? trim(strval($body['names'])) : '';
      $passes = isset($body['passes']) ? intval($body['passes']) : 0;
      if ($code === '' || $names === '' || !$passes) {
        json_response(array('success' => false, 'error' => 'Faltan datos.'), 400);
      }
      $guests = array();
      $parts = preg_split('/\s+&\s*/u', $names);
      for ($i = 0; $i < $passes; $i++) {
        $guests[] = array(
          'name' => $i === 0 ? $parts[0] : "Acompañante $i",
          'isAttending' => true,
          'dietaryRestrictions' => 'none',
        );
      }
      $newInvitation = array(
        'code' => $code,
        'names' => $names,
        'passes' => $passes,
        'status' => 'pending',
        'guests' => $guests,
        'updatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
      );
      with_locked_write(LOCK_DB, DB_PATH, DEFAULT_DB, function ($current) use ($newInvitation) {
        $invitations = isset($current['invitations']) && is_array($current['invitations']) ? $current['invitations'] : array();
        $idx = find_index_by_code($invitations, $newInvitation['code']);
        if ($idx !== -1) $invitations[$idx] = $newInvitation;
        else $invitations[] = $newInvitation;
        $current['invitations'] = $invitations;
        return $current;
      });
      json_response(array('success' => true, 'invitation' => $newInvitation));
    }
    json_response(array('success' => false, 'error' => 'Método no permitido.'), 405);
  }

  // ===== /api/admin/rsvps/:code ==============================================
  if (preg_match('#^/admin/rsvps/([^/]+)$#', $path, $m)) {
    $targetCode = strtoupper(trim(urldecode($m[1])));

    if ($method === 'PUT') {
      $newCodeReq = (isset($body['code']) && trim(strval($body['code'])) !== '')
        ? strtoupper(trim(strval($body['code']))) : null;

      list($outcome, $data_) = with_locked_write(LOCK_DB, DB_PATH, DEFAULT_DB, function ($current) use ($targetCode, $body, $newCodeReq) {
        $invitations = isset($current['invitations']) && is_array($current['invitations']) ? $current['invitations'] : array();
        $index = find_index_by_code($invitations, $targetCode);
        if ($index === -1) return SKIP_WRITE; // 404

        $newCode = $newCodeReq ? $newCodeReq : $targetCode;
        if ($newCode !== $targetCode && find_index_by_code($invitations, $newCode) !== -1) {
          return SENTINEL_DUPLICATE; // 400 código en uso
        }

        $current_ = $invitations[$index];
        $newPasses = array_key_exists('passes', $body) ? intval($body['passes']) : intval($current_['passes']);
        $updatedGuests = (isset($body['guests']) && is_array($body['guests']))
          ? normalize_guests($body['guests'])
          : (isset($current_['guests']) && is_array($current_['guests']) ? $current_['guests'] : array());

        while (count($updatedGuests) < $newPasses) {
          $i = count($updatedGuests);
          $updatedGuests[] = array('name' => 'Acompañante ' . ($i + 1), 'isAttending' => true, 'dietaryRestrictions' => 'none');
        }
        if (count($updatedGuests) > $newPasses) {
          $updatedGuests = array_slice($updatedGuests, 0, $newPasses);
        }

        $updatedInvitation = $current_;
        $updatedInvitation['code'] = $newCode;
        if (array_key_exists('names', $body)) $updatedInvitation['names'] = trim(strval($body['names']));
        $updatedInvitation['passes'] = $newPasses;
        if (array_key_exists('status', $body)) $updatedInvitation['status'] = strval($body['status']);
        $updatedInvitation['guests'] = $updatedGuests;
        $updatedInvitation['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z');

        // Si cambió el código, eliminar la entrada vieja y agregar la nueva
        if ($newCode !== $targetCode) {
          unset($invitations[$index]);
          $invitations[] = $updatedInvitation;
          $invitations = array_values($invitations);
        } else {
          $invitations[$index] = $updatedInvitation;
        }
        $current['invitations'] = $invitations;
        return $current;
      });

      if ($outcome === 'DUPLICATE') {
        json_response(array('success' => false, 'error' => 'Código en uso.'), 400);
      }
      if ($outcome !== 'OK') {
        json_response(array('success' => false, 'error' => 'No encontrada.'), 404);
      }
      // $data_ trae los datos ya persistidos: responder la invitación final
      $finalCode = $newCodeReq ? $newCodeReq : $targetCode;
      $idx = find_index_by_code($data_["invitations"], $finalCode);
      json_response(array('success' => true, 'invitation' => $data_["invitations"][$idx]));
    }

    if ($method === 'DELETE') {
      with_locked_write(LOCK_DB, DB_PATH, DEFAULT_DB, function ($current) use ($targetCode) {
        $invitations = isset($current['invitations']) && is_array($current['invitations']) ? $current['invitations'] : array();
        $invitations = array_values(array_filter($invitations, function ($inv) use ($targetCode) {
          return strtoupper(trim($inv['code'])) !== $targetCode;
        }));
        $current['invitations'] = $invitations;
        return $current;
      });
      json_response(array('success' => true));
    }

    json_response(array('success' => false, 'error' => 'Método no permitido.'), 405);
  }

  // ===== /api/admin/db/status ================================================
  if ($path === '/admin/db/status') {
    $invitations = read_invitations();
    $totalGuests = 0;
    foreach ($invitations as $inv) {
      if (isset($inv['guests']) && is_array($inv['guests'])) $totalGuests += count($inv['guests']);
    }
    $size = file_exists(DB_PATH) ? filesize(DB_PATH) : 0;
    json_response(array(
      'engine' => 'JSON atómico (PHP/cPanel)',
      'compatibleWith' => array('DonWeb', 'cPanel', 'Ferozo'),
      'dataFile' => 'data/db.json',
      'dataSize' => number_format($size / 1024, 1, '.', '') . ' KB',
      'totalInvitations' => count($invitations),
      'totalGuests' => $totalGuests,
    ));
  }

  // ===== /api/admin/db/download-backup =======================================
  // Descarga directa del respaldo db.json (mismo comportamiento que server.ts).
  if ($path === '/admin/db/download-backup') {
    if (!file_exists(DB_PATH)) json_response(array('error' => 'Archivo de datos no encontrado.'), 404);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="db.json"');
    readfile(DB_PATH);
    exit;
  }

  // ===== /api/admin/db/download-sql ==========================================
  // Dump SQL equivalente, utilizable para migrar los datos a MySQL si algún día se necesita.
  if ($path === '/admin/db/download-sql' || $path === '/admin/db/download-sqlite') {
    $invitations = read_invitations();
    $lines = array();
    $lines[] = '-- Dump de reservas (generado por api.php) ' . gmdate('c');
    $lines[] = 'CREATE TABLE IF NOT EXISTS invitations (';
    $lines[] = '  code VARCHAR(32) PRIMARY KEY,';
    $lines[] = '  names VARCHAR(255) NOT NULL,';
    $lines[] = '  passes INT NOT NULL,';
    $lines[] = "  status VARCHAR(16) NOT NULL DEFAULT 'pending',";
    $lines[] = '  youtube_email VARCHAR(255) NULL,';
    $lines[] = '  updated_at DATETIME NULL,';
    $lines[] = '  guests_json TEXT';
    $lines[] = ');';
    foreach ($invitations as $inv) {
      $vals = array(
        sql_str($inv['code']),
        sql_str($inv['names']),
        intval($inv['passes']),
        sql_str($inv['status']),
        isset($inv['youtubeEmail']) ? sql_str($inv['youtubeEmail']) : 'NULL',
        isset($inv['updatedAt']) ? sql_str(substr($inv['updatedAt'], 0, 19)) : 'NULL',
        sql_str(json_encode(isset($inv['guests']) ? $inv['guests'] : array(), JSON_UNESCAPED_UNICODE)),
      );
      $lines[] = 'INSERT INTO invitations (code, names, passes, status, youtube_email, updated_at, guests_json) VALUES ('
        . implode(', ', $vals) . ') ON DUPLICATE KEY UPDATE names=VALUES(names), passes=VALUES(passes), status=VALUES(status), youtube_email=VALUES(youtube_email), updated_at=VALUES(updated_at), guests_json=VALUES(guests_json);';
    }
    $filename = $path === '/admin/db/download-sqlite' ? 'boda_donweb_backup.sql' : 'boda_donweb_dump.sql';
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    echo implode("\n", $lines) . "\n";
    exit;
  }

  // ===== /api/admin/emails ===================================================
  if ($path === '/admin/emails') {
    if ($method === 'GET') json_response(read_emails());
    if ($method === 'DELETE') {
      with_locked_write(LOCK_EMAILS, EMAILS_PATH, array(), function () { return array(); });
      json_response(array('success' => true));
    }
    json_response(array('success' => false, 'error' => 'Método no permitido.'), 405);
  }

  json_response(array('success' => false, 'error' => 'Ruta de API desconocida: ' . $path), 404);

} catch (Throwable $e) {
  json_response(array('success' => false, 'error' => 'Error interno: ' . $e->getMessage()), 500);
}

// ---------------------------------------------------------------------------
// Utilidades del dump SQL
// ---------------------------------------------------------------------------
function sql_str($s) {
  $s = strval($s);
  $escaped = addslashes($s);
  return "'" . $escaped . "'";
}

/*
 * -----------------------------------------------------------------------------
 * ENRUTADO EN CPANEL (.htaccess en public_html, junto a index.html del build)
 * -----------------------------------------------------------------------------
 *
 *   RewriteEngine On
 *
 *   # 1) Todas las llamadas a /api/* van a api.php conservando la sub-ruta
 *   RewriteCond %{REQUEST_URI} ^/api/
 *   RewriteRule ^api/(.*)$ api.php/$1 [QSA,L]
 *
 *   # 2) SPA: cualquier otra ruta sirve index.html (React Router / rutas limpias)
 *   RewriteCond %{REQUEST_FILENAME} !-f
 *   RewriteCond %{REQUEST_FILENAME} !-d
 *   RewriteRule . index.html [L]
 *
 * Estructura a subir por FileZilla a public_html:
 *   public_html/
 *     index.html          <- contenido de dist/ (build de Vite)
 *     assets/             <- contenido de dist/assets/
 *     favicon.svg, etc.   <- resto de dist/
 *     api.php             <- este archivo
 *     .htaccess           <- el de este repo (raíz)
 *     data/db.json        <- opcional: tus reservas actuales (src/data/db.json);
 *                           si no existe, se crea solo con la invitación demo
 *     data/emails.json    <- opcional: idem
 *
 * Nota: api.php busca su base de datos en ./data/ relativo a su propia ubicación.
 * Para conservar las reservas que ya tenés, subí tu src/data/db.json como
 * public_html/data/db.json (una sola vez).
 */
