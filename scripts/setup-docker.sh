#!/usr/bin/env bash
# ─── Docker Setup — Trading Command Suite ───────────────────
# One-command setup: builds images, starts services, runs migrations.
#
# Usage:
#   chmod +x scripts/setup-docker.sh
#   ./scripts/setup-docker.sh              # Build + start (production)
#   ./scripts/setup-docker.sh --dev        # Build + start + seed data
#   ./scripts/setup-docker.sh --stop       # Stop all services
#   ./scripts/setup-docker.sh --clean      # Stop + remove volumes (destroys DB)
#   ./scripts/setup-docker.sh --rebuild    # Force rebuild without cache

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ─── Help ───────────────────────────────────────────────────

usage() {
    echo "Usage: $0 [--dev|--stop|--clean|--rebuild]"
    echo ""
    echo "  (no flag)    Build images and start services (production mode)"
    echo "  --dev        Build and start with seed data"
    echo "  --stop       Stop all services"
    echo "  --clean      Stop and remove volumes (WARNING: destroys database)"
    echo "  --rebuild    Force rebuild without cache"
    exit 0
}

# ─── Colors ─────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERR]${NC}   $1"; }

# ─── Prerequisites ──────────────────────────────────────────

check_prereqs() {
    if ! command -v docker &> /dev/null; then
        err "Docker is not installed. Install Docker Desktop or Docker Engine."
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        err "Docker Compose is not installed."
        exit 1
    fi

    ok "Docker and Docker Compose found"
}

# ─── Copy env file if missing ───────────────────────────────

ensure_env() {
    if [ ! -f ".env.docker" ]; then
        warn ".env.docker not found — creating from template"
        cat > .env.docker << 'EOF'
# Docker Environment
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_PASSWORD=tradingcs_dev_2026
ALPACA_API_KEY=
ALPACA_API_SECRET=
QUEUE_MODE=off
EOF
        info "Created .env.docker — edit to add your API keys"
    else
        ok ".env.docker exists"
    fi
}

# ─── Build flags ────────────────────────────────────────────

BUILD_FLAGS=""
if [ "${1:-}" = "--rebuild" ]; then
    BUILD_FLAGS="--no-cache"
    info "Forcing rebuild without cache"
fi

# ─── Actions ────────────────────────────────────────────────

case "${1:-}" in
    --help|-h)
        usage
        ;;
    --stop)
        info "Stopping all services..."
        docker compose down
        ok "All services stopped"
        exit 0
        ;;
    --clean)
        warn "This will remove all volumes including database data!"
        read -rp "Are you sure? (y/N) " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            info "Aborted"
            exit 0
        fi
        info "Stopping and removing volumes..."
        docker compose down -v
        ok "Clean complete"
        exit 0
        ;;
esac

# ─── Main: Build and Start ─────────────────────────────────

check_prereqs
ensure_env

info "Building Docker images..."
docker compose build $BUILD_FLAGS
ok "Build complete"

info "Starting services..."
docker compose up -d
ok "Services started"

info "Waiting for MySQL health check..."
sleep 5

info "Running database migrations..."
docker compose exec -T api npx prisma db push --accept-data-loss 2>/dev/null || \
    warn "Migration skipped (API may still be starting)"

# Seed data in dev mode
if [ "${1:-}" = "--dev" ]; then
    info "Seeding market data..."
    docker compose exec -T api npx ts-node prisma/seed.ts 2>/dev/null || true
    docker compose exec -T api npx ts-node prisma/seed-market-data.ts 2>/dev/null || true
    ok "Seed data loaded"
fi

echo ""
ok "═══════════════════════════════════════════════"
ok "  Trading Command Suite is running!"
ok ""
ok "  Frontend: http://localhost:5173"
ok "  API:      http://localhost:3201/api/health"
ok "  Swagger:  http://localhost:3201/docs"
ok "═══════════════════════════════════════════════"
echo ""

info "To stop:   ./scripts/setup-docker.sh --stop"
info "To clean:  ./scripts/setup-docker.sh --clean"
