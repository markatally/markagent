#!/bin/bash

# Mark Agent - One-click Service Startup
# Usage: ./start.sh [options]
#   --build-sandbox   Build the Docker sandbox image
#   --install-browser Install Playwright Chromium (for Computer/browser mode)
#   --reset-db        Reset and re-migrate the database
#   --help            Show this help message

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Change to project root
cd "$PROJECT_ROOT" || exit 1

# Parse arguments
BUILD_SANDBOX=false
INSTALL_BROWSER=false
RESET_DB=false

for arg in "$@"; do
  case $arg in
    --build-sandbox)
      BUILD_SANDBOX=true
      shift
      ;;
    --install-browser)
      INSTALL_BROWSER=true
      shift
      ;;
    --reset-db)
      RESET_DB=true
      shift
      ;;
    --help)
      echo "Mark Agent - One-click Service Startup"
      echo ""
      echo "Usage: ./start.sh [options]"
      echo ""
      echo "Options:"
      echo "  --build-sandbox   Build the Docker sandbox image"
      echo "  --install-browser Install Playwright Chromium (for Computer/browser mode)"
      echo "  --reset-db        Reset and re-migrate the database"
      echo "  --help            Show this help message"
      echo ""
      echo "Services started:"
      echo "  - PostgreSQL (localhost:5432)"
      echo "  - Redis (localhost:6379)"
      echo "  - Backend API (localhost:4000)"
      echo "  - Frontend (localhost:3000)"
      echo ""
      echo "Auto-installed if missing:"
      echo "  - yt-dlp (video download/probe/transcript)"
      echo "  - ffmpeg (video stream merging)"
      echo "  - openai-whisper (speech-to-text fallback for videos without subtitles)"
      echo ""
      echo "Optional: Enable browser.enabled in config/default.json and use"
      echo "  --install-browser to install Chromium for real-browser Computer mode."
      exit 0
      ;;
  esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Mark Agent - Starting Services${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
  echo -e "${RED}Error: bun is not installed. Please install bun first.${NC}"
  echo "  curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# Check if docker is available
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: docker is not installed or not in PATH.${NC}"
  exit 1
fi

# Check and install yt-dlp (required for video download/probe/transcript tools)
if ! command -v yt-dlp &> /dev/null; then
  echo -e "${YELLOW}  yt-dlp not found. Installing...${NC}"
  if [[ "$OSTYPE" == "darwin"* ]] && command -v brew &> /dev/null; then
    brew install yt-dlp || pip3 install --user yt-dlp || true
  else
    pip3 install --user yt-dlp || python3 -m pip install --user yt-dlp || true
  fi
  if command -v yt-dlp &> /dev/null; then
    echo -e "${GREEN}  ✓ yt-dlp installed ($(yt-dlp --version))${NC}"
  else
    echo -e "${YELLOW}  ⚠ yt-dlp installation failed. Video tools will attempt auto-recovery at runtime.${NC}"
  fi
else
  echo -e "${GREEN}  ✓ yt-dlp available ($(yt-dlp --version))${NC}"
fi

# Check ffmpeg (required by yt-dlp for merging video+audio streams)
if ! command -v ffmpeg &> /dev/null; then
  echo -e "${YELLOW}  ffmpeg not found. Installing...${NC}"
  if [[ "$OSTYPE" == "darwin"* ]] && command -v brew &> /dev/null; then
    brew install ffmpeg || true
  else
    sudo apt-get install -y ffmpeg 2>/dev/null || true
  fi
  if command -v ffmpeg &> /dev/null; then
    echo -e "${GREEN}  ✓ ffmpeg installed${NC}"
  else
    echo -e "${YELLOW}  ⚠ ffmpeg not installed. Video merging may fail.${NC}"
  fi
else
  echo -e "${GREEN}  ✓ ffmpeg available${NC}"
fi

# Check and install openai-whisper (fallback for video transcription when no subtitles)
if ! command -v whisper &> /dev/null; then
  echo -e "${YELLOW}  whisper not found. Installing openai-whisper...${NC}"
  pip3 install openai-whisper 2>/dev/null || python3 -m pip install openai-whisper 2>/dev/null || true
  if command -v whisper &> /dev/null; then
    echo -e "${GREEN}  ✓ openai-whisper installed${NC}"
  else
    echo -e "${YELLOW}  ⚠ openai-whisper installation failed. Whisper transcription fallback will be unavailable.${NC}"
  fi
else
  echo -e "${GREEN}  ✓ whisper available${NC}"
fi

echo -e "${GREEN}  ✓ Prerequisites OK${NC}"

# Step 2: Start Docker (Colima on macOS)
echo -e "${YELLOW}[2/7] Checking Docker...${NC}"

# Check if Docker daemon is already running
if docker info &> /dev/null; then
  echo -e "${GREEN}  ✓ Docker already running (skipping Colima start)${NC}"
else
  echo -e "${YELLOW}  Docker not running. Auto-starting...${NC}"

  # Try Colima first (macOS)
  if command -v colima &> /dev/null; then
    echo -e "${YELLOW}  Starting Colima...${NC}"
    colima start || true
    # Wait for Docker to become ready (poll up to 60s)
    for i in $(seq 1 30); do
      sleep 2
      if docker info &> /dev/null; then
        break
      fi
      if [[ $i -eq 30 ]]; then
        echo -e "${RED}Error: Colima did not start in time. Please start it manually: colima start${NC}"
        exit 1
      fi
    done
  # Try Docker Desktop
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${YELLOW}  Starting Docker Desktop...${NC}"
    open -a Docker 2>/dev/null || true
    for i in $(seq 1 30); do
      sleep 2
      if docker info &> /dev/null; then
        break
      fi
      if [[ $i -eq 30 ]]; then
        echo -e "${RED}Error: Docker did not start in time. Please start Docker Desktop manually.${NC}"
        exit 1
      fi
    done
  else
    echo -e "${RED}Error: Docker is not running and no Colima/Docker Desktop found. Please start Docker manually.${NC}"
    exit 1
  fi

  echo -e "${GREEN}  ✓ Docker is running${NC}"
fi

# Step 3: Start PostgreSQL and Redis
echo -e "${YELLOW}[3/7] Starting database services...${NC}"

docker-compose up -d db redis

# Wait for services to be healthy
echo -e "${YELLOW}  Waiting for services to be ready...${NC}"
sleep 5

# Check if services are healthy
DB_HEALTHY=false
REDIS_HEALTHY=false

for i in {1..30}; do
  if docker-compose ps db 2>/dev/null | grep -q "healthy"; then
    DB_HEALTHY=true
  fi
  if docker-compose ps redis 2>/dev/null | grep -q "healthy"; then
    REDIS_HEALTHY=true
  fi

  if $DB_HEALTHY && $REDIS_HEALTHY; then
    break
  fi

  sleep 1
done

if ! $DB_HEALTHY; then
  echo -e "${YELLOW}  Warning: PostgreSQL health check not confirmed, continuing anyway...${NC}"
fi

echo -e "${GREEN}  ✓ PostgreSQL running on localhost:5432${NC}"
echo -e "${GREEN}  ✓ Redis running on localhost:6379${NC}"

# Step 4: Check/create .env file
echo -e "${YELLOW}[4/7] Checking environment configuration...${NC}"

if [ ! -f .env ]; then
  echo -e "${YELLOW}  Creating .env file...${NC}"
  cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://mark:mark_dev_password@localhost:5432/mark_agent

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secret (auto-generated)
JWT_SECRET=$(openssl rand -hex 32)

# Encryption Key (auto-generated)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# LLM API Key (REQUIRED - add your key here)
LLM_API_KEY=your_api_key_here

# Optional overrides
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4
EOF

  # Generate actual secrets
  JWT_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  sed -i.bak "s/\$(openssl rand -hex 32)/$JWT_SECRET/" .env 2>/dev/null || \
    sed -i '' "s/\$(openssl rand -hex 32)/$JWT_SECRET/" .env
  sed -i.bak "s/\$(openssl rand -hex 32)/$ENCRYPTION_KEY/" .env 2>/dev/null || \
    sed -i '' "s/\$(openssl rand -hex 32)/$ENCRYPTION_KEY/" .env
  rm -f .env.bak

  echo -e "${YELLOW}  ⚠ Created .env file. Please add your LLM_API_KEY!${NC}"
else
  echo -e "${GREEN}  ✓ .env file exists${NC}"
fi

# Ensure API symlink exists
if [ ! -f apps/api/.env ]; then
  ln -sf ../../.env apps/api/.env
  echo -e "${GREEN}  ✓ Created API .env symlink${NC}"
fi

# Step 5: Install dependencies and run migrations
echo -e "${YELLOW}[5/7] Installing dependencies...${NC}"

bun install --silent

if $RESET_DB; then
  echo -e "${YELLOW}  Resetting database...${NC}"
  cd apps/api
  bunx prisma migrate reset --force
  cd "$PROJECT_ROOT"
else
  echo -e "${YELLOW}  Running database migrations...${NC}"
  cd apps/api
  bunx prisma migrate deploy 2>/dev/null || bunx prisma migrate dev --name init
  bunx prisma generate
  cd "$PROJECT_ROOT"
fi

echo -e "${GREEN}  ✓ Dependencies installed and database migrated${NC}"

# Step 6: Build sandbox image (optional)
if $BUILD_SANDBOX; then
  echo -e "${YELLOW}[6/7] Building sandbox Docker image...${NC}"
  docker build -t mark-sandbox:latest docker/sandbox/
  echo -e "${GREEN}  ✓ Sandbox image built${NC}"
else
  echo -e "${YELLOW}[6/7] Skipping sandbox build (use --build-sandbox to build)${NC}"
fi

# Step 6b: Install Playwright Chromium (optional, for Computer/browser mode)
if $INSTALL_BROWSER; then
  echo -e "${YELLOW}[6b] Installing Playwright Chromium for browser mode...${NC}"
  cd apps/api
  if ! bunx playwright install chromium; then
    cd "$PROJECT_ROOT"
    echo -e "${YELLOW}  Playwright Chromium install failed. Run manually: cd apps/api && bunx playwright install chromium${NC}"
    exit 1
  fi
  cd "$PROJECT_ROOT"
  echo -e "${GREEN}  ✓ Playwright Chromium installed${NC}"
fi

# Step 7: Start application services
echo -e "${YELLOW}[7/7] Starting application services...${NC}"

# Kill any existing processes on our ports
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start backend in background
echo -e "${YELLOW}  Starting backend API...${NC}"
cd apps/api
CONFIG_PATH="$PROJECT_ROOT/config/default.json" bun run dev &
BACKEND_PID=$!
cd "$PROJECT_ROOT"

# Wait for backend to start
sleep 3

# Start frontend in background
echo -e "${YELLOW}  Starting frontend...${NC}"
cd apps/web
bun run dev &
FRONTEND_PID=$!
cd "$PROJECT_ROOT"

# Wait for frontend to start
sleep 3

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Mark Agent Started Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}    http://localhost:3000"
echo -e "  ${BLUE}Backend API:${NC} http://localhost:4000"
echo -e "  ${BLUE}Health Check:${NC} http://localhost:4000/api/health"
echo ""
echo -e "  ${BLUE}PostgreSQL:${NC}  localhost:5432"
echo -e "  ${BLUE}Redis:${NC}       localhost:6379"
echo ""

# Check if LLM_API_KEY is set
if grep -q "LLM_API_KEY=your_api_key_here" .env 2>/dev/null; then
  echo -e "  ${YELLOW}⚠ Warning: LLM_API_KEY not configured in .env${NC}"
  echo -e "  ${YELLOW}  Add your API key to enable LLM features${NC}"
  echo ""
fi

echo -e "  ${BLUE}Press Ctrl+C to stop all services${NC}"
echo ""

# Trap Ctrl+C to cleanup
cleanup() {
  echo ""
  echo -e "${YELLOW}Stopping services...${NC}"
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  echo -e "${GREEN}Services stopped${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait $BACKEND_PID $FRONTEND_PID
