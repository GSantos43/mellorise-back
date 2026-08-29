import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWelcomeDiscountDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorId?: string;
}
