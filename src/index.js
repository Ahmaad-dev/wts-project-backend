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
const lastPersist = new Map()

const app = express()
app.use(express.json())

const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (allowed.length) app.use(cors({ origin: allowed }))
else app.use(cors())

app.use((req, res, next) => {
  const t0 = Date.now()
  const id = Math.random().toString(36).slice(2)
  res.setHeader('x-req-id', id)
  res.on('finish', () => {
    console.log(JSON.stringify({
      id, method: req.method, url: req.url,
      status: res.statusCode, dur_ms: Date.now() - t0
    }))
  })
  next()
})

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: allowed.length ? allowed : '*' } })

console.log('startup: loading seed and init db')
const seed = JSON.parse(readFileSync(new URL('./initial-data.json', import.meta.url)))
try {
  await initDb(seed)
  console.log('startup: db ready')
} catch (e) {
  console.error('startup: initDb failed', e)
  process.exit(1)
}

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

app.get('/healthz', (req, res) => res.send('ok'))
app.get('/health', (req, res) => res.send('ok'))
app.get('/readyz', async (req, res) => {
  try { await sequelize.authenticate(); res.send('ok') }
  catch { res.status(500).send('db-error') }
})

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
  if (temperatur !== undefined) m.temperatur = parseFloat(temperatur)
  if (aktuelleLeistung !== undefined) m.aktuelleLeistung = parseFloat(aktuelleLeistung)
  if (betriebsminutenGesamt !== undefined) m.betriebsminutenGesamt = parseFloat(betriebsminutenGesamt)
  if (geschwindigkeit !== undefined) m.geschwindigkeit = parseFloat(geschwindigkeit)
  await m.save()
  await emitTelemetry(m)
  res.json({ ok: true })
})

function safeInterval(name, fn, ms) {
  let running = false
  return setInterval(async () => {
    if (running) return
    running = true
    try { await fn() } catch (err) { console.error(`[job:${name}]`, err) }
    finally { running = false }
  }, ms)
}

async function updateTemperatur(){
  const rows = await Machine.findAll()
  for (const m of rows){
    const drift = Math.random() - 0.5
    m.temperatur = clamp((m.temperatur ?? 40) + drift, 10, 80)
    if (!Number.isFinite(m.temperatur)) m.temperatur = 40
    const last = lastPersist.get(m.id) || 0
    const now = Date.now()
    if (now - last >= PERSIST_EVERY_MS) {
      await m.save()
      await emitTelemetry(m)
      lastPersist.set(m.id, now)
    } else {
      await emitSocketOnly(m)
    }
  }
}

async function updateLeistungUndGeschwindigkeit(){
  const rows = await Machine.findAll()
  const now = Date.now()
  for (const m of rows){
    const dL = (Math.random()*2) - 1
    const dV = (Math.random()*0.2) - 0.1
    m.aktuelleLeistung = clamp((m.aktuelleLeistung ?? 50) + dL, 0, 100)
    m.geschwindigkeit = clamp((m.geschwindigkeit ?? 2) + dV, 0, 10)
    if (!Number.isFinite(m.aktuelleLeistung)) m.aktuelleLeistung = 0
    if (!Number.isFinite(m.geschwindigkeit))  m.geschwindigkeit  = 0
    const last = lastPersist.get(m.id) || 0
    if (now - last >= PERSIST_EVERY_MS) {
      await m.save()
      await emitTelemetry(m)
      lastPersist.set(m.id, now)
    } else {
      await emitSocketOnly(m)
    }
  }
}

async function updateDurchlaufzeit(){
  const rows = await Machine.findAll()
  for (const m of rows){
    m.durchgaengigeLaufzeit = (m.durchgaengigeLaufzeit ?? 0) + (20/60)
    await m.save()
  }
}

async function updateBetriebsminuten(){
  const rows = await Machine.findAll()
  const now = Date.now()
  for (const m of rows){
    m.betriebsminutenGesamt = (m.betriebsminutenGesamt ?? 0) + 1
    const last = lastPersist.get(m.id) || 0
    if (now - last >= PERSIST_EVERY_MS) {
      await m.save()
      await emitTelemetry(m)
      lastPersist.set(m.id, now)
    } else {
      await emitSocketOnly(m)
    }
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

app.use((err, req, res, next) => {
  console.error('unhandled_error', err)
  res.status(500).json({ error: 'internal' })
})

const port = process.env.PORT || 8080

function shutdown() {
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 10000)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

httpServer.listen(port, () => {
  console.log(JSON.stringify({ event: 'listening', port, node_env: process.env.NODE_ENV || 'dev' }))
})

io.on('connection', s => {
  console.log(JSON.stringify({ event: 'socket_connected', id: s.id, origin: s.handshake.headers.origin || null }))
})

if (process.env.DEBUG === '1') {
  app.get('/debug/env', (req, res) => {
    const mask = v => (v ? `${String(v).slice(0,2)}***` : null)
    res.json({
      DB_HOST: mask(process.env.DB_HOST),
      DB_NAME: mask(process.env.DB_NAME),
      DB_USER: mask(process.env.DB_USER),
      DB_PASS: process.env.DB_PASS ? '***' : null,
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || null
    })
  })
  app.get('/debug/db', async (req, res) => {
    try { await sequelize.authenticate(); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
  })
}
