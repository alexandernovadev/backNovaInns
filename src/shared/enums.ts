export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  GUEST = 'GUEST',
}

export enum ApartmentStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  INACTIVE = 'INACTIVE',
}

export enum Language {
  ES = 'es',
  PT = 'pt',
  EN = 'en',
}

export const ROLES = Object.values(Role);
export const APARTMENT_STATUSES = Object.values(ApartmentStatus);
