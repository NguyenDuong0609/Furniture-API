import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ActiveUserData {
  id: number;
  email: string;
  name: string | null;
}

export const ActiveUser = createParamDecorator(
  (field: keyof ActiveUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: ActiveUserData = request.user;

    // Nếu truyền field cụ thể → trả về đúng field đó
    // Ví dụ: @ActiveUser('email')
    return field ? user?.[field] : user;
  },
);
