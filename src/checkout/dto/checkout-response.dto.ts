export class CheckoutResponseDto {
  orderId: number | null;
  status: string;
  total: string;
  currency: string;
  checkoutUrl: string;
  sessionId: string;
  paymentUrl: string | null;
  provider?: 'stripe' | 'woopayments';
}
