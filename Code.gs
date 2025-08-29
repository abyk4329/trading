/**
 * Trading Journal Web App (Apps Script backend)
 * - Creates/uses Google Sheet "TradingJournal" with sheets: Settings, Trades, Balances
 * - Exposes pseudo-REST endpoints via doGet/doPost with query param `path`
 *   Example: GET  <webapp>/exec?path=/api/settings
 *            GET  <webapp>/exec?path=/api/trades
 *            POST <webapp>/exec?path=/api/trades with JSON body
 *            POST <webapp>/exec?path=/api/trades/:id&_method=PUT with JSON body
 *            POST <webapp>/exec?path=/api/trades/:id/mark with JSON body { action: 'TP'|'SL'|'BE'|'Partial', percent?: number, amount?: number }
 * - Serves SPA (index.html + styles/app) when path is omitted
 */

const APP_NAME = 'TradingJournal';
const SETTINGS_SHEET = 'Settings';
const TRADES_SHEET = 'Trades';
const BALANCES_SHEET = 'Balances';
const SCRIPT_PROP = PropertiesService.getScriptProperties();

const DEFAULT_SETTINGS = {
  starting_balance: 10000,
  daily_target: 515,
  daily_max_loss: 1500,
  tp_pct: 0.30,
  sl_pct: 0.15,
};

const INSTRUMENT_HEADERS = ['symbol', 'tick_size', 'tick_value', 'contract_size'];
const TRADES_HEADERS = [
  'id','date','time','symbol','direction','entry','stop','take_profit','qty','rr','risk_amount','planned_tp_amount','planned_sl_amount','status','pnl','balance_after','notes','commission','fees','created_at','updated_at'
];
const BALANCES_HEADERS = ['datetime','balance','change','reason'];

/** Entry points */
function doGet(e) {
  ensureSetup();
  const path = (e && e.parameter && e.parameter.path) ? String(e.parameter.path) : '';
  if (path && path.indexOf('/api/') === 0) {
    return handleApi('GET', path, e, null);
  }
  return renderApp();
}

function doPost(e) {
  ensureSetup();
  const path = (e && e.parameter && e.parameter.path) ? String(e.parameter.path) : '';
  let body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { body = {}; }
  }
  const method = ((body && body._method) || (e && e.parameter && e.parameter._method) || 'POST').toUpperCase();
  if (path && path.indexOf('/api/') === 0) {
    return handleApi(method, path, e, body);
  }
  return json({ ok: false, error: 'Invalid endpoint' });
}

/** HTML rendering */
function renderApp() {
  const t = HtmlService.createTemplateFromFile('index');
  t.webAppUrl = ScriptApp.getService().getUrl();
  const out = t.evaluate()
    .setTitle('יומן מסחר')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

/** Utilities */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function json(obj) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getOrCreateSpreadsheet() {
  let id = SCRIPT_PROP.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* fallthrough */ }
  }
  // Try to find by name
  const files = DriveApp.searchFiles("title = '" + APP_NAME + "' and mimeType = 'application/vnd.google-apps.spreadsheet'");
  if (files.hasNext()) {
    const file = files.next();
    SCRIPT_PROP.setProperty('SPREADSHEET_ID', file.getId());
    return SpreadsheetApp.openById(file.getId());
  }
  // Create new
  const ss = SpreadsheetApp.create(APP_NAME);
  SCRIPT_PROP.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getSheetByName(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureSetup() {
  const ss = getOrCreateSpreadsheet();

  // Settings
  const settings = getSheetByName(ss, SETTINGS_SHEET);
  if (settings.getLastRow() === 0) settings.clear();
  const first = settings.getRange(1,1,1,2).getValues()[0];
  if ((first[0]+ '').toLowerCase() !== 'key' || (first[1]+ '').toLowerCase() !== 'value') {
    settings.clear();
    settings.getRange(1,1,1,2).setValues([[ 'key','value' ]]);
  }
  // Ensure default settings exist
  const kv = getSettingsMap();
  const toWrite = [];
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (!(k in kv)) toWrite.push([k, DEFAULT_SETTINGS[k]]);
  });
  if (toWrite.length) settings.getRange(settings.getLastRow()+1, 1, toWrite.length, 2).setValues(toWrite);

  // Ensure instruments table header exists (leave a blank row between)
  const instrumentsHeaderRow = findRow(settings, INSTRUMENT_HEADERS[0], 1) || 0;
  if (!instrumentsHeaderRow) {
    const startRow = settings.getLastRow() + 2; // one blank row
    settings.getRange(startRow, 1, 1, INSTRUMENT_HEADERS.length).setValues([INSTRUMENT_HEADERS]);
  }

  // Trades sheet
  const trades = getSheetByName(ss, TRADES_SHEET);
  const trh = trades.getRange(1,1,1,TRADES_HEADERS.length).getValues()[0];
  if (trh.join('|') !== TRADES_HEADERS.join('|')) {
    trades.clear();
    trades.getRange(1,1,1,TRADES_HEADERS.length).setValues([TRADES_HEADERS]);
  }

  // Balances sheet
  const balances = getSheetByName(ss, BALANCES_SHEET);
  const blh = balances.getRange(1,1,1,BALANCES_HEADERS.length).getValues()[0];
  if (blh.join('|') !== BALANCES_HEADERS.join('|')) {
    balances.clear();
    balances.getRange(1,1,1,BALANCES_HEADERS.length).setValues([BALANCES_HEADERS]);
  }
}

