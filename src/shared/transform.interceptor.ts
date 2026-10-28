import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators'; // Hoặc import map từ 'rxjs' nhưng dùng qua pipe

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 1. Phải gọi .pipe() trước khi dùng các operator như map
    return next.handle().pipe(
      map((data) => {
        if (data === null || data === undefined) {
          return {
            success: true,
            message: 'OK',
            data: null,
          };
        }

        // Nếu service trả { message, ...rest }
        if (typeof data === 'object' && data.message && !Array.isArray(data)) {
          const { message, ...rest } = data;
          return {
            success: true,
            message,
            data: Object.keys(rest).length ? rest : null,
          };
        }

        return {
          success: true,
          message: 'OK',
          data,
        };
      }),
    );
  }
}
