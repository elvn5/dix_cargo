CREATE TYPE "PackageStatus" AS ENUM ('IN_OFFICE', 'IN_TRANSIT', 'DELIVERED');

CREATE TABLE "packages" (
    "id"         SERIAL NOT NULL,
    "track_code" TEXT NOT NULL,
    "status"     "PackageStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "user_id"    INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "packages" ADD CONSTRAINT "packages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