function findRow(sheet, text, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const rng = sheet.getRange(1,col,lastRow,1).getValues();
  for (let i=0;i<rng.length;i++) {
    if ((rng[i][0]+ '').toLowerCase() === (text+ '').toLowerCase()) return i+1;
  }
  return null;
}

/** Settings helpers */
function getSettingsMap() {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, SETTINGS_SHEET);
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2,1,last-1,2).getValues() : [];
  const map = {};
  vals.forEach(r => {
    const k = (r[0]||'').toString().trim();
    if (k) map[k] = tryParseNumber(r[1]);
  });
  return map;
}

function getInstruments() {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, SETTINGS_SHEET);
  const last = sh.getLastRow();
  const headerRow = findRow(sh, INSTRUMENT_HEADERS[0], 1);
  if (!headerRow) return [];
  const nCols = INSTRUMENT_HEADERS.length;
  const nRows = last - headerRow;
  if (nRows <= 0) return [];
  const data = sh.getRange(headerRow+1, 1, nRows, nCols).getValues();
  const list = [];
  data.forEach(r => {
    const symbol = (r[0]||'').toString().trim();
    if (!symbol) return;
    list.push({
      symbol,
      tick_size: tryParseNumber(r[1]),
      tick_value: tryParseNumber(r[2]),
      contract_size: tryParseNumber(r[3])
    });
  });
  return list;
}

function upsertInstruments(instruments) {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, SETTINGS_SHEET);
  const headerRow = findRow(sh, INSTRUMENT_HEADERS[0], 1);
  if (!headerRow) throw new Error('Instruments header not found');
  // Build map of existing rows by symbol
  const existing = getInstruments();
  const rowIndexBySymbol = {};
  existing.forEach((inst, idx) => {
    rowIndexBySymbol[inst.symbol] = headerRow + 1 + idx;
  });
  instruments.forEach(inst => {
    const row = rowIndexBySymbol[inst.symbol];
    const rec = [
      inst.symbol,
      Number(inst.tick_size || 0),
      Number(inst.tick_value || 0),
      Number(inst.contract_size || 1)
    ];
    if (row) {
      sh.getRange(row, 1, 1, INSTRUMENT_HEADERS.length).setValues([rec]);
    } else {
      const insertRow = sh.getLastRow() + 1;
      sh.getRange(insertRow, 1, 1, INSTRUMENT_HEADERS.length).setValues([rec]);
    }
  });
}

/** Trades helpers */
function getTrades(filters) {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, TRADES_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2,1,lastRow-1,TRADES_HEADERS.length).getValues();
  const res = data.map(r => rowToTrade(r));
  return res.filter(t => applyTradeFilter(t, filters||{}));
}

function rowToTrade(r) {
  const o = {};
  TRADES_HEADERS.forEach((h, idx) => { o[h] = r[idx]; });
  // Parse numerics
  ['entry','stop','take_profit','qty','rr','risk_amount','planned_tp_amount','planned_sl_amount','pnl','balance_after','commission','fees'].forEach(k => {
    if (o[k] === '' || o[k] === null || o[k] === undefined) return;
    o[k] = tryParseNumber(o[k]);
  });
  return o;
}

