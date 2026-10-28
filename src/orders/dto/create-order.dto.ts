import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  sessionId: z.string().optional(), // bắt buộc nếu là guest
  shippingName: z.string().min(2, 'Họ tên không được để trống'),
  shippingPhone: z.string().min(9, 'Số điện thoại không hợp lệ'),
  shippingAddress: z.string().min(5, 'Địa chỉ không được để trống'),
  shippingCity: z.string().optional(),
  shippingDistrict: z.string().optional(),
  paymentMethod: z.enum(['COD', 'BANK_TRANSFER']).default('COD'),
  note: z.string().optional(),
});

export class CreateOrderDto extends createZodDto(CreateOrderSchema) {}