export interface Brand {
    name: string;
    url?: string;
    supportEmail?: string;
    orderUrl?: (code: string) => string | undefined;
}

export const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + 'đ';

export const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(d);

export const METHODS: Record<string, string> = {
    BANK_TRANSFER: 'Chuyển khoản QR', NAPAS_BANK_TRANSFER: 'QR NAPAS', CARD: 'Thẻ',
};

export const COLORS = {
    ok: { fg: '#16a34a', bg: '#e8f7ee' },
    warn: { fg: '#d97706', bg: '#fff4e0' },
    err: { fg: '#dc2626', bg: '#fdecec' },
};

// Bảng "nhãn - giá trị". Giá trị luôn được escape tại đây.
export function infoTable(rows: [string, string][]) {
    const tr = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 0;font-size:14px;color:#6b7385;">${esc(k)}</td>
      <td align="right" style="padding:8px 0;font-size:14px;font-weight:600;color:#1d2433;word-break:break-all;">${esc(v)}</td>
    </tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef1f7;border-bottom:1px solid #eef1f7;margin:8px 0 20px;">${tr}</table>`;
}

export function button(href: string, label: string, color = '#2563eb') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px;"><tr>
    <td style="border-radius:10px;background:${color};">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
    </td></tr></table>`;
}

export function layout(b: Brand, o: {
    title: string; preheader: string; tone: keyof typeof COLORS;
    icon: string; heading: string; intro: string; body: string;
}) {
    const c = COLORS[o.tone];
    const support = b.supportEmail
        ? `Cần hỗ trợ? Liên hệ <a href="mailto:${esc(b.supportEmail)}" style="color:#2563eb;">${esc(b.supportEmail)}</a>.`
        : '';
    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e7ef;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d2433;">
    <tr><td style="padding:20px 28px;font-size:18px;font-weight:700;border-bottom:1px solid #eef1f7;">${esc(b.name)}</td></tr>
    <tr><td align="center" style="padding:32px 28px 8px;">
      <div style="width:64px;height:64px;line-height:64px;border-radius:50%;background:${c.bg};color:${c.fg};font-size:30px;font-weight:700;margin:0 auto 16px;">${o.icon}</div>
      <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#1d2433;">${esc(o.heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.5;color:#6b7385;">${esc(o.intro)}</p>
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">${o.body}</td></tr>
    <tr><td style="padding:18px 28px;background:#f8f9fc;font-size:12px;line-height:1.6;color:#6b7385;text-align:center;">
      ${support}<br>Email này được gửi tự động từ ${esc(b.name)}, vui lòng không trả lời trực tiếp.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}