function tradeToRow(t) {
  return [
    t.id, t.date, t.time, t.symbol, t.direction,
    numOrBlank(t.entry), numOrBlank(t.stop), numOrBlank(t.take_profit), numOrBlank(t.qty), numOrBlank(t.rr),
    numOrBlank(t.risk_amount), numOrBlank(t.planned_tp_amount), numOrBlank(t.planned_sl_amount),
    t.status || 'Planned', numOrBlank(t.pnl), numOrBlank(t.balance_after),
    t.notes || '', numOrBlank(t.commission), numOrBlank(t.fees), t.created_at, t.updated_at
  ];
}

function applyTradeFilter(t, f) {
  if (f.status && f.status.length) {
    if (Array.isArray(f.status)) {
      if (f.status.indexOf(t.status) === -1) return false;
    } else if (t.status !== f.status) return false;
  }
  if (f.symbol && t.symbol !== f.symbol) return false;
  if (f.start_date && t.date < f.start_date) return false;
  if (f.end_date && t.date > f.end_date) return false;
  return true;
}

function getNextTradeId() {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, TRADES_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  const lastId = Number(sh.getRange(lastRow, 1).getValue());
  return (isNaN(lastId) ? 0 : lastId) + 1;
}

/** Balances helpers */
function getCurrentBalance() {
  const ss = getOrCreateSpreadsheet();
  const balances = getSheetByName(ss, BALANCES_SHEET);
  const last = balances.getLastRow();
  if (last >= 2) {
    const bal = balances.getRange(last, 2).getValue();
    const num = Number(bal);
    if (!isNaN(num)) return num;
  }
  const map = getSettingsMap();
  return Number(map.starting_balance || DEFAULT_SETTINGS.starting_balance);
}

function appendBalanceChange(change, reason) {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, BALANCES_SHEET);
  const prev = getCurrentBalance();
  const next = prev + Number(change || 0);
  const row = [ new Date().toISOString(), next, Number(change||0), reason || '' ];
  sh.getRange(sh.getLastRow()+1, 1, 1, BALANCES_HEADERS.length).setValues([row]);
  return next;
}

/** Core calculations */
function computePlan({ balance, tp_pct, sl_pct, entry, stop, direction, instrument }) {
  const risk_amount = round2(balance * sl_pct);
  const planned_tp_amount = round2(balance * tp_pct);
  const planned_sl_amount = round2(balance * sl_pct);
  const rr = safeDiv(planned_tp_amount, planned_sl_amount);

  let qty = '';
  if (isFiniteNumber(entry) && isFiniteNumber(stop) && instrument && isFiniteNumber(instrument.tick_size) && isFiniteNumber(instrument.tick_value)) {
    const ticks = Math.abs(entry - stop) / instrument.tick_size;
    const riskPerContract = ticks * instrument.tick_value;
    if (riskPerContract > 0) qty = Math.max(1, Math.floor(risk_amount / riskPerContract));
  }

  // Optional symmetric take profit around entry/stop
  let take_profit = '';
  if (isFiniteNumber(entry) && isFiniteNumber(stop)) {
    const delta = Math.abs(entry - stop);
    if (direction === 'Long') take_profit = roundTo(entry + delta, instrument && instrument.tick_size);
    else if (direction === 'Short') take_profit = roundTo(entry - delta, instrument && instrument.tick_size);
  }

  return { risk_amount, planned_tp_amount, planned_sl_amount, rr, qty, take_profit };
}

function round2(n){ return Math.round(Number(n||0)*100)/100; }
function roundTo(n, step){ if(!step) return round2(n); const k=Math.round(n/step)*step; return round2(k); }
function numOrBlank(v){ const n = Number(v); return isNaN(n) || v === '' || v === null || v === undefined ? '' : n; }
function tryParseNumber(v){ const n = Number(v); return isNaN(n) ? v : n; }
function isFiniteNumber(v){ return typeof v === 'number' && isFinite(v); }
function safeDiv(a,b){ a=Number(a||0); b=Number(b||0); return b===0?0:round2(a/b); }

