// Express type augmentation so req.user is typed after requireAuth().
import type { Role } from "../rbac/permissions.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {}