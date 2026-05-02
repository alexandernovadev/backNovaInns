export interface IIdentificationSource {
  url: string;
  type: 'FRONT' | 'BACK' | 'SELFIE';
  uploadedAt: Date;
}

export interface IGuest {
  fullName: string;
  identifications: IIdentificationSource[];
}

export interface IExtraService {
  type: 'CAR' | 'MOTORCYCLE' | 'OTHER';
  description: string;
  quantity: number;
  price: number;
}

export interface IBooking {
  _id?: any;
  apartmentId: any;
  group: {
    host: IGuest;
    members: IGuest[];
  };
  stay: {
    checkIn: Date;
    checkOut: Date;
  };
  billing: {
    basePrice: number;
    extraServices: IExtraService[];
    totalAmount: number;     // basePrice + suma de extraServices
    amountReceived: number;  // Lo que ya se recibió
    // pendingAmount = totalAmount - amountReceived (calculado)
    platform: 'Booking' | 'AirBnB' | 'Directo';
    paymentMethod: 'Efectivo' | 'Nequi' | 'Bancolombia' | 'None';
    status: 'PAGADO' | 'FALTA PAGO' | 'NO SHOW';
  };
  observations: string;
  createdAt: Date;
}
