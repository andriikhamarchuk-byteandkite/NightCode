-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_sessionId_fkey";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "cwd",
ADD COLUMN     "messages" JSONB NOT NULL DEFAULT '[]';

-- DropTable
DROP TABLE "Message";

-- DropEnum
DROP TYPE "Role";

-- DropEnum
DROP TYPE "Mode";

-- DropEnum
DROP TYPE "MessageStatus";

