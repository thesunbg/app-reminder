/**
 * Xếp tên app vào nhóm để báo cáo đọc được.
 *
 * Phân loại ở **server** chứ không ở agent: sửa một chỗ là mọi máy trong nhà
 * đổi theo, không phải cập nhật agent trên máy con. Dữ liệu thô (tên app) vẫn
 * được lưu nguyên, nên xếp sai hôm nay thì sửa lại bảng dưới và báo cáo cũ
 * cũng đúng theo — `recategorize()` tính lại toàn bộ.
 *
 * Đây là phần **báo cáo**, không phải phần chặn. Chặn và giới hạn giờ giao cho
 * Screen Time / Family Link ở tầng hệ điều hành — xem docs/PLAN.md mục 1.
 */

export const CATEGORIES = ['work', 'study', 'entertainment', 'social', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  work: 'Làm việc',
  study: 'Học tập',
  entertainment: 'Giải trí',
  social: 'Mạng xã hội',
  other: 'Khác',
}

/**
 * Từ khoá → nhóm, xét theo thứ tự nên cái cụ thể phải đứng trước cái chung.
 * So khớp trên tên app đã lowercase, dạng "chứa chuỗi này".
 */
const RULES: Array<[Category, string[]]> = [
  // Đặt trước 'entertainment' vì "YouTube Music" nên tính là giải trí chứ
  // không phải học, còn "Google Classroom" thì ngược lại.
  ['study', [
    'classroom', 'quizlet', 'khan academy', 'duolingo', 'anki', 'zoom', 'google meet',
    'microsoft teams', 'olm.vn', 'hocmai', 'vndoc', 'geogebra', 'wolfram',
  ]],
  ['work', [
    'code', 'visual studio', 'xcode', 'intellij', 'pycharm', 'webstorm', 'android studio',
    'terminal', 'iterm', 'powershell', 'cmd.exe', 'docker', 'postman', 'figma',
    'word', 'excel', 'powerpoint', 'keynote', 'numbers', 'pages', 'notion', 'obsidian',
    'slack', 'outlook', 'thunderbird', 'gmail', 'jira', 'github', 'gitlab',
  ]],
  ['social', [
    'facebook', 'messenger', 'instagram', 'tiktok', 'twitter', ' x.com', 'threads',
    'zalo', 'viber', 'whatsapp', 'telegram', 'discord', 'snapchat', 'reddit',
  ]],
  ['entertainment', [
    'youtube', 'netflix', 'spotify', 'steam', 'epic games', 'battle.net', 'roblox',
    'minecraft', 'league of legends', 'valorant', 'genshin', 'liên quân', 'garena',
    'twitch', 'vlc', 'iqiyi', 'fptplay', 'vieon', 'game',
  ]],
]

/**
 * Nhóm của một app. Không khớp gì thì 'other' — thà để "Khác" còn hơn đoán
 * bừa rồi báo cáo sai cho phụ huynh.
 */
export function categoryOf(appName: string): Category {
  const name = ` ${appName.toLowerCase()} `
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => name.includes(k))) return category
  }
  return 'other'
}

export const categoryLabel = (c: string): string =>
  CATEGORY_LABEL[c as Category] ?? CATEGORY_LABEL.other
