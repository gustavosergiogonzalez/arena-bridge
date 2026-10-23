/**
 * Arena Bridge v0.4 "Multi-cerebro" — Nuestra API propia, OpenAI-compatible
 * ==========================================================================
 * TU VS CODE (Roo / Copilot BYOK) ──▶ http://localhost:4010/v1 ──▶ TUS cerebros
 *
 * Cero dependencias. Node 18+.
 *
 * TRES MODOS (en orden de prioridad):
 *  1) MULTI:    existe backends.json → ruteo por id  arena-bridge/<id>
 *               con failover automático entre cerebros (429/5xx/red).
 *  2) PASSTHRU: BACKEND_BASE_URL en .env → un solo cerebro (comportamiento v0.3).
 *  3) MOCK:     sin config → respuestas de prueba para verificar el cableado.
 *
 * Secretos: la key puede ser literal o "${VAR}" (se expande desde el .env/entorno).
 * Uso registrado en ~/.config/arena-bridge/usage.jsonl (best-effort).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- Cargador .env nativo ----------
const L = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const CONFIG_DIR = process.env.HOME ? path.join(process.env.HOME, '.config', 'arena-bridge') : __dirname;
(function loadEnv() {
  for (const f of [path.join(CONFIG_DIR, '.env'), path.join(__dirname, '.env')]) {
    try {
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      }
      L(`[env] config cargada de ${f}`);
      return;
    } catch { /* siguiente */ }
  }
})();

// ---------- Config base ----------
const PORT = parseInt(process.env.PORT || '4010', 10);
const HOST = process.env.HOST || '0.0.0.0';
const BRIDGE_KEY = process.env.BRIDGE_KEY || null;
const LEGACY_URL = (process.env.BACKEND_BASE_URL || '').replace(/\/+$/, '') || null;
const LEGACY_KEY = process.env.BACKEND_API_KEY || null;
const LEGACY_MODEL = process.env.BACKEND_MODEL || null;

// ---------- backends.json (multi-cerebro) ----------
const expand = v => (typeof v === 'string'
  ? v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => process.env[k] || '')
  : v);

function loadBackends() {
  for (const f of [path.join(CONFIG_DIR, 'backends.json'), path.join(__dirname, 'backends.json')]) {
    try {
      if (!fs.existsSync(f)) continue;
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      const list = (cfg.backends || []).map((b, i) => ({
        id: String(b.id || `brain${i}`),
        name: b.name || `Arena Bridge (${b.id || i})`,
        base_url: expand(b.base_url || '').replace(/\/+$/, ''),
        api_key: expand(b.api_key || ''),
        model: expand(b.model || ''),
        tool_calling: b.tool_calling !== false,
        vision: !!b.vision,
        max_input_tokens: b.max_input_tokens || 128000,
        max_output_tokens: b.max_output_tokens || 16000,
      })).filter(b => b.base_url);
      if (list.length) {
        L(`[brains] ${list.length} cerebro(s) de ${f}: ${list.map(b => b.id).join(', ')}`);
        return { list, failover: cfg.failover !== false };
      }
    } catch (e) { L(`[brains] ERROR leyendo ${f}: ${e.message}`); }
  }
  return null;
}
const MULTI = loadBackends();
const FAILOVER = MULTI ? MULTI.failover : false;
const BRAINS = MULTI ? MULTI.list : [];
const MODE = MULTI ? 'multi' : (LEGACY_URL ? 'passthru' : 'mock');

