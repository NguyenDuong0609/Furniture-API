import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreatePaymentSchema = z.object({
  orderId: z.number().int().positive(),
  returnUrl: z.string().url().optional(), // URL frontend nhận kết quả
});

export class CreatePaymentDto extends createZodDto(CreatePaymentSchema) {}