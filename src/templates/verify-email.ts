export interface VerifyEmailTemplateData {
  email: string;
  verifyLink: string;
  expiresAt: Date;
}

export interface BrandConfig {
  name: string;
  supportEmail?: string;
  url?: string;
}

export function renderVerifyEmail(brand: BrandConfig, data: VerifyEmailTemplateData) {
  const { email, verifyLink, expiresAt } = data;
  const expiresText = expiresAt.toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Xác thực email tài khoản</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .info-box h3 { color: #667eea; margin-top: 0; }
    .btn { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; text-align: center; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 0.9em; }
    .warning { color: #e74c3c; font-weight: bold; }
    .email-icon { font-size: 48px; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="email-icon">✉️</div>
    <h1>Xác thực email</h1>
    <p>Vui lòng xác thực địa chỉ email của bạn</p>
  </div>

  <div class="content">
    <p>Chào bạn,</p>
    <p>Cảm ơn bạn đã đăng ký tài khoản tại <strong>${brand.name}</strong>. Để hoàn tất đăng ký, vui lòng xác thực địa chỉ email: <strong>${email}</strong></p>

    <div class="info-box">
      <h3>⚠️ Quan trọng</h3>
      <p>Link xác thực sẽ hết hạn vào lúc <strong>${expiresText}</strong> (24 giờ từ lúc nhận email này).</p>
      <p class="warning">Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email này.</p>
    </div>

    <div style="text-align: center;">
      <a href="${verifyLink}" class="btn">Xác thực email</a>
    </div>

    <p>Nếu nút trên không hoạt động, hãy copy và paste link sau vào trình duyệt:</p>
    <p style="word-break: break-all; color: #667eea; font-size: 0.9em;">${verifyLink}</p>

    <p>Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với chúng tôi qua email ${brand.supportEmail}</p>
  </div>

  <div class="footer">
    <p>${brand.name} - ${brand.url}</p>
    <p>Email này được gửi tự động, vui lòng không trả lời.</p>
  </div>
</body>
</html>
  `.trim();

  return { html, subject: 'Xác thực email tài khoản của bạn' };
}
