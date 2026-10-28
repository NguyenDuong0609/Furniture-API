import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(6),
    newPassword: z.string().min(6, 'Mật khẩu mới phải có ít nhất 6 ký tự'),
    confirmNewPassword: z.string().min(6),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Xác nhận mật khẩu mới không khớp',
    path: ['confirmNewPassword'],
  });

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}