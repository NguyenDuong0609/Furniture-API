import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreatePostSchema = z.object({
  title: z.string().min(1, 'Tiêu đề không được để trống').min(3, 'Tiêu đề phải có ít nhất 3 ký tự'),
  content: z
    .string()
    .min(1, 'Nội dung không được để trống')
    .min(10, 'Nội dung phải có ít nhất 10 ký tự'),
  published: z.boolean().optional().default(false),
});

export class CreatePostDto extends createZodDto(CreatePostSchema) {}
