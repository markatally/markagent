#!/bin/bash

# Mark Agent - Stop All Services
# Usage: ./stop.sh [--all]
#   --all  Also stop Docker containers (PostgreSQL, Redis)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Change to project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

STOP_DOCKER=false

for arg in "$@"; do
  case $arg in
    --all)
      STOP_DOCKER=true
      shift
      ;;
  esac
done

echo -e "${YELLOW}Stopping Mark Agent services...${NC}"

# Stop frontend (port 3000)
if lsof -ti:3000 &>/dev/null; then
  echo -e "  Stopping frontend..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  echo -e "${GREEN}  ✓ Frontend stopped${NC}"
else
  echo -e "  Frontend not running"
fi

# Stop backend (port 4000)
if lsof -ti:4000 &>/dev/null; then
  echo -e "  Stopping backend..."
  lsof -ti:4000 | xargs kill -9 2>/dev/null || true
  echo -e "${GREEN}  ✓ Backend stopped${NC}"
else
  echo -e "  Backend not running"
fi

# Stop Docker containers if requested
if $STOP_DOCKER; then
  echo -e "  Stopping Docker containers..."
  docker-compose down 2>/dev/null || true
  echo -e "${GREEN}  ✓ Docker containers stopped${NC}"
fi

echo ""
echo -e "${GREEN}All services stopped${NC}"
