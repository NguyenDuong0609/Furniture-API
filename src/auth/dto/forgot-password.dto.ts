// forgot-password.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class ForgotPasswordDto extends createZodDto(
    z.object({ email: z.string().email() }),
) { }

export class ResetPasswordDto extends createZodDto(
    z.object({
        token: z.string().min(10),
        newPassword: z.string().min(6),
        confirmPassword: z.string().min(6),
    }).refine((d) => d.newPassword === d.confirmPassword, {
        message: 'Mật khẩu xác nhận không khớp',
        path: ['confirmPassword'],
    }),
) { }

export class VerifyEmailDto extends createZodDto(
    z.object({ token: z.string().min(10) }),
) { }