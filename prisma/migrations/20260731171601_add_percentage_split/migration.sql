-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('EVEN', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "splitType" "SplitType" NOT NULL DEFAULT 'EVEN';

-- AlterTable
ALTER TABLE "TransactionSplit" ADD COLUMN     "percent" INTEGER;
