import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const Verify2FASchema = z.object({
  token: z
    .string()
    .length(6, 'Mã 2FA phải có 6 chữ số')
    .regex(/^\d+$/, 'Mã 2FA chỉ gồm số'),
});

export class Verify2FADto extends createZodDto(Verify2FASchema) {}