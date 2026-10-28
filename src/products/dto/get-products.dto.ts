import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GetProductsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12),
  search: z.string().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  categorySlug: z.string().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  isFeatured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .default(true),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  sortBy: z.enum(['price_asc', 'price_desc', 'newest', 'name']).optional().default('newest'),
});

export class GetProductsDto extends createZodDto(GetProductsSchema) {}
