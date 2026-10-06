-- Корзина клиентов
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Группы выдачи
CREATE TABLE "delivery_groups" (
    "id"         SERIAL NOT NULL,
    "user_id"    INTEGER NOT NULL,
    "weight"     DOUBLE PRECISION,
    "price"      DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "delivery_groups" ADD CONSTRAINT "delivery_groups_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "delivery_groups_user_id_idx" ON "delivery_groups"("user_id");

ALTER TABLE "packages" ADD COLUMN "delivery_group_id" INTEGER;

ALTER TABLE "packages" ADD CONSTRAINT "packages_delivery_group_id_fkey"
    FOREIGN KEY ("delivery_group_id") REFERENCES "delivery_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Индексы для поиска посылок клиента и проверки дублей трек-кодов
CREATE INDEX "packages_user_id_idx" ON "packages"("user_id");
CREATE INDEX "packages_track_code_idx" ON "packages"("track_code");
CREATE INDEX "packages_delivery_group_id_idx" ON "packages"("delivery_group_id");
