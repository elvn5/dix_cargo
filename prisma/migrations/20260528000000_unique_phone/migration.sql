-- AlterTable: make phone unique
ALTER TABLE "users" ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");
