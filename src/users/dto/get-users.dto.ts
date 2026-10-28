import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GetUsersSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  search: z.string().optional(),
  role: z.string().optional(), // ADMIN, USER...
});

export class GetUsersDto extends createZodDto(GetUsersSchema) {}