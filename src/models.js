import { Sequelize, DataTypes } from 'sequelize';

const cfg = {
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: 1433,
  dialect: 'mssql',
  logging: false,
  dialectOptions: { options: { encrypt: true, trustServerCertificate: false } }
};
if (!cfg.host || !cfg.database || !cfg.username || !cfg.password) {
  throw new Error('DB env missing');
}
export const sequelize = new Sequelize(cfg);

export const Machine = sequelize.define('Machine', {
  name:                 { type: DataTypes.STRING, allowNull: false },
  identifikation:       DataTypes.STRING,
  letzteWartung:        DataTypes.STRING,
  durchgaengigeLaufzeit:DataTypes.DECIMAL(18,3),
  temperatur:           DataTypes.DECIMAL(10,3),
  aktuelleLeistung:     DataTypes.DECIMAL(10,3),
  betriebsminutenGesamt:DataTypes.DECIMAL(18,3),
  geschwindigkeit:      DataTypes.DECIMAL(10,3)
}, {
  indexes: [{ unique: true, fields: ['name'], name: 'ux_machines_name' }],
  timestamps: false
});

export const Telemetry = sequelize.define('Telemetry', {
  temperatur:           DataTypes.DECIMAL(10,3),
  aktuelleLeistung:     DataTypes.DECIMAL(10,3),
  betriebsminutenGesamt:DataTypes.DECIMAL(18,3),
  geschwindigkeit:      DataTypes.DECIMAL(10,3)
}, {
  indexes: [{ fields: ['MachineId'] }, { fields: ['createdAt'] }]
});

Machine.hasMany(Telemetry, { onDelete: 'CASCADE' });
Telemetry.belongsTo(Machine);

export async function initDb(seed) {
  await sequelize.sync(); // keine Schema-Änderungen mehr erzwingen
  const count = await Machine.count();
  if (count === 0 && seed) {
    for (const [name, m] of Object.entries(seed)) {
      const temperatur = parseFloat(String(m.temperatur).replace('°','').replace(',','.'));
      const durch = parseFloat(String(m.durchgängigeLaufzeit).toLowerCase().replace('minuten','').trim().replace(',','.'));
      const leistung = parseFloat(String(m.Motor.aktuelleLeistung).replace('%','').replace(',','.'));
      const betriebs = parseFloat(String(m.Motor.betriebsminutenGesamt).toLowerCase().replace('minuten','').trim().replace(',','.'));
      const geschwindigkeit = 1 + Math.random()*3;
      await Machine.create({
        name,
        identifikation: m.identifikation,
        letzteWartung: m.Motor.letzteWartung,
        durchgaengigeLaufzeit: durch,
        temperatur,
        aktuelleLeistung: leistung,
        betriebsminutenGesamt: betriebs,
        geschwindigkeit
      });
    }
  }
}
