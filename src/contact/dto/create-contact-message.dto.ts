import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateContactMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment: string;
}
