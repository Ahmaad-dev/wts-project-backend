# WTS Project Backend
# GENERATED WITH AI

Ein Node.js-Backend für Maschinen-Monitoring mit Echtzeit-Telemetrie.

## 📋 Inhaltsverzeichnis
- [Architektur](#architektur)
- [Live-URLs](#live)
- [API-Endpunkte](#rest-endpunkte)
- [Echtzeit WebSockets](#echtzeit-websockets)
- [Installation & Setup](#installation--setup)
- [Environment-Variablen](#environment-variablen)
- [Deployment](#deployment)
- [Entwicklung](#entwicklung)
- [Troubleshooting](#troubleshooting)

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
  `ca-swe-wts-backend.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io`
- **API-Doku (Swagger UI):**  
  `ca-swe-wts-backend.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io/api/docs`
- **OpenAPI JSON (für Swagger Editor):**  
  `ca-swe-wts-backend.happymeadow-a2b0a3fc.swedencentral.azurecontainerapps.io/api/openapi.json`

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

## Installation & Setup

### Voraussetzungen
- Node.js ≥ 20.0.0
- Azure SQL Database
- (Optional) Docker für Container-Deployment

### Lokale Installation
```bash
# Repository klonen
git clone <repository-url>
cd wts-project-backend

# Dependencies installieren
npm install

# .env Datei erstellen
example:
 cp .env.example .env
    DB_HOST=your-sql-server.database.windows.net
    DB_NAME=your-database-name
    DB_USER=your-username
    DB_PASS=your-password

    # Optional
    ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-domain.com
    PORT=8080
    TELEMETRY_DB_SAVE_MS=5000
    DB_SYNC_ALTER=0
    SQL_LOG=0
    DEBUG=1

# Dann DB-Verbindungsdaten in .env eintragen

# Entwicklungsserver starten
npm run dev
```

### Docker Setup
```bash
# Image bauen
docker build -t wts-backend .

# Container starten
docker run -p 8080:8080 \
  -e DB_HOST=your-db-host \
  -e DB_NAME=your-db-name \
  -e DB_USER=your-db-user \
  -e DB_PASS=your-db-pass \
  wts-backend
```

## Deployment

### Azure Container Apps
Das Backend wird automatisch via GitHub Actions deployed:
1. Code-Push triggert CI/CD Pipeline
2. Docker Image wird in Azure Container Registry gepusht
3. Terraform updated die Container App mit neuem Image

### Manuelle Deployment-Befehle
```bash
# Aktuellen FQDN abrufen
az containerapp show -g <resource-group> -n <app-name> --query properties.latestRevisionFqdn -o tsv

# Logs anzeigen
az containerapp logs show -g <resource-group> -n <app-name> --follow
```

## Entwicklung

### Verfügbare Scripts
```bash
npm start          # Produktionsserver
npm run start:prod # Explizit production mode
npm run dev        # Entwicklung mit --watch
```

### API-Entwicklung
- OpenAPI Spec: `docs/openapi.json`
- Swagger UI lokal: `http://localhost:8080/api/docs`
- Seed-Daten: `seed/initial-data.json`

### Debugging
Setze `DEBUG=1` für zusätzliche Endpunkte:
- `/debug/env` - Environment-Variablen (maskiert)
- `/debug/db` - Datenbankverbindung testen

## Troubleshooting

### Häufige Probleme

**Datenbankverbindung fehlgeschlagen**
```bash
# Environment-Variablen prüfen
curl http://localhost:8080/debug/env

# DB-Verbindung testen
curl http://localhost:8080/debug/db
```

**CORS-Fehler**
- `ALLOWED_ORIGINS` korrekt setzen
- In Development Mode werden alle Origins erlaubt

**Container startet nicht**
```bash
# Logs prüfen
docker logs <container-id>

# Health-Check
curl http://localhost:8080/health
curl http://localhost:8080/readyz
```

### Performance-Monitoring
- Readiness-Check: `/readyz` prüft DB-Verbindung
- Telemetrie wird gepuffert (Standard: 5s via `TELEMETRY_DB_SAVE_MS`)

## Lokale Entwicklung
```bash
# .env mit DB_HOST/DB_NAME/DB_USER/DB_PASS/ALLOWED_ORIGINS anlegen
npm install
npm run dev
# oder direkt
npm start
```
