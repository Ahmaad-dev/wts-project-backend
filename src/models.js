import { Sequelize, DataTypes } from 'sequelize'

const SQL_LOG = process.env.SQL_LOG === '1'

const cfg = {
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: 1433,
  dialect: 'mssql',
  logging: SQL_LOG ? (...m) => console.log('[sql]', ...m) : false,
  dialectOptions: { options: { encrypt: true, trustServerCertificate: false } }
}

const missing = ['DB_HOST','DB_NAME','DB_USER','DB_PASS'].filter(k => !process.env[k])
if (missing.length) { throw new Error(`DB env missing: ${missing.join(',')}`) }

export const sequelize = new Sequelize(cfg)

export const Machine = sequelize.define('Machine', {
  name: { type: DataTypes.STRING, allowNull: false },
  identifikation: DataTypes.STRING,
  letzteWartung: DataTypes.STRING,
  durchgaengigeLaufzeit: DataTypes.DECIMAL(12,3),
  temperatur: DataTypes.DECIMAL(5,2),
  aktuelleLeistung: DataTypes.DECIMAL(5,2),
  betriebsminutenGesamt: DataTypes.DECIMAL(12,1),
  geschwindigkeit: DataTypes.DECIMAL(5,2),
  stationName: { type: DataTypes.STRING, allowNull: true },
  stationType: { type: DataTypes.STRING, allowNull: true }

}, {
  indexes: [
    { unique: true, fields: ['name'], name: 'ux_machines_name' },,
    { fields: ['stationName'], name: 'ix_machines_station' }
  ],
  timestamps: false
})

export const Telemetry = sequelize.define('Telemetry', {
  temperatur: DataTypes.DECIMAL(5,2),
  aktuelleLeistung: DataTypes.DECIMAL(5,2),
  betriebsminutenGesamt: DataTypes.DECIMAL(12,1),
  geschwindigkeit: DataTypes.DECIMAL(5,2)
}, {
  indexes: [{ fields: ['MachineId'] }, { fields: ['createdAt'] }]
})

Machine.hasMany(Telemetry, { onDelete: 'CASCADE' })
Telemetry.belongsTo(Machine)

export async function initDb(seed) {
  const doAlter = process.env.DB_SYNC_ALTER === '1'
  await sequelize.sync({ alter: doAlter })

  const count = await Machine.count()
  if (count === 0 && seed) {
    for (const [name, m] of Object.entries(seed)) {
      const temperatur = Number(String(m.temperatur).replace('°','').replace(',','.')).toFixed(2)
      const durch = Number(String(m.durchgängigeLaufzeit).toLowerCase().replace('minuten','').trim().replace(',','.')).toFixed(3)
      const leistung = Number(String(m.Motor.aktuelleLeistung).replace('%','').replace(',','.')).toFixed(2)
      const betriebs = Number(String(m.Motor.betriebsminutenGesamt).toLowerCase().replace('minuten','').trim().replace(',','.')).toFixed(1)
      const geschwindigkeit = (1 + Math.random() * 3).toFixed(2)
      await Machine.create({
        name,
        identifikation: m.identifikation,
        letzteWartung: m.Motor.letzteWartung,
        durchgaengigeLaufzeit: durch,
        temperatur,
        aktuelleLeistung: leistung,
        betriebsminutenGesamt: betriebs,
        geschwindigkeit
      })
    }
  }
}
