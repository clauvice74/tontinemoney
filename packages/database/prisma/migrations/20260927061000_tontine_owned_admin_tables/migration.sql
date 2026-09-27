-- Propriété corrigée : les comptes de tontine (US-10.2) et les messages ciblés (US-10.3) sont
-- écrits uniquement par le service Tontines ; leurs tables quittent le schéma administration.
-- Noms de tables inchangés (préfixe adm_ historique) pour ne rien casser.
ALTER TYPE "administration"."TontineAccountType" SET SCHEMA "tontines";
ALTER TYPE "administration"."MessageTemplate" SET SCHEMA "tontines";
ALTER TABLE "administration"."adm_tontine_accounts" SET SCHEMA "tontines";
ALTER TABLE "administration"."adm_messages" SET SCHEMA "tontines";
