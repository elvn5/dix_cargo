CREATE TYPE "ResetRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "access_reset_requests" (
    "id"                    SERIAL NOT NULL,
    "user_id"               INTEGER NOT NULL,
    "requested_telegram_id" BIGINT NOT NULL,
    "status"                "ResetRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at"           TIMESTAMP(3),
    CONSTRAINT "access_reset_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "access_reset_requests" ADD CONSTRAINT "access_reset_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
