# WTS Project Backend
# MADE WITH AI

Ein Node.js-Backend für Maschinen-Monitoring mit Echtzeit-Telemetrie.

## Architektur

- **Runtime:** Node.js 20, Express  
- **DB:** Azure SQL (MSSQL) via Sequelize (`tedious`)  
- **Realtime:** Socket.io (WebSocket)  
- **Hosting:** Azure Container Apps (ACA)  
- **Images:** Azure Container Registry (ACR)  
- **CI/CD:** GitHub Actions (Build & Push ins ACR)  

## REST-Endpunkte

- `GET /health` – Liveness-Check  
- `GET /readyz` – DB-Readiness (führt `sequelize.authenticate()` aus)  
- `GET /api/machines/basic` – kompakte Maschinenliste  
- `GET /api/machines/:name` – Detaildaten einer Maschine  
- `GET /api/machines/:name/telemetry?since&limit` – Telemetrie-Historie  
- `POST /api/machines/:name/telemetry` – Telemetrie einfügen  

## Debug-Endpunkte (nur bei `DEBUG=1`)

- `GET /debug/env` – zeigt maskierte Environment-Variablen  
- `GET /debug/db` – prüft DB-Verbindung  

## Echtzeit (WebSockets)

- Events auf `telemetry` je Maschine  
- Rooms: `room:machine:<name>`  

## Environment-Variablen

**Pflicht:**  
- `DB_HOST` – z. B. `my-sqlserver.database.windows.net`  
- `DB_NAME` – Datenbankname  
- `DB_USER` – SQL-User  
- `DB_PASS` – Passwort  

**Optional:**  
- `ALLOWED_ORIGINS` – CORS (kommagetrennt)  
- `PORT` – Default `8080`  
- `TELEMETRY_DB_SAVE_MS` – Flush-Intervall in ms (Default `5000`)  
- `DB_SYNC_ALTER` – `1` = Schema-Anpassungen beim Start (nicht in Prod empfohlen)  
- `SQL_LOG` – `1` = SQL-Queries loggen  
- `DEBUG` – `1` = Debug-Endpunkte aktivieren  

## Seed-Daten

- `initial-data.json` wird beim Start eingelesen  
- Befüllung nur, wenn Tabellen leer sind  
- Pfad per `SEED_PATH` änderbar  

## Lokale Entwicklung

```bash
# .env mit DB_HOST/DB_NAME/DB_USER/DB_PASS/ALLOWED_ORIGINS anlegen
npm install
npm run dev     # Development-Modus mit Hot-Reload
# oder
npm start       # Production-Modus

