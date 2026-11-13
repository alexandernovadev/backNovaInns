import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../shared/enums';

const ROLES_KEY = 'roles';

// Roles que pueden usar el controller/handler. Va junto con JwtAuthGuard,
// que es el que deja el role del token en req.user
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    if (!user?.role || !roles.includes(user.role as Role))
      throw new ForbiddenException('No tienes permiso para esta función');
    return true;
  }
}
