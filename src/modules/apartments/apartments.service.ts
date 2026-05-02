import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Apartment, ApartmentDocument } from './schemas/apartment.schema';

@Injectable()
export class ApartmentsService {
  constructor(@InjectModel(Apartment.name) private apartmentModel: Model<ApartmentDocument>) {}

  async create(data: Partial<Apartment>): Promise<ApartmentDocument> {
    return new this.apartmentModel(data).save();
  }

  async findAll(): Promise<ApartmentDocument[]> {
    return this.apartmentModel.find().sort({ internalName: 1 });
  }

  async findById(id: string): Promise<ApartmentDocument> {
    const apt = await this.apartmentModel.findById(id);
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    return apt;
  }

  async update(id: string, data: Partial<Apartment>): Promise<ApartmentDocument> {
    const apt = await this.apartmentModel.findByIdAndUpdate(id, data, { new: true });
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    return apt;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE'): Promise<ApartmentDocument> {
    return this.update(id, { status });
  }
}
