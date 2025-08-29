import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Op } from 'sequelize'
import { Machine, Telemetry, initDb, sequelize } from './models.js'
import swaggerUi from 'swagger-ui-express'

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))
process.on('uncaughtException', (e) => console.error('uncaughtException', e))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const specPath = process.env.OPENAPI_PATH || path.join(rootDir, 'openapi.json')
const seedPath = process.env.SEED_PATH || path.join(rootDir, 'initial-data.json')

const PERSIST_EVERY_MS = parseInt(process.env.TELEMETRY_DB_SAVE_MS || '5000', 10)
const lastPersist = new Map()

const app = express()
app.use(express.json())

let openapi = null
try {
  openapi = JSON.parse(readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf8'))
} catch {}

if (openapi) {
  app.get('/api/openapi.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.json(openapi)
  })
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi))
}


const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
const isDev = process.env.NODE_ENV !== 'production'
app.use(cors({
  origin: (origin, cb) => {
    if (isDev) return cb(null, true)
    if (!origin) return cb(null, true)
    if (allowed.includes(origin)) return cb(null, true)
    cb(new Error('CORS'), false)
  },
  methods: ['GET','POST'],
}))

app.use((req, res, next) => {
  const t0 = Date.now()
  const id = Math.random().toString(36).slice(2)
  res.setHeader('x-req-id', id)
  res.on('finish', () => {
    console.log(JSON.stringify({ id, method: req.method, url: req.url, status: res.statusCode, dur_ms: Date.now() - t0 }))
  })
  next()
})

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: allowed.length ? allowed : true } })

console.log('startup: loading seed and init db', { seedPath })
let seed
try {
  seed = JSON.parse(readFileSync(seedPath, 'utf8'))
} catch (e) {
  console.error('startup: failed to read seed', e); process.exit(1)
}
try {
  await initDb(seed)
  console.log('startup: db ready')
} catch (e) {
  console.error('startup: initDb failed', e); process.exit(1)
}


function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function n(v) { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? x : 0 }
function fx(v, d) { return n(v).toFixed(d) }
function round3(x) { return Math.round(n(x) * 1000) / 1000 }
function ddmmyyyyToDate(s){ const [d,m,y]=s.split('.').map(n=>parseInt(n,10)); return new Date(y, m-1, d) }
function dateToDDMMYYYY(dt){ const dd=String(dt.getDate()).padStart(2,'0'); const mm=String(dt.getMonth()+1).padStart(2,'0'); const yy=dt.getFullYear(); return `${dd}.${mm}.${yy}` }

async function emitSocketOnly(m) {
  io.emit('telemetry', {
    name: m.name,
    temperatur: n(m.temperatur),
    aktuelleLeistung: n(m.aktuelleLeistung),
    betriebsminutenGesamt: n(m.betriebsminutenGesamt),
    geschwindigkeit: n(m.geschwindigkeit),
    timestamp: new Date().toISOString()
  })
}

async function emitTelemetry(m) {
  const t = await Telemetry.create({
    temperatur: fx(m.temperatur, 2),
    aktuelleLeistung: fx(m.aktuelleLeistung, 2),
    betriebsminutenGesamt: fx(m.betriebsminutenGesamt, 1),
    geschwindigkeit: fx(m.geschwindigkeit, 2),
    MachineId: m.id
  })
  io.emit('telemetry', {
    name: m.name,
    temperatur: n(m.temperatur),
    aktuelleLeistung: n(m.aktuelleLeistung),
    betriebsminutenGesamt: n(m.betriebsminutenGesamt),
    geschwindigkeit: n(m.geschwindigkeit),
    timestamp: t.createdAt
  })
}

app.get('/health', (req, res) => res.status(200).json({ ok: true }))
app.get('/readyz', async (req, res) => {
  try { await sequelize.authenticate(); res.json({ ok: true }) }
  catch (e) { res.status(503).json({ ok: false }) }
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
  const rows = await Telemetry.findAll({ where, order: [['createdAt', 'DESC']], limit: Math.min(+limit, 2000) })
  const out = rows.reverse().map(r => ({
    temperatur: n(r.temperatur),
    aktuelleLeistung: n(r.aktuelleLeistung),
    betriebsminutenGesamt: n(r.betriebsminutenGesamt),
    geschwindigkeit: n(r.geschwindigkeit),
    createdAt: r.createdAt
  }))
  res.json(out)
})

app.post('/api/machines/:name/telemetry', async (req, res) => {
  const { temperatur, aktuelleLeistung, betriebsminutenGesamt, geschwindigkeit } = req.body
  const m = await Machine.findOne({ where: { name: req.params.name } })
  if (!m) return res.status(404).json({ error: 'not found' })

  const t = temperatur !== undefined ? fx(temperatur, 2) : null
  const a = aktuelleLeistung !== undefined ? fx(aktuelleLeistung, 2) : null
  const b = betriebsminutenGesamt !== undefined ? fx(betriebsminutenGesamt, 1) : null
  const v = geschwindigkeit !== undefined ? fx(geschwindigkeit, 2) : null

  await sequelize.query(
    'UPDATE [Machines] SET ' +
    (t !== null ? 'temperatur = CAST(? AS DECIMAL(5,2)),' : '') +
    (a !== null ? 'aktuelleLeistung = CAST(? AS DECIMAL(5,2)),' : '') +
    (b !== null ? 'betriebsminutenGesamt = CAST(? AS DECIMAL(12,1)),' : '') +
    (v !== null ? 'geschwindigkeit = CAST(? AS DECIMAL(5,2)),' : '') +
    ' [name] = [name] WHERE [id] = ?',
    { replacements: [ ...[t,a,b,v].filter(x => x !== null), m.id ] }
  )

  const fresh = await Machine.findByPk(m.id)
  await emitTelemetry(fresh)
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
    const t = fx(clamp(n(m.temperatur ?? 40) + drift, 10, 80), 2)
    await sequelize.query(
      'UPDATE [Machines] SET temperatur = CAST(? AS DECIMAL(5,2)) WHERE id = ?',
      { replacements: [t, m.id] }
    )
    const fresh = await Machine.findByPk(m.id)
    await emitTelemetry(fresh)
  }
}

