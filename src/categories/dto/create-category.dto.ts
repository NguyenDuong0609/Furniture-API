import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z
    .string({ error: 'Tên danh mục không được để trống' })
    .min(2, 'Tên danh mục phải có ít nhất 2 ký tự'),
  slug: z
    .string({ error: 'Slug không được để trống' })
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug không hợp lệ'),
  description: z.string().optional(),
  image: z.string().url().optional().or(z.literal('')),
  parentId: z.number().int().positive().optional().nullable(),
});

export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}