/** API router */
function handleApi(method, path, e, body) {
  try {
    if (method === 'GET' && path === '/api/settings') {
      const map = getSettingsMap();
      const instruments = getInstruments();
      return json({ ok: true, settings: map, instruments, balance_current: getCurrentBalance(), webAppUrl: ScriptApp.getService().getUrl() });
    }
    if (method === 'POST' && path === '/api/settings') {
      // Update simple settings and instruments (optional)
      const allowed = ['starting_balance','daily_target','daily_max_loss','tp_pct','sl_pct'];
      const ss = getOrCreateSpreadsheet();
      const sh = getSheetByName(ss, SETTINGS_SHEET);
      const map = getSettingsMap();
      const updates = [];
      allowed.forEach(k => {
        if (body && Object.prototype.hasOwnProperty.call(body, k)) {
          map[k] = tryParseNumber(body[k]);
        }
      });
      // rewrite settings table cleanly (below header, above instruments header)
      const instHeaderRow = findRow(sh, INSTRUMENT_HEADERS[0], 1) || (sh.getLastRow()+1);
      // Clear existing settings rows (2..instHeaderRow-1)
      if (instHeaderRow > 2) sh.getRange(2,1,instHeaderRow-2,2).clearContent();
      const rows = Object.keys(map).map(k => [k, map[k]]);
      if (rows.length) sh.getRange(2,1,rows.length,2).setValues(rows);

      if (Array.isArray(body.instruments)) {
        upsertInstruments(body.instruments);
      }
      return json({ ok: true, settings: map, instruments: getInstruments() });
    }

    if (path === '/api/trades' && (method === 'GET' || method === 'POST')) {
      if (method === 'GET') {
        const filters = {
          status: paramToArray(e.parameter && e.parameter.status),
          symbol: e.parameter && e.parameter.symbol || '',
          start_date: e.parameter && e.parameter.start_date || '',
          end_date: e.parameter && e.parameter.end_date || ''
        };
        return json({ ok: true, trades: getTrades(filters) });
      }
      if (method === 'POST') {
        return json(createTrade(body||{}));
      }
    }

    // PUT /api/trades/:id (via _method=PUT)
    const m = path.match(/^\/api\/trades\/([^\/]+)$/);
    if (m && method === 'PUT') {
      const id = m[1];
      return json(updateTrade(id, body||{}));
    }

    // POST /api/trades/:id/mark
    const m2 = path.match(/^\/api\/trades\/([^\/]+)\/mark$/);
    if (m2 && method === 'POST') {
      const id = m2[1];
      return json(markTrade(id, body||{}));
    }

    return json({ ok: false, error: 'Not found', path, method });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function paramToArray(v){ if(!v) return null; if(Array.isArray(v)) return v; return String(v).split(',').map(s=>s.trim()).filter(Boolean); }

/** Create trade */
function createTrade(input) {
  const nowIso = new Date().toISOString();
  const settings = getSettingsMap();
  const instruments = getInstruments();
  const inst = instruments.find(x => x.symbol === input.symbol);

  const balance = getCurrentBalance();
  const tp_pct = isFiniteNumber(input.tp_pct) ? input.tp_pct : Number(settings.tp_pct || DEFAULT_SETTINGS.tp_pct);
  const sl_pct = isFiniteNumber(input.sl_pct) ? input.sl_pct : Number(settings.sl_pct || DEFAULT_SETTINGS.sl_pct);

  // Basic validation
  if (!input.symbol) throw new Error('חסר סימבול');
  if (!input.direction || ['Long','Short'].indexOf(input.direction) === -1) throw new Error('כיוון לא תקין');
  if (isFiniteNumber(input.entry) && isFiniteNumber(input.stop) && Number(input.entry) === Number(input.stop)) throw new Error('Entry ו-Stop לא יכולים להיות זהים');

  const plan = computePlan({
    balance,
    tp_pct,
    sl_pct,
    entry: isFiniteNumber(input.entry) ? Number(input.entry) : null,
    stop: isFiniteNumber(input.stop) ? Number(input.stop) : null,
    direction: input.direction,
    instrument: inst
  });

  const t = {
    id: getNextTradeId(),
    date: input.date || formatDate(new Date()),
    time: input.time || formatTime(new Date()),
    symbol: input.symbol,
    direction: input.direction,
    entry: isFiniteNumber(input.entry) ? Number(input.entry) : '',
    stop: isFiniteNumber(input.stop) ? Number(input.stop) : '',
    take_profit: isFiniteNumber(input.take_profit) ? Number(input.take_profit) : (input.auto_take_profit ? plan.take_profit : ''),
    qty: isFiniteNumber(input.qty) ? Number(input.qty) : (plan.qty || ''),
    rr: round2(plan.rr),
    risk_amount: round2(plan.risk_amount),
    planned_tp_amount: round2(plan.planned_tp_amount),
    planned_sl_amount: round2(plan.planned_sl_amount),
    status: input.status || 'Planned',
    pnl: '',
    balance_after: '',
    notes: input.notes || '',
    commission: isFiniteNumber(input.commission) ? Number(input.commission) : 0,
    fees: isFiniteNumber(input.fees) ? Number(input.fees) : 0,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, TRADES_SHEET);
  sh.getRange(sh.getLastRow()+1,1,1,TRADES_HEADERS.length).setValues([tradeToRow(t)]);

  return { ok: true, trade: t };
}

/** Update trade fields or status */
function updateTrade(id, patch) {
  const ss = getOrCreateSpreadsheet();
  const sh = getSheetByName(ss, TRADES_SHEET);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('אין עסקאות');
  const ids = sh.getRange(2,1,last-1,1).getValues().map(r => r[0]);
  const idx = ids.findIndex(v => String(v) === String(id));
  if (idx === -1) throw new Error('עסקה לא נמצאה');
  const rowIdx = 2 + idx;
  const rowVals = sh.getRange(rowIdx,1,1,TRADES_HEADERS.length).getValues()[0];
  let t = rowToTrade(rowVals);

  // Merge patch
  const fields = ['date','time','symbol','direction','entry','stop','take_profit','qty','notes','commission','fees','status'];
  fields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(patch, f)) {
      t[f] = (['entry','stop','take_profit','qty','commission','fees'].indexOf(f) >= 0) ? tryParseNumber(patch[f]) : patch[f];
    }
  });

  // If status causes PnL booking
  const status = t.status;
  let pnlChange = null;
  if (['TP','SL','BE','Partial'].indexOf(status) >= 0) {
    pnlChange = computePnlForStatus(t, status, patch);
    // Deduct costs
    pnlChange -= Number(t.commission||0) + Number(t.fees||0);
    t.pnl = round2(pnlChange);
    const newBalance = appendBalanceChange(t.pnl, `Trade ${t.id} ${status}`);
    t.balance_after = round2(newBalance);
  }

  t.updated_at = new Date().toISOString();
  sh.getRange(rowIdx,1,1,TRADES_HEADERS.length).setValues([tradeToRow(t)]);
  return { ok: true, trade: t };
}

