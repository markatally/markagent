-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('ACTIVE', 'EXTENDED', 'DEPRECATED', 'PROTECTED');

-- CreateEnum
CREATE TYPE "CapabilityLevel" AS ENUM ('EXTERNAL', 'INTERNAL', 'PRODUCT');

-- CreateEnum
CREATE TYPE "ExecutionScope" AS ENUM ('SYSTEM', 'AGENT', 'USER_VISIBLE');

-- CreateTable
CREATE TABLE "external_skills" (
    "id" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "SkillStatus" NOT NULL DEFAULT 'ACTIVE',
    "category" TEXT,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "invocation_pattern" TEXT,
    "dependencies" TEXT[],
    "file_path" TEXT NOT NULL,
    "capability_level" "CapabilityLevel" NOT NULL DEFAULT 'EXTERNAL',
    "runtime_version" TEXT,
    "execution_scope" "ExecutionScope" NOT NULL DEFAULT 'AGENT',
    "merged_from" TEXT[],
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "protection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_skill_sources" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "repo_path" TEXT NOT NULL,
    "commit_hash" TEXT,
    "license" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_skill_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_skills_canonical_id_key" ON "external_skills"("canonical_id");

-- CreateIndex
CREATE INDEX "external_skills_category_idx" ON "external_skills"("category");

-- CreateIndex
CREATE INDEX "external_skills_status_idx" ON "external_skills"("status");

-- CreateIndex
CREATE INDEX "external_skills_capability_level_idx" ON "external_skills"("capability_level");

-- CreateIndex
CREATE UNIQUE INDEX "external_skill_sources_skill_id_repo_url_repo_path_key" ON "external_skill_sources"("skill_id", "repo_url", "repo_path");

-- AddForeignKey
ALTER TABLE "external_skill_sources" ADD CONSTRAINT "external_skill_sources_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "external_skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
