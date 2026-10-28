import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const Login2FASchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  token: z
    .string()
    .length(6)
    .regex(/^\d+$/)
    .optional(), // chỉ bắt buộc khi user đã bật 2FA
});

export class Login2FADto extends createZodDto(Login2FASchema) {}