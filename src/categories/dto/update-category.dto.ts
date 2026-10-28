import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateCategorySchema = z.object({
  name: z.string().min(2).optional(),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  description: z.string().optional(),
  image: z.string().url().optional().or(z.literal('')),
  parentId: z.number().int().positive().optional().nullable(),
});

export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}