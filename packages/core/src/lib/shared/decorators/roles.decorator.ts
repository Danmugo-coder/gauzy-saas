import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { ROLES_METADATA } from '@gauzy/constants';
import { RolesEnum } from '@gauzy/contracts';

export const Roles = (...roles: RolesEnum[]): CustomDecorator => SetMetadata(ROLES_METADATA, roles);
