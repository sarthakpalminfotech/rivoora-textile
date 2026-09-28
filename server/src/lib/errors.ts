export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, field?: string) => new HttpError(400, message, field);
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, message);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const conflict = (message: string, field?: string) => new HttpError(409, message, field);
