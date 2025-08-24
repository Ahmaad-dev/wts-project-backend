import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { readFileSync } from 'fs'
import { Op } from 'sequelize'
import { Machine, Telemetry, initDb, sequelize } from './models.js'

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))
process.on('uncaughtException', (e) => console.error('uncaughtException', e))

const PERSIST_EVERY_MS = parseInt(process.env.TELEMETRY_DB_SAVE_MS || '5000', 10)
const lastPersist = new Map() // MachineId -> timestamp

const app = express()
app.use(express.json())

// CORS
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (allowed.length) app.use(cors({ origin: allowed }))
else app.use(cors())

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: allowed.length ? allowed : '*' } })

// Seed laden & DB init
const seed = JSON.parse(readFileSync(new URL('../initial-data.json', import.meta.url)))
await initDb(seed)

// Datenbankwerte beim Start bereinigen
await cleanupCorruptedData();

// Helpers
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function round3(n) { return Math.round(n * 1000) / 1000 }
function ddmmyyyyToDate(s){ const [d,m,y]=s.split('.').map(n=>parseInt(n,10)); return new Date(y, m-1, d) }
function dateToDDMMYYYY(dt){ const dd=String(dt.getDate()).padStart(2,'0'); const mm=String(dt.getMonth()+1).padStart(2,'0'); const yy=dt.getFullYear(); return `${dd}.${mm}.${yy}` }

async function emitSocketOnly(m) {
  io.emit('telemetry', {
    name: m.name,
    temperatur: m.temperatur,
    aktuelleLeistung: m.aktuelleLeistung,
    betriebsminutenGesamt: m.betriebsminutenGesamt,
    geschwindigkeit: m.geschwindigkeit,
    timestamp: new Date().toISOString()
  })
}

async function emitTelemetry(m) {
  const t = await Telemetry.create({
    temperatur: m.temperatur,
    aktuelleLeistung: m.aktuelleLeistung,
    betriebsminutenGesamt: m.betriebsminutenGesamt,
    geschwindigkeit: m.geschwindigkeit,
    MachineId: m.id
  })
  io.emit('telemetry', {
    name: m.name,
    temperatur: m.temperatur,
    aktuelleLeistung: m.aktuelleLeistung,
    betriebsminutenGesamt: m.betriebsminutenGesamt,
    geschwindigkeit: m.geschwindigkeit,
    timestamp: t.createdAt
  })
}

// Health/Ready
app.get('/healthz', (req, res) => res.send('ok'))
app.get('/readyz', async (req, res) => {
  try { await sequelize.authenticate(); res.send('ok') }
  catch { res.status(500).send('db-error') }
})

// API
app.get('/api/machines/basic', async (req, res) => {
  const rows = await Machine.findAll({ order: [['name', 'ASC']] })
  const data = rows.map(r => ({
    name: r.name,
    identifikation: r.identifikation,
    letzteWartung: r.letzteWartung,
    durchgängigeLaufzeit: round3(r.durchgaengigeLaufzeit)
  }))
  res.json({ machines: data })
})

app.get('/api/machines/:name', async (req, res) => {
  const m = await Machine.findOne({ where: { name: req.params.name } })
  if (!m) return res.status(404).json({ error: 'not found' })
  res.json({
    identifikation: m.identifikation,
    temperatur: `${round3(m.temperatur)}°`,
    durchgängigeLaufzeit: `${round3(m.durchgaengigeLaufzeit)} Minuten`,
    Motor: {
      aktuelleLeistung: `${round3(m.aktuelleLeistung)}%`,
      betriebsminutenGesamt: `${round3(m.betriebsminutenGesamt)} Minuten`,
      letzteWartung: m.letzteWartung
    },
    geschwindigkeit: `${round3(m.geschwindigkeit)} m/s`
  })
})

app.get('/api/machines/:name/telemetry', async (req, res) => {
  const { since, limit = 500 } = req.query
  const m = await Machine.findOne({ where: { name: req.params.name } })
  if (!m) return res.status(404).json({ error: 'not found' })
  const where = { MachineId: m.id }
  if (since) where.createdAt = { [Op.gte]: new Date(since) }
  const rows = await Telemetry.findAll({
    where, order: [['createdAt', 'DESC']], limit: Math.min(+limit, 2000)
  })
  res.json(rows.reverse())
})

