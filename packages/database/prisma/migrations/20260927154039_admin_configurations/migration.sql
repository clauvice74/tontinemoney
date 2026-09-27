-- CreateTable
CREATE TABLE "administration"."adm_configurations" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "adm_configurations_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "administration"."adm_configuration_history" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "adm_configuration_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adm_configuration_history_key_version_key" ON "administration"."adm_configuration_history"("key", "version");

-- Historique des paramètres en ajout seul (même garde que les autres journaux)
CREATE TRIGGER "adm_configuration_history_append_only" BEFORE UPDATE OR DELETE ON "administration"."adm_configuration_history"
  FOR EACH ROW EXECUTE FUNCTION "public"."forbid_append_only_mutation"();
