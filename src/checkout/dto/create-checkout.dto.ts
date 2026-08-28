import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  variationId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ShippingProtectionDto {
  @IsBoolean()
  enabled: boolean;
}

export class CreateCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutCartItemDto)
  cart: CheckoutCartItemDto[];

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  successUrl: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  cancelUrl: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingProtectionDto)
  shippingProtection?: ShippingProtectionDto;
}
