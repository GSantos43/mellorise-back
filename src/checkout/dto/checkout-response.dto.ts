export class CheckoutResponseDto {
  orderId: number;
  status: string;
  total: string;
  currency: string;
  checkoutUrl: string;
  sessionId: string;
  paymentUrl: string | null;
}
