import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, AuthPrincipal, PlatformPrincipal, RequestSchool } from './request';

export const IS_PUBLIC_KEY = 'schoolerp:public';
export const SKIP_TENANT_AUTH_KEY = 'schoolerp:skipTenantAuth';
export const PERMISSIONS_KEY = 'schoolerp:permissions';
export const IS_PLATFORM_KEY = 'schoolerp:platform';
export const PLATFORM_ROLES_KEY = 'schoolerp:platformRoles';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
export const SkipTenantAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_AUTH_KEY, true);
export const RequirePermissions = (...permissions: string[]): MethodDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
export const PlatformOnly = (): ClassDecorator => SetMetadata(IS_PLATFORM_KEY, true);
export const RequirePlatformRoles = (...roles: string[]): MethodDecorator =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.auth) throw new Error('CurrentAuth used without TenantAuthGuard');
    return request.auth;
  },
);

export const CurrentSchool = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestSchool => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.school) throw new Error('CurrentSchool used without tenant resolution');
    return request.school;
  },
);

export const CurrentPlatform = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformPrincipal => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.platform) throw new Error('CurrentPlatform used without PlatformAuthGuard');
    return request.platform;
  },
);

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<AppRequest>().requestId,
);
