import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GetOrdersSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  status: z
    .enum([
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ])
    .optional(),
});

export class GetOrdersDto extends createZodDto(GetOrdersSchema) {}