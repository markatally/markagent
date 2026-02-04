-- AlterTable
ALTER TABLE "external_skills" ADD COLUMN     "contract_version" TEXT,
ADD COLUMN     "lifecycle_status" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_external_skills" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "custom_config" JSONB,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_external_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_skill_executions" (
    "id" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "trace_id" TEXT NOT NULL,
    "parent_execution_id" TEXT,
    "input" JSONB NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "status" TEXT NOT NULL,
    "error_type" TEXT,
    "error_message" TEXT,
    "execution_time_ms" INTEGER,
    "tokens_used" INTEGER,
    "tools_used" TEXT[],
    "policy_snapshot" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_skill_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_external_skills_user_id_idx" ON "user_external_skills"("user_id");

-- CreateIndex
CREATE INDEX "user_external_skills_canonical_id_idx" ON "user_external_skills"("canonical_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_external_skills_user_id_canonical_id_key" ON "user_external_skills"("user_id", "canonical_id");

-- CreateIndex
CREATE INDEX "external_skill_executions_user_id_created_at_idx" ON "external_skill_executions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "external_skill_executions_canonical_id_created_at_idx" ON "external_skill_executions"("canonical_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "external_skill_executions_status_idx" ON "external_skill_executions"("status");

-- CreateIndex
CREATE INDEX "external_skill_executions_trace_id_idx" ON "external_skill_executions"("trace_id");

-- CreateIndex
CREATE INDEX "external_skill_executions_session_id_idx" ON "external_skill_executions"("session_id");

-- AddForeignKey
ALTER TABLE "user_external_skills" ADD CONSTRAINT "user_external_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_external_skills" ADD CONSTRAINT "user_external_skills_canonical_id_fkey" FOREIGN KEY ("canonical_id") REFERENCES "external_skills"("canonical_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_skill_executions" ADD CONSTRAINT "external_skill_executions_canonical_id_fkey" FOREIGN KEY ("canonical_id") REFERENCES "external_skills"("canonical_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_skill_executions" ADD CONSTRAINT "external_skill_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
