export class WelcomeDiscountResponseDto {
  code: string;
  email: string;
  amount: string;
  discountType: string;
  expiresAt: string;
  emailSent?: boolean;
  alreadyIssued?: boolean;
}
