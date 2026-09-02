import { ArgumentMetadata, BadRequestException, InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as assert from 'node:assert/strict';
import { CreateCheckoutDto } from '../checkout/dto/create-checkout.dto';
import { CreateWelcomeDiscountDto } from '../discounts/dto/create-welcome-discount.dto';
import { StripeService } from '../payments/stripe.service';

const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  validationError: {
    target: false,
    value: false,
  },
});

const checkoutMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateCheckoutDto,
  data: '',
};

const welcomeDiscountMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateWelcomeDiscountDto,
  data: '',
};

function validCheckoutPayload() {
  return {
    cart: [
      {
        productId: 101,
        variationId: 202,
        quantity: 1,
      },
    ],
    successUrl: 'https://mellorise.shop/checkout/success',
    cancelUrl: 'https://mellorise.shop/checkout',
    customerEmail: 'customer@example.com',
    shippingProtection: {
      enabled: true,
    },
  };
}

async function expectValidationError(
  payload: Record<string, unknown>,
  field: string,
) {
  await assert.rejects(
    () => validationPipe.transform(payload, checkoutMetadata),
    (error: unknown) => {
      assert(error instanceof BadRequestException);
      assert.match(JSON.stringify(error.getResponse()), new RegExp(`${field} should not exist`));
      return true;
    },
  );
}

async function main() {
  await expectValidationError(
    {
      ...validCheckoutPayload(),
      amount: 1,
    },
    'amount',
  );

  await expectValidationError(
    {
      ...validCheckoutPayload(),
      cart: [
        {
          productId: 101,
          variationId: 202,
          quantity: 1,
          amount: 1,
        },
      ],
    },
    'amount',
  );

  await expectValidationError(
    {
      ...validCheckoutPayload(),
      shippingProtection: {
        enabled: true,
        amount: 1,
      },
    },
    'amount',
  );

  const validatedPayload = await validationPipe.transform(
    validCheckoutPayload(),
    checkoutMetadata,
  );

  assert(validatedPayload instanceof CreateCheckoutDto);
  assert.equal(validatedPayload.shippingProtection?.enabled, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(validatedPayload.shippingProtection, 'amount'),
    false,
  );

  await assert.rejects(
    () =>
      validationPipe.transform(
        {
          email: 'customer@example.com',
          visitorId: 'visitor-123',
        },
        welcomeDiscountMetadata,
      ),
    (error: unknown) => {
      assert(error instanceof BadRequestException);
      assert.match(JSON.stringify(error.getResponse()), /email should not exist/);
      return true;
    },
  );

  assert.throws(
    () =>
      new StripeService({
        get: () => undefined,
      } as unknown as ConfigService),
    InternalServerErrorException,
  );

  assert.throws(
    () =>
      new StripeService({
        get: (key: string) => (key === 'STRIPE_SECRET_KEY' ? 'not-a-stripe-key' : undefined),
      } as unknown as ConfigService),
    InternalServerErrorException,
  );

  console.log('Checkout security checks passed');
}

void main();
