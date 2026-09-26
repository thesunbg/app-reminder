-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Phụ huynh được tạo SỚM NHẤT trong mỗi gia đình trở thành admin.
-- Không có bước này thì sau khi deploy không ai là admin nữa và cả nhà bị khoá
-- ngoài phần quản lý thành viên. Người này chính là người đã bootstrap gia đình.
UPDATE "User" SET "isAdmin" = true
WHERE id IN (
  SELECT DISTINCT ON ("familyId") id
  FROM "User"
  WHERE role = 'PARENT'
  ORDER BY "familyId", "createdAt" ASC, id ASC
);
