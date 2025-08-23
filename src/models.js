import { Sequelize, DataTypes } from 'sequelize'
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false })
export const Machine = sequelize.define('Machine', {
  name: { type: DataTypes.STRING, unique: true },
  identifikation: DataTypes.STRING,
  letzteWartung: DataTypes.STRING,
  durchgaengigeLaufzeit: DataTypes.FLOAT,
  temperatur: DataTypes.FLOAT,
  aktuelleLeistung: DataTypes.FLOAT,
  betriebsminutenGesamt: DataTypes.FLOAT,
  geschwindigkeit: DataTypes.FLOAT
})
export const Telemetry = sequelize.define('Telemetry', {
  temperatur: DataTypes.FLOAT,
  aktuelleLeistung: DataTypes.FLOAT,
  betriebsminutenGesamt: DataTypes.FLOAT,
  geschwindigkeit: DataTypes.FLOAT
})
Machine.hasMany(Telemetry, { onDelete: 'CASCADE' })
Telemetry.belongsTo(Machine)
export async function initDb(seed) {
  await sequelize.sync()
  const count = await Machine.count()
  if (count === 0 && seed) {
    for (const [name, m] of Object.entries(seed)) {
      const temperatur = parseFloat(String(m.temperatur).replace('°','').replace(',','.'))
      const durch = parseFloat(String(m.durchgängigeLaufzeit).toLowerCase().replace('minuten','').trim().replace(',','.'))
      const leistung = parseFloat(String(m.Motor.aktuelleLeistung).replace('%','').replace(',','.'))
      const betriebs = parseFloat(String(m.Motor.betriebsminutenGesamt).toLowerCase().replace('minuten','').trim().replace(',','.'))
      const geschwindigkeit = 1 + Math.random()*3
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
