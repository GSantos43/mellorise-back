import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { CreateWelcomeDiscountDto } from './dto/create-welcome-discount.dto';
import { ValidateWelcomeDiscountDto } from './dto/validate-welcome-discount.dto';
import { WelcomeDiscountResponseDto } from './dto/welcome-discount-response.dto';

type WooCommerceCoupon = {
  id: number;
  code: string;
  amount: string;
  discount_type: string;
  date_expires?: string | null;
  usage_count?: number;
  email_restrictions?: string[];
};

type WooCommerceOrder = {
  id: number;
  status: string;
  billing?: {
    email?: string;
  };
  coupon_lines?: Array<{
    code?: string;
  }>;
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

type WooCommerceCouponPayload = {
  code: string;
  discount_type: string;
  amount: string;
  individual_use: boolean;
  usage_limit: number;
  usage_limit_per_user: number;
  email_restrictions: string[];
  date_expires: string;
  description: string;
  meta_data: Array<{
    key: string;
    value: string;
  }>;
};

@Injectable()
export class DiscountsService {
  private readonly logger = new Logger(DiscountsService.name);

  constructor(
    private readonly wooCommerceClient: WooCommerceClient,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async createWelcomeDiscount(
    input: CreateWelcomeDiscountDto,
    authenticatedEmail: string,
  ): Promise<WelcomeDiscountResponseDto> {
    const email = this.normalizeEmail(authenticatedEmail);
    await this.assertFirstPurchaseEmail(email);

    const expiresAt = this.getExpirationDate();
    const coupon = await this.wooCommerceClient.post<
      WooCommerceCoupon,
      WooCommerceCouponPayload
    >('/coupons', {
      code: this.createCouponCode(),
      discount_type: 'percent',
      amount: this.welcomeDiscountPercent,
      individual_use: true,
      usage_limit: 1,
      usage_limit_per_user: 1,
      email_restrictions: [email],
      date_expires: expiresAt,
      description: 'Headless welcome offer for first purchase only.',
      meta_data: [
        {
          key: '_headless_welcome_coupon',
          value: 'true',
        },
        {
          key: '_headless_welcome_email',
          value: email,
        },
        {
          key: '_headless_visitor_id',
          value: input.visitorId || '',
        },
      ],
    });

    const welcomeDiscount: WelcomeDiscountResponseDto = {
      code: coupon.code.toUpperCase(),
      email,
      amount: coupon.amount,
      discountType: coupon.discount_type,
      expiresAt,
    };

    welcomeDiscount.emailSent = await this.sendWelcomeDiscountEmail(welcomeDiscount);

    return welcomeDiscount;
  }

  async validateWelcomeCoupon(code: string, email?: string): Promise<WooCommerceCoupon> {
    const normalizedCode = code.trim().toLowerCase();
    const normalizedEmail = email ? this.normalizeEmail(email) : '';

    if (!normalizedCode) {
      throw this.createCouponError(
        'coupon_missing_code',
        'couponCode is required',
      );
    }

    if (!normalizedEmail) {
      throw this.createCouponError(
        'coupon_missing_email',
        'customerEmail is required to use this coupon',
      );
    }

    await this.assertFirstPurchaseEmail(normalizedEmail, normalizedCode);

    const coupons = await this.wooCommerceClient.get<WooCommerceCoupon[]>(
      '/coupons',
      {
        params: {
          code: normalizedCode,
          per_page: 1,
        },
      },
    );
    const coupon = coupons[0];

    if (!coupon || coupon.code.toLowerCase() !== normalizedCode) {
      throw this.createCouponError('coupon_not_found', 'Coupon not found');
    }

    if (
      coupon.discount_type !== 'percent' ||
      Number(coupon.amount) !== Number(this.welcomeDiscountPercent)
    ) {
      throw this.createCouponError(
        'coupon_invalid',
        'Coupon is not a welcome discount',
      );
    }

    const allowedEmails = (coupon.email_restrictions || []).map((item) =>
      this.normalizeEmail(item),
    );

    if (allowedEmails.length && !allowedEmails.includes(normalizedEmail)) {
      throw this.createCouponError(
        'coupon_email_mismatch',
        'Coupon email does not match checkout email',
      );
    }

    if (coupon.date_expires && new Date(coupon.date_expires).getTime() <= Date.now()) {
      throw this.createCouponError('coupon_expired', 'Coupon has expired');
    }

    return coupon;
  }

  async validateWelcomeDiscount(
    input: ValidateWelcomeDiscountDto,
  ): Promise<WelcomeDiscountResponseDto> {
    const email = this.normalizeEmail(input.customerEmail);
    const coupon = await this.validateWelcomeCoupon(input.couponCode, email);

    return {
      code: coupon.code.toUpperCase(),
      email,
      amount: coupon.amount,
      discountType: coupon.discount_type,
      expiresAt: coupon.date_expires || '',
    };
  }

  get welcomeDiscountPercent(): string {
    return this.configService.get<string>('WELCOME_DISCOUNT_PERCENT') || '10';
  }

  private async assertFirstPurchaseEmail(
    email: string,
    couponCode = '',
  ): Promise<void> {
    const orders = await this.wooCommerceClient.get<WooCommerceOrder[]>('/orders', {
      params: {
        search: email,
        status: this.firstPurchaseStatuses.join(','),
        per_page: 10,
      },
    });
    const paidOrders = orders.filter(
      (order) =>
        this.firstPurchaseStatuses.includes(order.status) &&
        this.normalizeEmail(order.billing?.email || '') === email,
    );
    const normalizedCouponCode = couponCode.trim().toLowerCase();
    const hasPaidOrderWithCoupon =
      Boolean(normalizedCouponCode) &&
      paidOrders.some((order) =>
        this.orderHasCoupon(order, normalizedCouponCode),
      );

    if (hasPaidOrderWithCoupon) {
      throw this.createCouponError(
        'coupon_exhausted',
        'Coupon has already been used on a completed Stripe checkout',
      );
    }

    if (paidOrders.length) {
      throw this.createCouponError(
        'coupon_first_purchase_only',
        'This welcome discount is available only for first purchases',
      );
    }
  }

  private createCouponError(code: string, message: string): BadRequestException {
    return new BadRequestException({
      code,
      message,
      userMessage: message,
    });
  }

  private orderHasCoupon(order: WooCommerceOrder, couponCode: string): boolean {
    const couponLineMatch = (order.coupon_lines || []).some(
      (coupon) => coupon.code?.trim().toLowerCase() === couponCode,
    );
    if (couponLineMatch) return true;

    return (order.meta_data || []).some(
      (meta) =>
        meta.key === '_headless_coupon_code' &&
        String(meta.value || '').trim().toLowerCase() === couponCode,
    );
  }

  private get firstPurchaseStatuses(): string[] {
    return (
      this.configService.get<string>('WELCOME_DISCOUNT_FIRST_PURCHASE_STATUSES') ||
      'processing,completed'
    )
      .split(',')
      .map((status) => status.trim().toLowerCase())
      .filter(Boolean);
  }

  private getExpirationDate(): string {
    const expirationHours = Number(
      this.configService.get<string>('WELCOME_DISCOUNT_EXPIRATION_HOURS') || 48,
    );
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + Math.max(1, expirationHours));

    return expiresAt.toISOString();
  }

  private createCouponCode(): string {
    const prefix = this.configService.get<string>('WELCOME_DISCOUNT_PREFIX') || 'MELLO10';
    return `${prefix}-${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async sendWelcomeDiscountEmail(
    discount: WelcomeDiscountResponseDto,
  ): Promise<boolean> {
    try {
      return await this.mailService.sendWelcomeDiscount({
        to: discount.email,
        code: discount.code,
        amount: discount.amount,
        expiresAt: discount.expiresAt,
        shopUrl: this.getWelcomeDiscountShopUrl(),
      });
    } catch (error) {
      this.logger.warn(
        `Could not send welcome discount email to ${discount.email}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  private getWelcomeDiscountShopUrl(): string {
    const frontendUrl =
      this.configService.get<string>('WELCOME_DISCOUNT_SHOP_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      this.configService.get<string>('FRONTEND_ORIGIN')?.split(',')[0] ||
      '';

    return frontendUrl
      ? `${frontendUrl.replace(/\/$/, '')}/products/wondernest-heightener-gummies-2026`
      : 'https://mellorise-front.vercel.app/products/wondernest-heightener-gummies-2026';
  }
}
