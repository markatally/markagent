#!/bin/bash

# Mark Agent - Local Environment Initialization Script
# This script sets up PostgreSQL, Redis, and other dependencies for local development

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/tmp/mark-workspaces}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

print_section() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Install Colima + Docker CE via Homebrew (macOS only)
install_colima_if_needed() {
    if [ "$(uname -s)" != "Darwin" ]; then
        print_error "Colima is for macOS only. Please install Docker for your platform."
        return 1
    fi
    if ! command_exists brew; then
        print_error "Homebrew is required but not installed."
        print_info "Install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        return 1
    fi
    print_section "Installing Docker CE (Colima) on macOS"
    if command_exists colima; then
        print_success "Colima is already installed"
    else
        print_info "Installing Colima, Docker, and Docker Compose..."
        brew install colima docker docker-compose
        print_success "Colima installed"
    fi
    return 0
}

# Detect Docker environment
detect_docker() {
    if command_exists docker; then
        print_success "Docker found: $(docker --version)"
        if command_exists colima; then
            print_info "Colima detected"
            DOCKER_CMD="colima"
            DOCKER_SOCKET="$HOME/.colima/default/docker.sock"
        else
            print_info "Docker Desktop detected"
            DOCKER_CMD="docker"
            DOCKER_SOCKET="/var/run/docker.sock"
        fi
        return 0
    else
        print_error "Docker not found."
        if [ "$(uname -s)" = "Darwin" ]; then
            print_info "Run this script again after installing Colima, or we can install it now."
            read -p "Install Colima via Homebrew now? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                if install_colima_if_needed; then
                    print_info "Retrying Docker detection..."
                    if command_exists docker; then
                        print_success "Docker found: $(docker --version)"
                        DOCKER_CMD="colima"
                        DOCKER_SOCKET="$HOME/.colima/default/docker.sock"
                        return 0
                    fi
                fi
            fi
        else
            print_info "Install Docker for your platform: https://docs.docker.com/get-docker/"
        fi
        return 1
    fi
}

# Start Docker if needed
start_docker() {
    if [ "$DOCKER_CMD" = "colima" ]; then
        if ! colima status &> /dev/null; then
            # Release any stuck disk (fixes: "attach disk colima, in use by instance colima")
            print_info "Releasing Colima disk (stop any stale instance)..."
            colima stop --force 2>/dev/null || true
            sleep 2
            print_info "Starting Colima (this may take a minute)..."
            if ! colima start --cpu 2 --memory 4 --disk 60; then
                print_error "Colima failed to start."
                print_info "Try a full reset: colima stop --force && colima delete --force && colima start --cpu 2 --memory 4 --disk 60"
                return 1
            fi
            print_success "Colima started"
        else
            print_success "Colima is already running"
        fi
    else
        if ! docker info &> /dev/null; then
            print_error "Docker is not running. Please start Docker Desktop."
            return 1
        else
            print_success "Docker is already running"
        fi
    fi
}

# Verify Docker and Docker Compose work
verify_docker() {
    print_section "Verifying Docker"
    if ! docker version --format 'Docker: {{.Server.Version}}' &>/dev/null; then
        print_error "Docker not responding"
        return 1
    fi
    print_success "Docker is working"
    if ! docker-compose version --short &>/dev/null; then
        print_error "Docker Compose not responding"
        return 1
    fi
    print_success "Docker Compose is working"
}

# Pull required infrastructure images
pull_infrastructure_images() {
    print_section "Pulling Docker Images"
    print_info "Pulling postgres:16-alpine..."
    docker pull postgres:16-alpine
    print_success "PostgreSQL image pulled"
    print_info "Pulling redis:7-alpine..."
    docker pull redis:7-alpine
    print_success "Redis image pulled"
}

# Start infrastructure containers
start_infrastructure() {
    print_section "Starting Infrastructure (PostgreSQL + Redis)"

    cd "$PROJECT_ROOT"

    # Start db and redis only
    docker-compose up -d db redis

    # Wait for PostgreSQL to be healthy
    print_info "Waiting for PostgreSQL to be ready..."
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker-compose exec -T db pg_isready -U mark &> /dev/null; then
            print_success "PostgreSQL is ready"
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    if [ $attempt -eq $max_attempts ]; then
        print_error "PostgreSQL failed to start"
        return 1
    fi

    # Wait for Redis to be ready
    print_info "Waiting for Redis to be ready..."
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker-compose exec -T redis redis-cli ping &> /dev/null; then
            print_success "Redis is ready"
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    if [ $attempt -eq $max_attempts ]; then
        print_error "Redis failed to start"
        return 1
    fi
}

# Create workspace directory
create_workspaces() {
    print_section "Creating Workspace Directory"

    if [ ! -d "$WORKSPACE_ROOT" ]; then
        mkdir -p "$WORKSPACE_ROOT"
        print_success "Created workspace directory: $WORKSPACE_ROOT"
    else
        print_success "Workspace directory already exists: $WORKSPACE_ROOT"
    fi
}

