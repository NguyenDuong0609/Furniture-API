import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const VariantSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().min(0).default(0),
  attributes: z.record(z.string(), z.string()).optional(), // { color: "Gray", material: "Oak" }
});

const ImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().optional(),
  isMain: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const CreateProductSchema = z.object({
  name: z.string().min(2, 'Tên sản phẩm phải có ít nhất 2 ký tự'),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug không hợp lệ'),
  description: z.string().optional(),
  price: z.number().positive('Giá phải lớn hơn 0'),
  salePrice: z.number().positive().optional().nullable(),
  sku: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  categoryId: z.number().int().positive(),
  brandId: z.number().int().positive().optional().nullable(),
  images: z.array(ImageSchema).optional(),
  variants: z.array(VariantSchema).optional(),
});

export class CreateProductDto extends createZodDto(CreateProductSchema) {}
