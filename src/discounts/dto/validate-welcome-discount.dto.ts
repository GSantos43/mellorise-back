import { IsEmail, IsString, MaxLength } from 'class-validator';

export class ValidateWelcomeDiscountDto {
  @IsString()
  @MaxLength(80)
  couponCode: string;

  @IsEmail()
  customerEmail: string;
}
