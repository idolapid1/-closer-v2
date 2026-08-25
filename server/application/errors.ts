export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null, code = 'NOT_FOUND'): T {
  if (value === null) throw new ApiError(404, code, 'The requested resource was not found');
  return value;
}

