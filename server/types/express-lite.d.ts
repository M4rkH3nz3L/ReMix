// 🧩 Minimális Express-típusok a worker JSDoc-típusellenőrzéséhez (QUALITY 3. fázis).
// Szándékosan NEM @types/express: csak az itt ténylegesen használt felület, globális
// névtérként (`ExpressLite.Request` stb.), így a JS-fájlokban import nélkül hivatkozható.

declare namespace ExpressLite {
  /** a verifikált hívó (auth.js requireAuth tölti; insecure-dev módban null) */
  interface AuthUser {
    id: string;
    email?: string | null;
  }

  /** multer `upload.any()` egy fájl-eleme (diskStorage) */
  interface UploadedFile {
    fieldname?: string;
    originalname: string;
    mimetype?: string;
    size: number;
    path: string;
  }

  interface Request {
    method: string;
    path: string;
    ip?: string;
    socket?: { remoteAddress?: string };
    headers: import('http').IncomingHttpHeaders;
    user?: AuthUser | null;
    files?: UploadedFile[];
    /** a kérés munkakönyvtára (a feltöltő middleware állítja) */
    workDir?: string;
  }

  interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    setHeader(name: string, value: string | number | readonly string[]): Response;
    removeHeader(name: string): void;
  }

  type NextFunction = (err?: unknown) => void;

  type Handler = (req: Request, res: Response, next: NextFunction) => void;
}
