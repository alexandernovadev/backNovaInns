export interface IUser {
  _id?: any;
  auth: {
    email: string;
    passwordHash: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'GUEST';
  };
  profile: {
    fullName: string;
    phone: string;
    identificationNumber?: string;
    avatarUrl?: string;
  };
  workContext?: {
    assignedApartments: any[];
    lastLogin: Date;
    isActive: boolean;
  };
  preferences?: {
    language: 'es' | 'pt' | 'en';
    notificationsEnabled: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}
