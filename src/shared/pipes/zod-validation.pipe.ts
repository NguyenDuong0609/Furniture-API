import { PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema?: ZodSchema) {} // Thêm dấu ? để không bắt buộc truyền tham số

  transform(value: unknown, metadata: ArgumentMetadata) {
    if (!this.schema) {
      return value; // Nếu không truyền schema thì bỏ qua, tránh lỗi
    }
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.format());
    }
    return result.data; // Đổi từ result.value thành result.data
  }
}
