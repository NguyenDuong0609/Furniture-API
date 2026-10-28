import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const Enable2FASchema = z.object({
  // không cần body khi generate QR
});

export class Enable2FADto extends createZodDto(Enable2FASchema) {}