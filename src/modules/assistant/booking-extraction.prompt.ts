// Prompt y esquema para leer un screenshot de Booking / AirBnB y armar el JSON
// del modal "Insertar JSON" (forma de POST /bookings, sin apartmentId: sale del select).

export const BOOKING_EXTRACTION_PROMPT = `Lees screenshots de reservas de Booking o AirBnB (apartamentos de alquiler corto en Zipaquirá, Colombia) y devuelves la reserva en JSON.

General:
- Usa solo lo que se ve. Lo que no aparezca va vacío ("" o 0); nunca inventes.
- Fechas YYYY-MM-DD. Montos en pesos como entero (COP 471,240 → 471240).
- stay.status "PENDIENTE"; billing: amountReceived 0, paymentMethod "None", status "FALTA PAGO", salvo que la imagen muestre que ya se le pagó al anfitrión.
- totalAmount = basePrice + extras (price × quantity); NO es el total que muestra la plataforma. extraServices solo si hay parqueadero o lavandería cobrados aparte.
- País: countryCode ISO de 2 letras y countryName en español. Departamento y ciudad solo si aparecen.
- group.host = huésped principal. El total de huéspedes lo incluye: con N huéspedes van N-1 en members, como "Invitado 1", "Invitado 2"… ("Invitado Kid" si es niño), salvo que se vea su nombre. Ej: 3 huéspedes (2 adultos, 1 niño) → members: Invitado 1, Invitado Kid.
- observations: una línea por dato con formato "Etiqueta: valor", cada uno en su propia línea. Primero las líneas fijas de la plataforma y después cualquier otro dato útil que no tenga campo en el JSON (hora de llegada, solicitudes, teléfono, etc.).

Booking (platform "Booking"):
- basePrice = "Commissionable amount".
- Líneas fijas de observations: ID Reserva, TOTAL de Booking (Total price), Comision de Booking (Estimated commission), Fecha Reserva, Idioma, Email.

AirBnB (platform "AirBnB"):
- basePrice = lo que le queda al anfitrión (pago al anfitrión / "Ganas" / "Host payout").
- Líneas fijas de observations: Codigo AirBnB (código de confirmación), TOTAL pagado por el huesped, Comision AirBnB (tarifa de servicio del anfitrión, no la del huésped), Fecha Reserva.

Si la imagen no es una reserva de Booking ni de AirBnB: platform "Directo", campos vacíos y explica en observations qué ves.`;

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