async function updateLeistungUndGeschwindigkeit(){
  const rows = await Machine.findAll()
  const now = Date.now()
  for (const m of rows){
    const dL = (Math.random()*2) - 1
    const dV = (Math.random()*0.2) - 0.1
    const a = fx(clamp(n(m.aktuelleLeistung ?? 50) + dL, 0, 100), 2)
    const v = fx(clamp(n(m.geschwindigkeit ?? 2) + dV, 0, 10), 2)

    const last = lastPersist.get(m.id) || 0
    if (now - last >= PERSIST_EVERY_MS) {
      await sequelize.query(
        'UPDATE [Machines] SET aktuelleLeistung = CAST(? AS DECIMAL(5,2)), geschwindigkeit = CAST(? AS DECIMAL(5,2)) WHERE id = ?',
        { replacements: [a, v, m.id] }
      )
      const fresh = await Machine.findByPk(m.id)
      await emitTelemetry(fresh)
      lastPersist.set(m.id, now)
    } else {
      m.aktuelleLeistung = a; m.geschwindigkeit = v
      await emitSocketOnly(m)
    }
  }
}

async function updateDurchlaufzeit(){
  const rows = await Machine.findAll()
  for (const m of rows){
    const d = fx(n(m.durchgaengigeLaufzeit ?? 0) + (20/60), 3)
    await sequelize.query(
      'UPDATE [Machines] SET durchgaengigeLaufzeit = CAST(? AS DECIMAL(12,3)) WHERE id = ?',
      { replacements: [d, m.id] }
    )
  }
}

async function updateBetriebsminuten(){
  const rows = await Machine.findAll()
  const now = Date.now()
  for (const m of rows){
    const b = fx(n(m.betriebsminutenGesamt ?? 0) + 1, 1)
    const last = lastPersist.get(m.id) || 0
    if (now - last >= PERSIST_EVERY_MS) {
      await sequelize.query(
        'UPDATE [Machines] SET betriebsminutenGesamt = CAST(? AS DECIMAL(12,1)) WHERE id = ?',
        { replacements: [b, m.id] }
      )
      const fresh = await Machine.findByPk(m.id)
      await emitTelemetry(fresh)
      lastPersist.set(m.id, now)
    } else {
      m.betriebsminutenGesamt = b
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
    await sequelize.query(
      'UPDATE [Machines] SET letzteWartung = ? WHERE id = ?',
      { replacements: [dateToDDMMYYYY(next), m.id] }
    )
  }
}

safeInterval('updateLeistungUndGeschwindigkeit', updateLeistungUndGeschwindigkeit, 1000)
safeInterval('updateTemperatur', updateTemperatur, 60000)
safeInterval('updateDurchlaufzeit', updateDurchlaufzeit, 20000)
safeInterval('updateBetriebsminuten', updateBetriebsminuten, 60000)
safeInterval('updateLetzteWartung', updateLetzteWartung, 86400000)

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

if (process.env.ENABLE_DEBUG === '1') {
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
    catch { res.status(500).json({ ok: false }) }
  })
}

const METRICS = [
  { key: 'temperatur', label: 'Temperatur', unit: '°C', description: 'Aktuelle Temperatur der Maschine' },
  { key: 'aktuelleLeistung', label: 'Aktuelle Leistung', unit: '%', description: 'Prozentuale Auslastung' },
  { key: 'betriebsminutenGesamt', label: 'Betriebsminuten gesamt', unit: 'min', description: 'Gesamte Betriebszeit' },
  { key: 'geschwindigkeit', label: 'Geschwindigkeit', unit: 'm/s', description: 'Aktuelle Geschwindigkeit' },
]

app.get('/api/machines/names', async (req, res) => {
  const rows = await Machine.findAll({ attributes: ['name'], order: [['name', 'ASC']] })
  res.json({ names: rows.map(r => r.name) })
})

app.get('/api/meta/metrics', (req, res) => {
  res.json({ metrics: METRICS })
})

app.get('/api/meta/formats/datetime', (req, res) => {
  res.json({
    format: 'ISO 8601 (RFC 3339)',
    examples: ['2025-08-29T12:34:56Z', '2025-08-29T12:34:56+02:00'],
    note: "UTC 'Z' empfohlen.",
    now: new Date().toISOString()
  })
})

app.get('/api/machines/:name/metrics/:key', async (req, res) => {
  const { name, key } = req.params
  const { since, limit = 50 } = req.query
  if (!METRICS.some(m => m.key === key)) return res.status(400).json({ error: 'invalid_metric' })
  const m = await Machine.findOne({ where: { name } })
  if (!m) return res.status(404).json({ error: 'not found' })
  const where = { MachineId: m.id }
  if (since) where.createdAt = { [Op.gte]: new Date(since) }
  const rows = await Telemetry.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(limit, 10) || 50, 2000)
  })
  const out = rows.reverse().map(r => ({ createdAt: r.createdAt, value: Number(r[key]) }))
  res.json(out)
})