app.post('/api/machines/:name/telemetry', async (req, res) => {
  const { temperatur, aktuelleLeistung, betriebsminutenGesamt, geschwindigkeit } = req.body
  const m = await Machine.findOne({ where: { name: req.params.name } })
  if (!m) return res.status(404).json({ error: 'not found' })
  
  if (temperatur !== undefined) {
    const temp = parseFloat(temperatur);
    if (Number.isFinite(temp) && temp >= 10 && temp <= 80) {
      m.temperatur = fix3(temp);
    }
  }
  
  if (aktuelleLeistung !== undefined) {
    const leistung = parseFloat(aktuelleLeistung);
    if (Number.isFinite(leistung) && leistung >= 0 && leistung <= 100) {
      m.aktuelleLeistung = fix3(leistung);
    }
  }
  
  if (betriebsminutenGesamt !== undefined) {
    const betrieb = parseFloat(betriebsminutenGesamt);
    if (Number.isFinite(betrieb) && betrieb >= 0 && betrieb <= 999999999999999) {
      m.betriebsminutenGesamt = fix3(betrieb);
    }
  }
  
  if (geschwindigkeit !== undefined) {
    const geschw = parseFloat(geschwindigkeit);
    if (Number.isFinite(geschw) && geschw >= 0 && geschw <= 10) {
      m.geschwindigkeit = fix3(geschw);
    }
  }
  
  await m.save()
  await emitTelemetry(m)
  res.json({ ok: true })
})

// Datenbankwerte bereinigen
async function cleanupCorruptedData() {
  try {
    const machines = await Machine.findAll();
    for (const m of machines) {
      let updated = false;
      
      if (!Number.isFinite(m.aktuelleLeistung) || m.aktuelleLeistung < 0 || m.aktuelleLeistung > 100) {
        m.aktuelleLeistung = 50;
        updated = true;
      }
      
      if (!Number.isFinite(m.geschwindigkeit) || m.geschwindigkeit < 0 || m.geschwindigkeit > 10) {
        m.geschwindigkeit = 2;
        updated = true;
      }
      
      if (!Number.isFinite(m.temperatur) || m.temperatur < 10 || m.temperatur > 80) {
        m.temperatur = 40;
        updated = true;
      }
      
      if (!Number.isFinite(m.durchgaengigeLaufzeit) || m.durchgaengigeLaufzeit < 0 || m.durchgaengigeLaufzeit > 999999999) {
        m.durchgaengigeLaufzeit = 0;
        updated = true;
      }
      
      if (!Number.isFinite(m.betriebsminutenGesamt) || m.betriebsminutenGesamt < 0 || m.betriebsminutenGesamt > 999999999999999) {
        m.betriebsminutenGesamt = 0;
        updated = true;
      }
      
      if (updated) {
        await m.save();
        console.log(`Cleaned up corrupted data for machine: ${m.name}`);
      }
    }
  } catch (err) {
    console.error('Error cleaning up corrupted data:', err);
  }
}

// Hintergrund-Jobs (stabil & ohne Overlap)
function safeInterval(name, fn, ms) {
  let running = false
  return setInterval(async () => {
    if (running) return
    running = true
    try { 
      await fn() 
    } catch (err) { 
      console.error(`[job:${name}]`, err.message || err);
      // Bei wiederholten Fehlern, versuche die Datenbank zu bereinigen
      if (err.message && err.message.includes('ERR_OUT_OF_RANGE')) {
        console.log(`Attempting to cleanup corrupted data due to range error in job: ${name}`);
        try {
          await cleanupCorruptedData();
        } catch (cleanupErr) {
          console.error('Failed to cleanup corrupted data:', cleanupErr.message);
        }
      }
    }
    finally { running = false }
  }, ms)
}

function fix3(n) { 
  if (!Number.isFinite(n)) return 0;
  const fixed = Number(Number(n).toFixed(3));
  if (!Number.isFinite(fixed)) return 0;
  return fixed;
}

