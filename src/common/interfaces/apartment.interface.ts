export interface IRoom {
  name: string;
  furniture: {
    beds: number;
    closets: number;
    nightstands: number;
  };
  windows: {
    curtains: number;
    sheers: number;
  };
  inventory: {
    hangers: number;
    pillows: number;
  };
}

export interface IBathroom {
  name: string;
  fixtures: {
    toilets: number;
    sinks: number;
    electricShowers: number;
  };
}

export interface IKitchenDetails {
  appliances: {
    fridges: number;
    stoves: number;
    microwaves: number;
    blenders: number;
  };
  cookware: {
    pots: number;
    pans: number;
  };
  seating: {
    diningSillas: number;
  };
}

export interface IApartment {
  _id?: any;
  internalName: string;
  rooms: IRoom[];
  bathrooms: IBathroom[];
  equipment: {
    kitchen: IKitchenDetails;
    electronics: {
      tvs: number;
      irons: number;
      hairDryers: number;
    };
    furniture: {
      sofas: number;
      sofaBeds: number;
      rugs: number;
      diningTables: number;
    };
  };
  parking: {
    totalSpots: number;
  };
  status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  createdAt: Date;
}