function markTrade(id, body) {
  const action = body && body.action;
  if (!action) throw new Error('Missing mark action');
  const patch = {};
  patch.status = action;
  if (action === 'Partial') {
    if (isFiniteNumber(body.amount)) patch.amount = Number(body.amount);
    if (isFiniteNumber(body.percent)) patch.percent = Number(body.percent);
  }
  return updateTrade(id, patch);
}

function computePnlForStatus(t, status, extra) {
  const settings = getSettingsMap();
  const balance = getCurrentBalance();
  const tp_amount = Number(t.planned_tp_amount || balance * (settings.tp_pct || DEFAULT_SETTINGS.tp_pct));
  const sl_amount = Number(t.planned_sl_amount || balance * (settings.sl_pct || DEFAULT_SETTINGS.sl_pct));
  if (status === 'TP') return round2(+Math.abs(tp_amount));
  if (status === 'SL') return round2(-Math.abs(sl_amount));
  if (status === 'BE') return 0;
  if (status === 'Partial') {
    // Compute using percent or absolute amount, fallback 50%
    let amt = 0;
    if (extra && isFiniteNumber(extra.amount)) amt = Number(extra.amount);
    else if (extra && isFiniteNumber(extra.percent)) amt = (tp_amount * Number(extra.percent))/100;
    else amt = tp_amount * 0.5;
    return round2(amt);
  }
  return 0;
}

/** Formatting */
function formatDate(d){ return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function formatTime(d){ return Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm'); }

/** Expose web app URL to client template */
function getWebAppUrl(){ return ScriptApp.getService().getUrl(); }