# Setup environment
setup_environment() {
    print_section "Environment Setup"

    cd "$PROJECT_ROOT"

    # Create .env if it doesn't exist
    if [ ! -f ".env" ]; then
        print_info "Creating .env file..."
        cat > .env << EOF
# PostgreSQL
DATABASE_URL=postgresql://mark:mark_password@localhost:5432/mark

# Redis
REDIS_URL=redis://localhost:6379

# LLM Configuration
LLM_API_KEY=
LLM_BASE_URL=https://api.jiekou.ai/openai
LLM_MODEL=zai-org/glm-4.7

# Security
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# CORS
ALLOWED_ORIGINS=http://localhost:3000

# Workspace
WORKSPACE_ROOT=$WORKSPACE_ROOT
EOF
        print_success "Created .env file with generated secrets"
        print_info "Please update LLM_API_KEY in .env"
    else
        print_success ".env file already exists"
    fi

    # Create symlink for API env if needed
    if [ ! -f "apps/api/.env" ]; then
        ln -s "../../.env" "apps/api/.env"
        print_success "Created symlink for apps/api/.env"
    else
        print_success "apps/api/.env already exists"
    fi
}

# Install dependencies
install_dependencies() {
    print_section "Installing Dependencies"

    cd "$PROJECT_ROOT"

    if ! bun install &> /dev/null; then
        print_error "Failed to install dependencies"
        return 1
    fi
    print_success "Dependencies installed"
}

# Run database migrations (deploy = non-interactive, applies pending migrations only)
run_migrations() {
    print_section "Running Database Migrations"

    cd "$PROJECT_ROOT"

    if ! bun run db:deploy &> /dev/null; then
        print_error "Failed to run migrations"
        return 1
    fi
    print_success "Database migrations completed"
}

# Generate Prisma client (must run from project root so root's db:generate script is used)
generate_prisma_client() {
    print_section "Generating Prisma Client"

    cd "$PROJECT_ROOT"

    if ! bun run db:generate &> /dev/null; then
        print_error "Failed to generate Prisma client"
        return 1
    fi
    print_success "Prisma client generated"
}

# Build sandbox Docker image
build_sandbox_image() {
    print_section "Building Sandbox Docker Image"

    cd "$PROJECT_ROOT"

    if docker images | grep -q "mark-sandbox"; then
        print_info "mark-sandbox image already exists"
        read -p "Rebuild sandbox image? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi

    if ! docker build -t mark-sandbox:latest -f docker/sandbox/Dockerfile . &> /dev/null; then
        print_error "Failed to build sandbox image"
        return 1
    fi
    print_success "Sandbox image built: mark-sandbox:latest"
}

# Run tests
run_tests() {
    print_section "Running Tests"

    cd "$PROJECT_ROOT"

    if ! bun run test &> /dev/null; then
        print_error "Tests failed"
        return 1
    fi
    print_success "All tests passed"
}

# Print summary
print_summary() {
    print_section "Setup Complete!"

    echo -e "${GREEN}Infrastructure:${NC}"
    echo -e "  • PostgreSQL: ${BLUE}localhost:5432${NC}"
    echo -e "  • Redis: ${BLUE}localhost:6379${NC}"
    echo -e "  • Workspace: ${BLUE}$WORKSPACE_ROOT${NC}"

    echo -e "\n${GREEN}Next Steps:${NC}"
    echo -e "  1. Update ${YELLOW}LLM_API_KEY${NC} in ${YELLOW}.env${NC}"
    echo -e "  2. Start backend: ${BLUE}bun run dev:api${NC}"
    echo -e "  3. Start frontend: ${BLUE}bun run dev:web${NC}"
    echo -e "  4. Open: ${BLUE}http://localhost:3000${NC}"

    echo -e "\n${GREEN}Commands:${NC}"
    echo -e "  • Stop services: ${BLUE}docker-compose down${NC}"
    echo -e "  • View logs: ${BLUE}docker-compose logs -f${NC}"
    echo -e "  • Run tests: ${BLUE}bun run test${NC}"
    echo -e "  • Prisma Studio: ${BLUE}bun run db:studio${NC}"
    if [ "$DOCKER_CMD" = "colima" ]; then
        echo -e "\n${GREEN}Colima:${NC}"
        echo -e "  • Start: ${BLUE}colima start${NC}"
        echo -e "  • Stop: ${BLUE}colima stop${NC}"
        echo -e "  • Status: ${BLUE}colima status${NC}"
        echo -e "  • Reset: ${BLUE}colima delete --force && colima start${NC}"
    fi

    echo -e "\n${GREEN}Environment Variables:${NC}"
    echo -e "  ${YELLOW}WORKSPACE_ROOT${NC}=$WORKSPACE_ROOT"
    echo -e "  ${YELLOW}DOCKER_SOCKET${NC}=$DOCKER_SOCKET"
}

# Main execution
main() {
    print_section "Mark Agent - Local Environment Setup"

    # Step 1: Detect and start Docker (install Colima on macOS if needed)
    if ! detect_docker; then
        exit 1
    fi
    start_docker
    verify_docker
    pull_infrastructure_images

    # Step 2: Start infrastructure
    start_infrastructure

    # Step 3: Create workspaces
    create_workspaces

    # Step 4: Setup environment
    setup_environment

    # Step 5: Install dependencies
    install_dependencies

    # Step 6: Run migrations
    run_migrations

    # Step 7: Generate Prisma client
    generate_prisma_client

    # Step 8: Build sandbox image
    build_sandbox_image

    # Step 9: Run tests (optional)
    if [ "$SKIP_TESTS" != "1" ]; then
        read -p "Run tests? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            run_tests
        fi
    fi

    # Print summary
    print_summary
}

# Run main function
main
