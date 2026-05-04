import { Model, PopulateOptions } from 'mongoose';

export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PaginateOptions<T> {
  filter?: Record<string, any>;
  select?: string;
  populate?: PopulateOptions | (PopulateOptions | string)[];
  sort?: Record<string, 1 | -1>;
  page?: number;
  limit?: number;
}

export async function paginate<T>(
  model: Model<T>,
  opts: PaginateOptions<T> = {},
): Promise<PaginatedResult<T>> {
  const { filter = {}, select, populate, sort = {}, page = 1, limit = 20 } = opts;
  const total = await model.countDocuments(filter);
  let query = model.find(filter).select(select ?? '').sort(sort).skip((page - 1) * limit).limit(limit);
  if (populate) query = query.populate(populate);
  const data = await query;
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}
