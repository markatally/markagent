# Mark Agent

AI-powered autonomous agent that executes complex tasks through natural language interaction, tool usage, and code execution.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.0+ (or Node.js 20+)
- [Docker](https://www.docker.com/) and Docker Compose
- PostgreSQL 16+ (or use Docker)
- Redis 7+ (or use Docker)

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your LLM_API_KEY and other settings
```

### 3. Start Infrastructure

```bash
# Start database and Redis
docker-compose up -d db redis
```

### 4. Run Database Migrations

```bash
cd apps/api
bunx prisma migrate dev
cd ../..
```

### 5. Start Development Servers

```bash
# Start both frontend and backend
bun run dev

# Or start separately:
bun run dev:api  # Backend on http://localhost:4000
bun run dev:web  # Frontend on http://localhost:3000
```

## Project Structure

```
mark-agent/
├── apps/
│   ├── web/           # React frontend
│   └── api/           # Hono backend
├── packages/
│   └── shared/        # Shared types
├── skills/            # Agent skills (31 total)
├── config/            # Configuration files
└── docker/            # Docker files
```

## Available Scripts

```bash
bun run dev          # Start all services
bun run dev:web      # Start frontend only
bun run dev:api      # Start backend only
bun run build        # Build for production
bun run test         # Run tests
bun run lint         # Run linting
bun run worker       # Start background worker
bun run db:migrate   # Run database migrations
bun run db:studio    # Open Prisma Studio
```

## Skills

31 predefined skills across 10 categories:

- **Development**: /code, /refactor, /review, /api, /prompt, /tool, /auth, /component
- **DevOps**: /deploy, /docker, /git, /migrate, /ci, /env, /monitor
- **Documentation**: /docs, /api-docs, /changelog
- **Testing**: /test, /coverage
- **Debugging**: /debug, /fix
- **Analysis**: /analyze, /security
- **Web**: /scrape, /search
- **Data**: /data, /sql
- **Integration**: /mcp
- **Planning**: /plan, /architect

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `POST /api/sessions` - Create session
- `POST /api/sessions/:id/messages` - Send message
- `GET /api/sessions/:id/stream` - SSE stream

See `spec.md` for complete API documentation.

## Configuration

Edit `config/default.json` to customize:

- LLM settings (model, temperature, tokens)
- Rate limits
- Sandbox settings
- Tool permissions
- Security settings

## Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## License

MIT
