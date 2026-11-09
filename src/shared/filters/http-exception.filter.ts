import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse<Response>();
        const req = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message: string | string[] = 'Internal server error';
        let code = 'INTERNAL_ERROR';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const body = exception.getResponse();
            if (typeof body === 'string') {
                message = body;
            } else if (typeof body === 'object' && body !== null) {
                message = (body as any).message || message;
                code = (body as any).error || code;
            }
        } else if (exception instanceof Error) {
            this.logger.error(exception.message, exception.stack);
            if (process.env.NODE_ENV !== 'production') {
                message = exception.message;
            }
        }

        res.status(status).json({
            success: false,
            statusCode: status,
            code,
            message,
            path: req.url,
            timestamp: new Date().toISOString(),
        });
    }
}