import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(9).max(15).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  roleIds: z.array(z.number().int().positive()).optional(), // gán role
});

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}