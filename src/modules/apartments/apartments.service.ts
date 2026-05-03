import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Apartment, ApartmentDocument } from './schemas/apartment.schema';

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
    const { search, status, page = 1, limit = 20 } = query;
    const filter: Record<string, any> = {};

    if (search) filter.internalName = { $regex: search, $options: 'i' };
    if (status) filter.status = status;

    const total = await this.model.countDocuments(filter);
    const data  = await this.model
      .find(filter)
      .select('internalName status rooms bathrooms parking photos createdAt')
      .sort({ internalName: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string): Promise<ApartmentDocument> {
    const apt = await this.model.findById(id);
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    return apt;
  }

  async update(id: string, data: Partial<Apartment>): Promise<ApartmentDocument> {
    const apt = await this.model.findByIdAndUpdate(id, data, { returnDocument: 'after' });
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    return apt;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE'): Promise<ApartmentDocument> {
    return this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    const result = await this.model.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Apartamento no encontrado');
  }

  // --- Photos ---
  async addPhoto(id: string, photo: { url: string; publicId: string; caption?: string }): Promise<ApartmentDocument> {
    const apt = await this.model.findById(id);
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    apt.photos.push({ url: photo.url, publicId: photo.publicId, caption: photo.caption ?? '', uploadedAt: new Date() });
    return apt.save();
  }

  async removePhoto(id: string, publicId: string): Promise<ApartmentDocument> {
    const apt = await this.model.findById(id);
    if (!apt) throw new NotFoundException('Apartamento no encontrado');
    apt.photos = apt.photos.filter((p: any) => p.publicId !== publicId);
    return apt.save();
  }
}
