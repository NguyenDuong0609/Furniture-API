import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token không được để trống'),
});

export class LogoutDto extends createZodDto(LogoutSchema) {}
