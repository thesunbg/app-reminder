-- Tìm kiếm không dấu, KHÔNG cần extension.
--
-- `unaccent` là extension phải cài bằng quyền superuser; máy chủ quản lý có nơi
-- không cho. Một hàm translate() tự viết thì đi theo migration, chạy được ở mọi
-- nơi, và đủ cho tiếng Việt: bảng dưới phủ hết nguyên âm có dấu và chữ đ.
--
-- IMMUTABLE để Postgres được phép dùng nó trong index về sau, nếu quy mô lớn
-- lên và cần pg_trgm. Ở quy mô gia đình (vài nghìn dòng) quét bảng đã đủ nhanh.
CREATE OR REPLACE FUNCTION vn_unaccent(t text) RETURNS text AS $$
  SELECT lower(translate(t,
    'àÀáÁạẠảẢãÃâÂầẦấẤậẬẩẨẫẪăĂằẰắẮặẶẳẲẵẴèÈéÉẹẸẻẺẽẼêÊềỀếẾệỆểỂễỄìÌíÍịỊỉỈĩĨòÒóÓọỌỏỎõÕôÔồỒốỐộỘổỔỗỖơƠờỜớỚợỢởỞỡỠùÙúÚụỤủỦũŨưƯừỪứỨựỰửỬữỮỳỲýÝỵỴỷỶỹỸđĐ',
    'aAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAeEeEeEeEeEeEeEeEeEeEeEiIiIiIiIiIoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOuUuUuUuUuUuUuUuUuUuUuUyYyYyYyYyYdD'))
$$ LANGUAGE sql IMMUTABLE;
