import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GetPostsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  search: z.string().optional(),
  published: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
});

export class GetPostsDto extends createZodDto(GetPostsSchema) {}
