# WTS Project Backend
# MADE WITH AI

Ein Node.js-Backend für Maschinen-Monitoring mit Echtzeit-Telemetrie.

## Architektur
- **Runtime:** Node.js 20, Express  
- **DB:** Azure SQL (MSSQL) via Sequelize (`tedious`)  
- **Realtime:** Socket.IO (WebSocket)  
- **Hosting:** Azure Container Apps (ACA)  
- **Images:** Azure Container Registry (ACR)  
- **CI/CD:** GitHub Actions (Build & Push ins ACR, Tag-Rollout via Terraform)

## Live
- **Frontend:** https://saswewtsz1.z1.web.core.windows.net/  
- **Backend (FQDN – aktuelle Revision):**  
  `https://ca-swe-wts-backend--0000005.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io`
- **API-Doku (Swagger UI):**  
  `https://ca-swe-wts-backend--0000005.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io/api/docs`
- **OpenAPI JSON (für Swagger Editor):**  
  `https://ca-swe-wts-backend--0000005.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io/api/openapi.json`

> Hinweis: Der FQDN ändert sich bei neuen Revisionen. Mit `az containerapp show -g <rg> -n <app> --query properties.latestRevisionFqdn -o tsv` holst du den aktuellen.

## REST-Endpunkte
- `GET /health` – Liveness  
- `GET /readyz` – Readiness ( prüft DB via `sequelize.authenticate()` )  
- `GET /api/machines/basic` – kompakte Maschinenliste  
- `GET /api/machines/:name` – Details einer Maschine  
- `GET /api/machines/:name/telemetry?since&limit` – Telemetrie-Historie  
- `POST /api/machines/:name/telemetry` – Telemetrie einfügen  

## Debug-Endpunkte (nur bei `DEBUG=1`)
- `GET /debug/env` – maskierte Environment-Variablen  
- `GET /debug/db` – DB-Check

## Echtzeit (WebSockets)
- Event: `telemetry` je Maschine  
- Rooms: `room:machine:<name>`

## Environment-Variablen
**Pflicht**
- `DB_HOST`  (z. B. `my-sqlserver.database.windows.net`)  
- `DB_NAME`  
- `DB_USER`  
- `DB_PASS`

**Optional**
- `ALLOWED_ORIGINS` – kommagetrennte Liste für CORS (z. B. `https://saswewtsz1.z1.web.core.windows.net,https://editor.swagger.io`)  
- `PORT` – Default `8080`  
- `TELEMETRY_DB_SAVE_MS` – Flush-Intervall in ms (Default `5000`)  
- `DB_SYNC_ALTER` – `1` = Schema-Anpassungen beim Start (nicht in Prod empfohlen)  
- `SQL_LOG` – `1` = SQL-Queries loggen  
- `DEBUG` – `1` = Debug-Endpunkte aktivieren  
- `OPENAPI_PATH` – alternativer Pfad zur `openapi.json`  
- `SEED_PATH` – alternativer Pfad zu `initial-data.json`

## Seed-Daten
- `initial-data.json` wird beim Start geladen  
- Befüllung nur, wenn Tabellen leer sind  
- Pfad via `SEED_PATH` überschreibbar

## Lokale Entwicklung
```bash
# .env mit DB_HOST/DB_NAME/DB_USER/DB_PASS/ALLOWED_ORIGINS anlegen
npm install
npm run dev
# oder
npm start