async function updateLeistungUndGeschwindigkeit(){
  const rows = await Machine.findAll();
  const now = Date.now();
  for (const m of rows){
    const dL = (Math.random()*2) - 1;
    const dV = (Math.random()*0.2) - 0.1;

    const currentLeistung = Number.isFinite(m.aktuelleLeistung) ? m.aktuelleLeistung : 50;
    const currentGeschwindigkeit = Number.isFinite(m.geschwindigkeit) ? m.geschwindigkeit : 2;

    m.aktuelleLeistung = fix3( clamp(currentLeistung + dL, 0, 100) );
    m.geschwindigkeit  = fix3( clamp(currentGeschwindigkeit + dV, 0, 10) );

    // Zusätzliche Sicherheitsprüfung
    if (!Number.isFinite(m.aktuelleLeistung) || m.aktuelleLeistung < 0 || m.aktuelleLeistung > 100) {
      m.aktuelleLeistung = 50;
    }
    if (!Number.isFinite(m.geschwindigkeit) || m.geschwindigkeit < 0 || m.geschwindigkeit > 10) {
      m.geschwindigkeit = 2;
    }

    const last = lastPersist.get(m.id) || 0;
    if (now - last >= PERSIST_EVERY_MS) {
      await m.save();
      await emitTelemetry(m);
      lastPersist.set(m.id, now);
    } else {
      await emitSocketOnly(m);
    }
  }
}
async function updateTemperatur(){
  const rows = await Machine.findAll();
  for (const m of rows){
    const drift = Math.random() - 0.5;
    const currentTemp = Number.isFinite(m.temperatur) ? m.temperatur : 40;
    m.temperatur = fix3( clamp(currentTemp + drift, 10, 80) );
    
    // Zusätzliche Sicherheitsprüfung
    if (!Number.isFinite(m.temperatur) || m.temperatur < 10 || m.temperatur > 80) {
      m.temperatur = 40;
    }
    
    await m.save();
    await emitTelemetry(m);
  }
}

async function updateDurchlaufzeit(){
  const rows = await Machine.findAll();
  for (const m of rows){
    const currentLaufzeit = Number.isFinite(m.durchgaengigeLaufzeit) ? m.durchgaengigeLaufzeit : 0;
    m.durchgaengigeLaufzeit = fix3(currentLaufzeit + (20/60));
    
    // Sicherheitsprüfung für sehr große Werte
    if (!Number.isFinite(m.durchgaengigeLaufzeit) || m.durchgaengigeLaufzeit > 999999999) {
      m.durchgaengigeLaufzeit = 0;
    }
    
    await m.save();
  }
}

async function updateBetriebsminuten(){
  const rows = await Machine.findAll();
  for (const m of rows){
    const currentBetrieb = Number.isFinite(m.betriebsminutenGesamt) ? m.betriebsminutenGesamt : 0;
    m.betriebsminutenGesamt = fix3(currentBetrieb + 1);
    
    // Sicherheitsprüfung für sehr große Werte  
    if (!Number.isFinite(m.betriebsminutenGesamt) || m.betriebsminutenGesamt > 999999999999999) {
      m.betriebsminutenGesamt = 0;
    }
    
    await m.save();
    await emitTelemetry(m);
  }
}

async function updateLetzteWartung(){
  const rows = await Machine.findAll()
  for (const m of rows){
    if (!m.letzteWartung || String(m.letzteWartung).toLowerCase()==='unknown') continue
    const dt = ddmmyyyyToDate(m.letzteWartung)
    const next = new Date(dt.getTime() + 24*60*60*1000)
    m.letzteWartung = dateToDDMMYYYY(next)
    await m.save()
  }
}

safeInterval('updateLeistungUndGeschwindigkeit', updateLeistungUndGeschwindigkeit, 1000)
safeInterval('updateTemperatur',                updateTemperatur,                60*1000)
safeInterval('updateDurchlaufzeit',             updateDurchlaufzeit,             20*1000)
safeInterval('updateBetriebsminuten',           updateBetriebsminuten,           60*1000)
safeInterval('updateLetzteWartung',             updateLetzteWartung,             24*60*60*1000)

const port = process.env.PORT || 8080

// Graceful Shutdown
function shutdown() {
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 10000)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

httpServer.listen(port, () => {})