// ---------- Usage log (best-effort JSONL) ----------
function usage(rec) {
  try {
    fs.appendFileSync(path.join(CONFIG_DIR, 'usage.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
  } catch { /* no molestar */ }
}

// ---------- Helpers HTTP ----------
function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}
const sendError = (res, status, message, type = 'invalid_request_error') =>
  sendJson(res, status, { error: { message, type } });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 8e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- MOCK ----------
function mockReplyText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = [...msgs].reverse().find(m => m.role === 'user');
  const txt = (last && typeof last.content === 'string' ? last.content : '').slice(0, 220) || '(vacío)';
  return ['🧉 ¡Arena Bridge funcionando!', '',
    `Recibí ${msgs.length} mensaje(s). Tu último texto: "${txt}"`, '',
    'Estoy en MODO MOCK (sin cerebros): el cableado con tu editor ya anda. ',
    'Creá backends.json (arena-bridge --setup-backends) para el modo multi-cerebro,',
    'o BACKEND_BASE_URL + BACKEND_API_KEY en .env para un solo cerebro.'].join('\n');
}
async function mockChat(body, res) {
  const model = body.model || 'arena-bridge/mock-0.1';
  const id = 'chatcmpl-bridge-' + Date.now();
  const created = Math.floor(Date.now() / 1000);
  const content = mockReplyText(body);
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
    for (const w of content.split(/(\s+)/)) {
      if (!w) continue;
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] })}\n\n`);
      await sleep(25);
    }
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  } else {
    sendJson(res, 200, { id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: content.length / 4 | 0, total_tokens: content.length / 4 | 0 } });
  }
}

// ---------- Llamada a UN backend ----------
// Devuelve { retry:boolean } — solo escribe a `res` cuando el resultado es definitivo.
async function callBackend(b, body, res, tag) {
  const headers = { 'Content-Type': 'application/json' };
  if (b.api_key) headers['Authorization'] = `Bearer ${b.api_key}`;
  const payload = { ...body, model: b.model || body.model };
  let up;
  try {
    up = await fetch(b.base_url + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (e) {
    L(`⚠️  ${tag}: sin contacto (${e.message})`);
    return { retry: true, status: 0 };
  }
  if (up.status === 429 || up.status >= 500) {
    const snippet = await up.text().catch(() => '');
    L(`⚠️  ${tag}: ${up.status} ${snippet.slice(0, 120)}`);
    return { retry: true, status: up.status };
  }
  // Definitivo (2xx o 4xx de cliente): streamear tal cual al editor
  const isSSE = (up.headers.get('content-type') || '').includes('text/event-stream');
  res.writeHead(up.status, {
    'Content-Type': up.headers.get('content-type') || 'application/json',
    ...(isSSE ? { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } : {}),
  });
  if (up.body) { for await (const chunk of up.body) res.write(chunk); }
  res.end();
  return { retry: false, status: up.status };
}

// ---------- MULTI-CHAT con failover ----------
async function multiChat(body, res) {
  const t0 = Date.now();
  const requested = typeof body.model === 'string' ? body.model : '';
  let first;
  if (requested === 'arena-bridge/auto' || requested === 'arena-bridge/mock-0.1' || !requested) {
    first = BRAINS[0];
  } else if (requested.startsWith('arena-bridge/')) {
    const id = requested.slice('arena-bridge/'.length);
    first = BRAINS.find(b => b.id === id);
    if (!first) return sendError(res, 404, `Cerebro desconocido: ${id}. Disponibles: ${BRAINS.map(b => b.id).join(', ')}`);
  } else {
    first = BRAINS[0]; // modelo crudo → backend por defecto, sin tocar el model
  }
  const chain = FAILOVER ? [first, ...BRAINS.filter(b => b !== first)] : [first];
  const errors = [];
  for (const b of chain) {
    const tag = `${b.id} (${b.model})`;
    const r = await callBackend(b, body, res, tag);
    if (!r.retry) {
      L(`✅ ${requested || '(auto)'} → ${tag} [${r.status}] ${Date.now() - t0}ms`);
      usage({ req: requested, brain: b.id, model: b.model, status: r.status, ms: Date.now() - t0 });
      return;
    }
    errors.push(`${tag}: ${r.status || 'sin red'}`);
    if (chain.length > 1) L(`🔀 failover → probando siguiente cerebro…`);
  }
  sendError(res, 502, `Todos los cerebros fallaron → ${errors.join(' | ')}`, 'server_error');
  usage({ req: requested, brain: null, status: 502, ms: Date.now() - t0 });
}

// ---------- LEGACY single-backend (v0.3) ----------
async function legacyChat(body, res) {
  if (typeof body.model === 'string' && body.model.startsWith('arena-bridge/') && LEGACY_MODEL) {
    body = { ...body, model: LEGACY_MODEL };
  } else if (LEGACY_MODEL) {
    body = { ...body, model: LEGACY_MODEL };
  }
  const b = { base_url: LEGACY_URL, api_key: LEGACY_KEY, model: body.model };
  await callBackend(b, body, res, 'backend');
}

async function forwardModels(res) {
  const headers = {};
  if (LEGACY_KEY) headers['Authorization'] = `Bearer ${LEGACY_KEY}`;
  try {
    const up = await fetch(LEGACY_URL + '/models', { headers });
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
    res.end(await up.text());
  } catch (e) { sendError(res, 502, `Backend /models falló: ${e.message}`); }
}

// ---------- Router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname.replace(/\/+$/, '');
  L(req.method, p);

  if (p === '/health') {
    return sendJson(res, 200, {
      ok: true, service: 'arena-bridge', version: '0.4.0', mode: MODE,
      ...(MODE === 'multi'
        ? { brains: BRAINS.map(b => ({ id: b.id, model: b.model })), failover: FAILOVER, default: BRAINS[0].id }
        : { backend: LEGACY_URL }),
    });
  }

  if (BRIDGE_KEY && (req.headers.authorization || '') !== `Bearer ${BRIDGE_KEY}`) {
    return sendError(res, 401, 'Unauthorized: falta Bearer del bridge', 'authentication_error');
  }

  try {
    if (p === '/v1/models' || p === '/models') {
      if (MODE === 'multi') {
        return sendJson(res, 200, { object: 'list', data: BRAINS.map(b => ({
          id: 'arena-bridge/' + b.id, object: 'model', created: 0, owned_by: 'arena-bridge', name: b.name,
        }))});
      }
      if (MODE === 'passthru') return await forwardModels(res);
      return sendJson(res, 200, { object: 'list', data: [{ id: 'arena-bridge/mock-0.1', object: 'model', created: 0, owned_by: 'arena-bridge' }] });
    }
    if (p === '/v1/chat/completions' || p === '/chat/completions') {
      const body = await readBody(req);
      if (!Array.isArray(body.messages)) return sendError(res, 400, 'messages[] requerido');
      if (MODE === 'multi') return await multiChat(body, res);
      if (MODE === 'passthru') return await legacyChat(body, res);
      return await mockChat(body, res);
    }
    return sendError(res, 404, `Ruta desconocida: ${p}. Probá /health, /v1/models, /v1/chat/completions`);
  } catch (e) {
    L('ERROR', e.message);
    return sendError(res, 500, e.message, 'server_error');
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  L(`🌉 Arena Bridge v0.4 escuchando en http://${HOST}:${PORT}`);
  if (MODE === 'multi') {
    for (const b of BRAINS) L(`   🧠 ${b.id.padEnd(10)} ${b.model}  →  ${b.base_url}`);
    L(`   Failover: ${FAILOVER ? 'activado 🛟' : 'desactivado'} · Auto: arena-bridge/auto → ${BRAINS[0].id}`);
  } else if (MODE === 'passthru') {
    L(`   🧠 PASSTHRU → ${LEGACY_URL}  (modelo: ${LEGACY_MODEL || 'el del cliente'})`);
  } else {
    L(`   🧉 MOCK — backends.json para multi-cerebro o BACKEND_* en .env`);
  }
  L(`   Auth del bridge: ${BRIDGE_KEY ? 'activada 🔒' : 'desactivada (ok para localhost)'}`);
  console.log('');
});
