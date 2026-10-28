import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ConfirmCodSchema = z.object({
  orderId: z.number().int().positive(),
});

export class ConfirmCodDto extends createZodDto(ConfirmCodSchema) {}