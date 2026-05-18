CREATE TABLE "promo_codes" (
  "id"          SERIAL PRIMARY KEY,
  "code"        TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "claimed_by"  INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "claimed_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
