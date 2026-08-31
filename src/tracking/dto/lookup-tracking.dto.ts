import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LookupTrackingDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  identifier: string;
}
