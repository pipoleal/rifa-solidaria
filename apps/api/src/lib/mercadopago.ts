import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error("MP_ACCESS_TOKEN não está definida.");
}

const mercadoPagoConfig = new MercadoPagoConfig({ accessToken });

export const preferenceClient = new Preference(mercadoPagoConfig);
export const paymentClient = new Payment(mercadoPagoConfig);
