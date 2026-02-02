#!/bin/bash

# Mark Agent - Restart All Services
# Usage: ./restart.sh [options]
#   --all           Also restart Docker containers (PostgreSQL, Redis)
#   --build-sandbox  Rebuild Docker sandbox image
#   --reset-db       Reset and re-migrate database
#   --help           Show this help message

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Change to project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

# Parse arguments
RESTART_DOCKER=false
BUILD_SANDBOX=false
RESET_DB=false
STOP_ARGS=()
START_ARGS=()

for arg in "$@"; do
  case $arg in
    --all)
      RESTART_DOCKER=true
      STOP_ARGS+=("--all")
      ;;
    --build-sandbox)
      BUILD_SANDBOX=true
      START_ARGS+=("--build-sandbox")
      ;;
    --reset-db)
      RESET_DB=true
      START_ARGS+=("--reset-db")
      ;;
    --help)
      echo "Mark Agent - Restart All Services"
      echo ""
      echo "Usage: ./restart.sh [options]"
      echo ""
      echo "Options:"
      echo "  --all           Also restart Docker containers (PostgreSQL, Redis)"
      echo "  --build-sandbox  Rebuild Docker sandbox image"
      echo "  --reset-db       Reset and re-migrate database"
      echo "  --help           Show this help message"
      echo ""
      echo "This script first runs stop.sh, then start.sh."
      echo "Any options passed to restart.sh are forwarded to both scripts."
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      echo "Use --help for usage information."
      exit 1
      ;;
  esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Mark Agent - Restarting${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Stop all services
echo -e "${YELLOW}[1/2] Stopping services...${NC}"
echo ""

# Execute stop.sh
if [ -f "$SCRIPT_DIR/stop.sh" ]; then
  chmod +x "$SCRIPT_DIR/stop.sh"
  "$SCRIPT_DIR/stop.sh" "${STOP_ARGS[@]}"
else
  echo -e "${RED}Error: stop.sh not found${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✓ All services stopped${NC}"
echo ""

# Small delay to ensure ports are released
sleep 2

# Step 2: Start all services
echo -e "${YELLOW}[2/2] Starting services...${NC}"
echo ""

# Execute start.sh
if [ -f "$SCRIPT_DIR/start.sh" ]; then
  chmod +x "$SCRIPT_DIR/start.sh"
  "$SCRIPT_DIR/start.sh" "${START_ARGS[@]}"
else
  echo -e "${RED}Error: start.sh not found${NC}"
  exit 1
fi
