import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Apartment, ApartmentDocument } from './schemas/apartment.schema';
import { paginate } from '../../shared/pagination.util';
import { ApartmentStatus } from '../../shared/enums';

export interface ApartmentQuery {
  search?:  string;
  status?:  string;
  page?:    number;
  limit?:   number;
}

@Injectable()
export class ApartmentsService {
  constructor(@InjectModel(Apartment.name) private model: Model<ApartmentDocument>) {}

  async create(data: Partial<Apartment>): Promise<ApartmentDocument> {
    return new this.model(data).save();
  }

  async findAll(query: ApartmentQuery = {}) {
    const { search, status } = query;
    const filter: Record<string, any> = {};

    if (search) filter.internalName = { $regex: search, $options: 'i' };
    if (status) filter.status = status;

    return paginate(this.model, {
      filter,
      select: 'internalName status rooms bathrooms parking photos createdAt',
      sort: { internalName: 1 },
      page: query.page,
      limit: query.limit ?? 20,
    });
  }

  async findById(id: string): Promise<ApartmentDocument> {
    const apartment = await this.model.findById(id);
    if (!apartment) throw new NotFoundException('Apartamento no encontrado');
    return apartment;
  }

  async update(id: string, data: Partial<Apartment>): Promise<ApartmentDocument> {
    const apartment = await this.model.findByIdAndUpdate(id, data, { returnDocument: 'after' });
    if (!apartment) throw new NotFoundException('Apartamento no encontrado');
    return apartment;
  }

  async setStatus(id: string, status: ApartmentStatus): Promise<ApartmentDocument> {
    return this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    const result = await this.model.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Apartamento no encontrado');
  }

  // --- Photos ---
  async addPhoto(id: string, photo: { url: string; publicId: string; caption?: string }): Promise<ApartmentDocument> {
    const apartment = await this.model.findById(id);
    if (!apartment) throw new NotFoundException('Apartamento no encontrado');
    apartment.photos.push({ url: photo.url, publicId: photo.publicId, caption: photo.caption ?? '', uploadedAt: new Date() });
    return apartment.save();
  }

  async removePhoto(id: string, publicId: string): Promise<ApartmentDocument> {
    const apartment = await this.model.findById(id);
    if (!apartment) throw new NotFoundException('Apartamento no encontrado');
    apartment.photos = apartment.photos.filter((p: any) => p.publicId !== publicId);
    return apartment.save();
  }
}
