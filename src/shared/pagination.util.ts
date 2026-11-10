import { Model, PopulateOptions } from 'mongoose';

// Máximo de documentos por página en cualquier listado (los usos legítimos
// piden 20-100; el calendario tiene su propio tope en el service)
export const MAX_LIMIT = 100;

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
  /** tope de este uso concreto (el calendario necesita más que una tabla) */
  maxLimit?: number;
  /** documentos planos: más rápido y sin campos de relleno en la respuesta */
  lean?: boolean;
}

export async function paginate<T>(
  model: Model<T, any, any, any, any, any, any>,
  opts: PaginateOptions<T> = {},
): Promise<PaginatedResult<T>> {
  const {
    filter = {},
    select,
    populate,
    sort = {},
    page = 1,
    limit = 20,
    maxLimit = MAX_LIMIT,
    lean = false,
  } = opts;

  // Tope de página: un ?limit=100000 no debería ser una consulta legítima
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), maxLimit);
  const safePage = Math.max(Number(page) || 1, 1);

  let query = model
    .find(filter)
    .select(select ?? '')
    .sort(sort);
  if (populate) query = query.populate(populate);
  const paged = query.skip((safePage - 1) * safeLimit).limit(safeLimit);

  // El count y la página se piden a la vez: uno no depende del otro
  const [total, data] = lean
    ? await Promise.all([model.countDocuments(filter), paged.lean()])
    : await Promise.all([model.countDocuments(filter), paged]);
  const rows = (data ?? []) as unknown as T[];

  return {
    data: rows,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
