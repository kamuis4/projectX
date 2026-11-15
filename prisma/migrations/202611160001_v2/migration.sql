-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "subcategory" TEXT NOT NULL DEFAULT 'Général',
ADD COLUMN     "variants" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'private',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryItem_ownerKey_kind_idx" ON "LibraryItem"("ownerKey", "kind");

-- CreateIndex
CREATE INDEX "LibraryItem_kind_status_idx" ON "LibraryItem"("kind", "status");

