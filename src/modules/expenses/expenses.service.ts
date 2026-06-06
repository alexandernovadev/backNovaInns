import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { paginate } from '../../shared/pagination.util';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
  ) {}

  async create(dto: CreateExpenseDto): Promise<ExpenseDocument> {
    return new this.expenseModel({
      ...dto,
      apartmentId: dto.apartmentId ? new Types.ObjectId(dto.apartmentId) : null,
      date: new Date(dto.date),
    }).save();
  }

  async findAll(query: QueryExpenseDto) {
    const { search, category, fromDate, toDate, apartmentId } = query;
    const filter: Record<string, any> = {};

    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) filter.category = category;
    if (apartmentId) filter.apartmentId = new Types.ObjectId(apartmentId);

    if (fromDate || toDate) {
      const dateFilter: Record<string, Date> = {};
      if (fromDate) dateFilter.$gte = new Date(fromDate);
      if (toDate) dateFilter.$lte = new Date(toDate);
      filter.date = dateFilter;
    }

    return paginate(this.expenseModel, {
      filter,
      sort: { date: -1 },
      page: query.page,
      limit: query.limit ?? 20,
    });
  }

  async findById(id: string): Promise<ExpenseDocument> {
    const expense = await this.expenseModel.findById(id);
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseDocument> {
    const updateData: Record<string, unknown> = { ...dto };
    if (dto.date) updateData.date = new Date(dto.date);
    if (dto.apartmentId)
      updateData.apartmentId = new Types.ObjectId(dto.apartmentId);

    const expense = await this.expenseModel.findByIdAndUpdate(id, updateData, {
      new: true,
    });
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  async remove(id: string): Promise<void> {
    const result = await this.expenseModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Gasto no encontrado');
  }
}
