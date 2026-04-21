-- AlterTable
ALTER TABLE "users" ADD COLUMN "full_name" TEXT NOT NULL DEFAULT '',
                    ADD COLUMN "password"  TEXT NOT NULL DEFAULT '';
