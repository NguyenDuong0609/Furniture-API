import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
/**
 * Kiểm tra giá trị có phải là string không
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Kiểm tra giá trị có phải là number không
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Kiểm tra object có property nhất định không
 */
export function hasProperty<T extends object, K extends string>(
  obj: T,
  key: K,
): obj is T & Record<K, unknown> {
  return key in obj;
}

/**
 * Kiểm tra error có phải là instance của Error không
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Kiểm tra object có đúng cấu trúc JwtPayload không
 */
export function isJwtPayload(value: unknown): value is JwtPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sub' in value &&
    'email' in value &&
    typeof (value as any).sub === 'number' &&
    typeof (value as any).email === 'string'
  );
}
