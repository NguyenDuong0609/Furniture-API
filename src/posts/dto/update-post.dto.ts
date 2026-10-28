import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePostSchema = z.object({
  title: z.string().min(3, 'Tiêu đề phải có ít nhất 3 ký tự').optional(),
  content: z.string().min(10, 'Nội dung phải có ít nhất 10 ký tự').optional(),
  published: z.boolean().optional(),
});

export class UpdatePostDto extends createZodDto(UpdatePostSchema) {}
