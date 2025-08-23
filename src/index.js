import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { readFileSync } from 'fs'
import { Machine, Telemetry, initDb } from './models.js'

const app = express()
app.use(cors())
app.use(express.json())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

const seed = JSON.parse(readFileSync(new URL('../initial-data.json', import.meta.url)))
await initDb(seed)

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)) }
function round3(n){ return Math.round(n*1000)/1000 }
function ddmmyyyyToDate(s){ const [d,m,y]=s.split('.').map(n=>parseInt(n,10)); return new Date(y, m-1, d) }
function dateToDDMMYYYY(dt){ const dd=String(dt.getDate()).padStart(2,'0'); const mm=String(dt.getMonth()+1).padStart(2,'0'); const yy=dt.getFullYear(); return `${dd}.${mm}.${yy}` }

async function emitTelemetry(m){
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

app.get('/api/machines/basic', async (req, res) => {
  const rows = await Machine.findAll({ order: [['name','ASC']] })
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
    temperatur: `${m.temperatur}°`,
    durchgängigeLaufzeit: `${round3(m.durchgaengigeLaufzeit)} Minuten`,
    Motor: {
      aktuelleLeistung: `${round3(m.aktuelleLeistung)}%`,
      betriebsminutenGesamt: `${m.betriebsminutenGesamt} Minuten`,
      letzteWartung: m.letzteWartung
    },
    geschwindigkeit: `${round3(m.geschwindigkeit)} m/s`
  })
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

async function updateTemperatur(){
  const rows = await Machine.findAll()
  for (const m of rows){
    const drift = Math.random() - 0.5
    m.temperatur = clamp((m.temperatur ?? 40) + drift, 10, 80)
    await m.save()
    await emitTelemetry(m)
  }
}

async function updateLeistungUndGeschwindigkeit(){
  const rows = await Machine.findAll()
  for (const m of rows){
    const dL = (Math.random()*2) - 1
    const dV = (Math.random()*0.2) - 0.1
    m.aktuelleLeistung = clamp((m.aktuelleLeistung ?? 50) + dL, 0, 100)
    m.geschwindigkeit = clamp((m.geschwindigkeit ?? 2) + dV, 0, 10)
    await m.save()
    await emitTelemetry(m)
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
  for (const m of rows){
    m.betriebsminutenGesamt = (m.betriebsminutenGesamt ?? 0) + 1
    await m.save()
    await emitTelemetry(m)
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

setInterval(updateLeistungUndGeschwindigkeit, 1000)
setInterval(updateTemperatur, 60*1000)
setInterval(updateDurchlaufzeit, 20*1000)
setInterval(updateBetriebsminuten, 60*1000)
setInterval(updateLetzteWartung, 24*60*60*1000)

const port = process.env.PORT || 8080
httpServer.listen(port, () => {})
