import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWelcomeDiscountDto {
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorId?: string;
}
