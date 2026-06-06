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

export enum ExpenseCategory {
  SUPPLIES = 'SUPPLIES',
  MAINTENANCE = 'MAINTENANCE',
  CLEANING = 'CLEANING',
  SERVICES = 'SERVICES',
  TAXES = 'TAXES',
  SALARY = 'SALARY',
  MARKETING = 'MARKETING',
  UTILITIES = 'UTILITIES',
  OTHER = 'OTHER',
}

export const ROLES = Object.values(Role);
export const APARTMENT_STATUSES = Object.values(ApartmentStatus);
export const EXPENSE_CATEGORIES = Object.values(ExpenseCategory);
