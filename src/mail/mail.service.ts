import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type SendWelcomeDiscountInput = {
  to: string;
  code: string;
  amount: string;
  expiresAt: string;
  shopUrl: string;
};

type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string[];
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendWelcomeDiscount(input: SendWelcomeDiscountInput): Promise<boolean> {
    if (!this.isWelcomeDiscountEmailEnabled) return false;

    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('MAIL_FROM');

    if (!apiKey || !from) {
      this.logger.warn(
        'Welcome discount email skipped because RESEND_API_KEY or MAIL_FROM is not configured',
      );
      return false;
    }

    const replyTo = this.configService.get<string>('MAIL_REPLY_TO');
    const payload: ResendEmailPayload = {
      from,
      to: [input.to],
      subject: `Your MelloRise ${input.amount}% discount code`,
      html: this.buildWelcomeDiscountHtml(input),
      text: this.buildWelcomeDiscountText(input),
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.warn(
        `Resend rejected welcome discount email with status ${response.status}: ${errorText}`,
      );
      return false;
    }

    return true;
  }

  private get isWelcomeDiscountEmailEnabled(): boolean {
    return (
      this.configService.get<string>('MAIL_WELCOME_DISCOUNT_ENABLED') ?? 'true'
    )
      .trim()
      .toLowerCase() !== 'false';
  }

  private buildWelcomeDiscountHtml(input: SendWelcomeDiscountInput): string {
    const amount = this.escapeHtml(input.amount);
    const code = this.escapeHtml(input.code);
    const shopUrl = this.escapeHtml(input.shopUrl);
    const expiresAt = this.formatExpiration(input.expiresAt);

    return `
      <div style="margin:0;background:#f7fbfa;padding:32px 16px;font-family:Arial,sans-serif;color:#102829;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce8e7;border-radius:16px;padding:28px;">
          <p style="margin:0 0 10px;color:#168f78;font-size:13px;font-weight:700;text-transform:uppercase;">Welcome offer</p>
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;">Your ${amount}% MelloRise discount is ready</h1>
          <p style="margin:0 0 22px;color:#4f5f61;font-size:16px;line-height:1.5;">Use this code on checkout before it expires.</p>
          <div style="border:1px dashed #31d6b0;border-radius:12px;background:#effcf9;padding:18px;text-align:center;">
            <p style="margin:0 0 8px;color:#4f5f61;font-size:13px;font-weight:700;text-transform:uppercase;">Discount code</p>
            <p style="margin:0;font-size:30px;font-weight:800;letter-spacing:2px;color:#102829;">${code}</p>
          </div>
          <p style="margin:18px 0 0;color:#4f5f61;font-size:14px;line-height:1.5;">Expires: ${this.escapeHtml(expiresAt)}</p>
          <a href="${shopUrl}" style="display:inline-block;margin-top:22px;background:#31d6b0;color:#062626;text-decoration:none;font-weight:800;border-radius:999px;padding:14px 22px;">Shop MelloRise</a>
        </div>
      </div>
    `;
  }

  private buildWelcomeDiscountText(input: SendWelcomeDiscountInput): string {
    return [
      `Your MelloRise ${input.amount}% discount is ready.`,
      `Code: ${input.code}`,
      `Expires: ${this.formatExpiration(input.expiresAt)}`,
      `Shop: ${input.shopUrl}`,
    ].join('\n');
  }

  private formatExpiration(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const replacements: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };

      return replacements[character];
    });
  }
}
