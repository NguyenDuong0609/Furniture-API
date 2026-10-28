import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().min(1),
});

export class UpdateCartItemDto extends createZodDto(UpdateCartItemSchema) {}