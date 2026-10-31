// Prompt y esquema para leer un screenshot de Booking / AirBnB y armar el JSON
// del modal "Insertar JSON" (forma de POST /bookings, sin apartmentId: sale del select).

export const BOOKING_EXTRACTION_PROMPT = `Lees screenshots de reservas de Booking o AirBnB de un negocio de apartamentos de alquiler corto en Zipaquirá, Colombia, y devuelves un JSON con la reserva.

Reglas generales:
- Usa solo lo que se ve en la imagen. Si un dato no aparece, déjalo vacío ("" o 0). Nunca lo inventes.
- Fechas en formato YYYY-MM-DD.
- Montos en pesos colombianos como número entero, sin puntos, comas ni símbolo (COP 471,240 → 471240).
- stay.status siempre "PENDIENTE".
- billing.amountReceived = 0, billing.paymentMethod = "None", billing.status = "FALTA PAGO", salvo que la imagen diga claramente que ya se pagó al anfitrión.
- billing.totalAmount = basePrice + la suma de extraServices (price × quantity). Si no hay extras, totalAmount = basePrice.
- extraServices vacío salvo que la imagen muestre parqueadero o lavandería cobrados aparte.
- País del huésped: countryCode ISO de 2 letras y countryName en español (CO / Colombia). department y city solo si aparecen.

Huéspedes:
- group.host es el huésped principal (el nombre de la reserva).
- Por cada acompañante agrega un elemento en group.members. Si no se ve su nombre, usa "Invitado 1", "Invitado 2", etc. Si es un niño, usa "Invitado Kid".

Booking:
- platform = "Booking".
- basePrice = "Commissionable amount".
- observations: una línea por dato (cada dato en su propia línea), en este orden y solo las que aparezcan:
  ID Reserva: <número de reserva>
  TOTAL de Booking: <Total price, tal como aparece>
  Comision de Booking: <Estimated commission, tal como aparece>
  Fecha Reserva: <fecha en que se hizo la reserva>
  Idioma: <idioma del huésped>
  Email: <email del huésped>

AirBnB (reglas provisionales):
- platform = "AirBnB".
- basePrice = lo que gana el anfitrión ("Ganas", "Tu pago", "Host payout"). Si no aparece, usa el total y dilo en observations.
- observations: una línea por dato (cada dato en su propia línea): código de confirmación, total pagado por el huésped, tarifa de servicio de AirBnB, fecha de la reserva.

Si la imagen no es una reserva de Booking ni AirBnB, devuelve platform "Directo", todo vacío y en observations explica qué viste.`;

const guest = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    idNumber: { type: 'string' },
  },
  required: ['fullName', 'idNumber'],
};

export const BOOKING_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    group: {
      type: 'object',
      properties: {
        host: {
          type: 'object',
          properties: {
            ...guest.properties,
            birthDate: { type: 'string', description: 'YYYY-MM-DD o vacío' },
            location: {
              type: 'object',
              properties: {
                countryCode: { type: 'string' },
                countryName: { type: 'string' },
                department: { type: 'string' },
                city: { type: 'string' },
              },
              required: ['countryCode', 'countryName', 'department', 'city'],
            },
          },
          required: ['fullName', 'idNumber', 'birthDate', 'location'],
        },
        members: { type: 'array', items: guest },
      },
      required: ['host', 'members'],
    },
    stay: {
      type: 'object',
      properties: {
        checkIn: { type: 'string', description: 'YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string', enum: ['PENDIENTE'] },
      },
      required: ['checkIn', 'checkOut', 'status'],
    },
    billing: {
      type: 'object',
      properties: {
        basePrice: { type: 'integer' },
        extraServices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['PARKING', 'LAUNDRY', 'OTHER'] },
              description: { type: 'string' },
              quantity: { type: 'integer' },
              price: { type: 'integer' },
            },
            required: ['type', 'description', 'quantity', 'price'],
          },
        },
        totalAmount: { type: 'integer' },
        amountReceived: { type: 'integer' },
        platform: { type: 'string', enum: ['Booking', 'AirBnB', 'Directo'] },
        paymentMethod: {
          type: 'string',
          enum: ['Efectivo', 'Nequi', 'Bancolombia', 'None'],
        },
        status: { type: 'string', enum: ['PAGADO', 'FALTA PAGO', 'NO SHOW'] },
      },
      required: [
        'basePrice',
        'extraServices',
        'totalAmount',
        'amountReceived',
        'platform',
        'paymentMethod',
        'status',
      ],
    },
    observations: { type: 'string' },
  },
  required: ['group', 'stay', 'billing', 'observations'],
};
