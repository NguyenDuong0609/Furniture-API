import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(9).max(15).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}