import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateProductSchema = z.object({
  name: z.string().min(2).optional(),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  salePrice: z.number().positive().optional().nullable(),
  sku: z.string().optional().nullable(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  categoryId: z.number().int().positive().optional(),
  brandId: z.number().int().positive().optional().nullable(),
});

export class UpdateProductDto extends createZodDto(UpdateProductSchema) {}