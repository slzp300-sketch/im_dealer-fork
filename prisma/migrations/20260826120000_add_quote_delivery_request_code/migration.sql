ALTER TABLE "QuoteDelivery" ADD COLUMN "requestCode" TEXT;

CREATE UNIQUE INDEX "QuoteDelivery_requestCode_key" ON "QuoteDelivery"("requestCode");
