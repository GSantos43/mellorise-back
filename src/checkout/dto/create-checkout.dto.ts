import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsObject,
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
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
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
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingProtectionDto)
  shippingProtection?: ShippingProtectionDto;
}
