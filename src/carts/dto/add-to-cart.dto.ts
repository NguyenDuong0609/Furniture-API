import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AddToCartSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().min(1).default(1),
  sessionId: z.string().optional(), // bắt buộc nếu chưa login
});

export class AddToCartDto extends createZodDto(AddToCartSchema) {}