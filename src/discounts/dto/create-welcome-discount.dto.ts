import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWelcomeDiscountDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorId?: string;
}
