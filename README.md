# Machines API Backend
GENERATED WITH AI 


A Node.js backend service for monitoring industrial machines with real-time telemetry data.

## Features

- 🏭 Machine management with telemetry data
- ⚡ Real-time updates via WebSocket (Socket.io)
- 📊 SQLite database with Sequelize ORM
- 🐳 Containerized with Docker
- 🔒 Input validation and error handling
- 📈 Health check endpoint
- 🚀 CI/CD with GitHub Actions

## API Endpoints

### GET /health
Health check endpoint for monitoring

### GET /api/machines/basic
Get list of all machines with basic information

### GET /api/machines/:name
Get detailed information for a specific machine

### POST /api/machines/:name/telemetry
Update telemetry data for a machine

**Request Body:**
```json
{
  "temperatur": 42.5,
  "aktuelleLeistung": 75.0,
  "betriebsminutenGesamt": 12345.0,
  "geschwindigkeit": 3.2
}
```

## Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn

### Installation

1. Clone the repository
2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:8080`

### Docker

Build and run with Docker:
```bash
docker build -t machines-api .
docker run -p 8080:8080 machines-api
```

## Environment Variables

- `PORT`: Server port (default: 8080)
- `DATABASE_URL`: SQLite database path (default: sqlite:./machines.sqlite)
- `NODE_ENV`: Environment mode (development/production)

## Development

- `npm run dev`: Start development server with file watching
- `npm start`: Start production server

## Database

The application uses SQLite with Sequelize ORM. The database is automatically initialized with sample data from `initial-data.json` on first run.

## Real-time Updates

The application emits real-time telemetry updates via Socket.io on the `telemetry` event.

## Security Features

- Non-root Docker user
- Input validation for all API endpoints
- Error handling middleware
- Request logging

## Deployment

### Azure Arc Deployment

This application is optimized for deployment on Azure Arc-enabled Kubernetes clusters.

#### Prerequisites
- Azure Arc-enabled Kubernetes cluster
- Azure Container Registry (ACR) access
- kubectl configured for your cluster

#### Deploy to Azure Arc

1. Apply the Kubernetes manifest:
   ```bash
   kubectl apply -f k8s-deployment.yaml
   ```

2. Verify deployment:
   ```bash
   kubectl get pods -l app=machines-backend
   kubectl get service machines-backend-service
   ```

3. Check health:
   ```bash
   kubectl port-forward service/machines-backend-service 8080:80
   curl http://localhost:8080/health
   ```

#### Azure Arc Features
- ✅ Non-root container execution
- ✅ Read-only root filesystem compatible
- ✅ Resource limits and requests defined
- ✅ Health checks configured
- ✅ Security context optimized
- ✅ Persistent volume for SQLite database

### GitHub Actions CI/CD

The project includes GitHub Actions for automated deployment to Azure Container Registry with Azure Arc compatible labels.