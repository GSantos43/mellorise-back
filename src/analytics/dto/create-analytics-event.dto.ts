import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const ANALYTICS_EVENT_NAMES = [
  'page_view',
  'view_item',
  'add_to_cart',
  'view_cart',
  'begin_checkout',
  'checkout_session_created',
  'checkout_redirect',
  'checkout_error',
  'checkout_abandoned',
  'purchase',
  'stripe_checkout_completed',
  'stripe_checkout_expired',
] as const;

export class CreateAnalyticsEventDto {
  @IsIn(ANALYTICS_EVENT_NAMES)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  pagePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  pageLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  referrer?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
