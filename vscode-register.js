#!/usr/bin/env node
/**
 * Arena Bridge — registro oficial en VS Code (v0.4 multi-cerebro)
 * ================================================================
 * Registra TODOS los cerebros de backends.json como modelos del picker
 * (arena-bridge/fast, /pro, /local...). Sin backends.json → entrada única
 * arena-bridge/auto (compat v0.3). Idempotente; nunca toca otros providers.
 *
 *   node vscode-register.js            alta / actualización
 *   node vscode-register.js --remove   baja
 */
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const REMOVE = process.argv.includes('--remove');
const CONFIG_DIR = path.join(HOME, '.config', 'arena-bridge');

// Puerto del bridge (del .env del usuario, default 4010)
function getPort() {
  try {
    const s = fs.readFileSync(path.join(CONFIG_DIR, '.env'), 'utf8');
    const m = s.match(/^\s*PORT=(\d+)/m);
    if (m) return m[1];
  } catch {}
  return '4010';
}
const URL = `http://localhost:${getPort()}/v1/chat/completions`;

// Cerebros: backends.json del usuario (o del paquete como ejemplo)
function loadBrains() {
  for (const f of [path.join(CONFIG_DIR, 'backends.json'), '/opt/arena-bridge/backends.json']) {
    try {
      if (!fs.existsSync(f)) continue;
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      const list = (cfg.backends || []).filter(b => b.id);
      if (list.length) return list;
    } catch (e) { console.log(`⚠️  ${f}: ${e.message}`); }
  }
  return null;
}

const brains = loadBrains();
const models = brains
  ? brains.map(b => ({
      id: 'arena-bridge/' + b.id,
      name: b.name || `Arena Bridge (${b.id})`,
      url: URL,
      toolCalling: b.tool_calling !== false,
      vision: !!b.vision,
      maxInputTokens: b.max_input_tokens || 128000,
      maxOutputTokens: b.max_output_tokens || 16000,
    }))
  : [{
      id: 'arena-bridge/auto',
      name: 'Arena Bridge 🧉',
      url: URL,
      toolCalling: true,
      vision: false,
      maxInputTokens: 128000,
      maxOutputTokens: 16000,
    }];

const GROUP = { name: 'Arena Bridge', vendor: 'customendpoint', apiKey: 'arena', apiType: 'chat-completions', models };

const rel = [
  '.config/Code/User/chatLanguageModels.json',
  '.config/Code - OSS/User/chatLanguageModels.json',
  '.config/VSCodium/User/chatLanguageModels.json',
  '.config/Code - Insiders/User/chatLanguageModels.json',
  'snap/code/current/.config/Code/User/chatLanguageModels.json',
];

let targets = rel.map(p => path.join(HOME, p)).filter(f => fs.existsSync(f));
if (targets.length === 0) {
  const std = path.join(HOME, '.config', 'Code', 'User');
  if (fs.existsSync(std)) targets = [path.join(std, 'chatLanguageModels.json')];
}
if (targets.length === 0) {
  console.log('ℹ️  No encontré perfiles de VS Code. Si instalás Code después, corré:');
  console.log('   node /opt/arena-bridge/vscode-register.js');
  process.exit(0);
}

let ok = 0;
for (const f of targets) {
  try {
    const raw = fs.readFileSync(f, 'utf8').trim();
    const data = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) throw new Error('formato inesperado (no es un array)');
    const idx = data.findIndex(g => g && g.name === GROUP.name);
    if (REMOVE) {
      if (idx === -1) { console.log(`= ${f}: no estaba registrado, nada que hacer`); continue; }
      data.splice(idx, 1);
      console.log(`🗑️  ${f}: grupo "Arena Bridge" eliminado`);
    } else if (idx === -1) {
      data.push(GROUP);
      console.log(`✚ ${f}: ${models.length} modelo(s) agregado(s)`);
    } else {
      data[idx] = GROUP;
      console.log(`✎ ${f}: ${models.length} modelo(s) actualizado(s)`);
    }
    fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
    ok++;
  } catch (e) {
    console.log(`⚠️  ${f}: ${e.message} — lo dejé intacto`);
  }
}
if (!REMOVE && ok > 0) {
  console.log('');
  for (const m of models) console.log(`   🧠 ${m.id}  (${m.name})`);
  console.log('');
  console.log('💡 En VS Code: Ctrl+Shift+P → "Developer: Reload Window" y elegí tu cerebro.');
}
