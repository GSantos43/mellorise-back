import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, verifyToken } from '@clerk/backend';

export type AuthenticatedClerkCustomer = {
  userId: string;
  email: string;
  name: string;
};

@Injectable()
export class ClerkAuthService {
  private readonly secretKey: string;
  private readonly jwtKey: string;
  private readonly authorizedParties: string[];
  private readonly clerkClient: ReturnType<typeof createClerkClient> | null;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('CLERK_SECRET_KEY')?.trim() ?? '';
    this.jwtKey = this.configService.get<string>('CLERK_JWT_KEY')?.trim() ?? '';
    this.authorizedParties = this.getAuthorizedParties();
    this.clerkClient = this.secretKey
      ? createClerkClient({ secretKey: this.secretKey })
      : null;
  }

  async authenticate(authorizationHeader?: string): Promise<AuthenticatedClerkCustomer> {
    const token = this.extractBearerToken(authorizationHeader);

    if (!token) {
      throw new UnauthorizedException('Sign in is required.');
    }

    this.assertConfigured();

    const claims = await verifyToken(token, {
      secretKey: this.secretKey || undefined,
      jwtKey: this.jwtKey || undefined,
      authorizedParties: this.authorizedParties.length ? this.authorizedParties : undefined,
    });
    const userId = typeof claims.sub === 'string' ? claims.sub : '';

    if (!userId) {
      throw new UnauthorizedException('Invalid Clerk session.');
    }

    const user = await this.clerkClient!.users.getUser(userId);
    const emailAddress =
      user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ||
      user.emailAddresses[0];
    const email = emailAddress?.emailAddress?.trim().toLowerCase();

    if (!email) {
      throw new UnauthorizedException('Your account needs a verified email.');
    }

    return {
      userId,
      email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email,
    };
  }

  private assertConfigured(): void {
    if (!this.clerkClient || (!this.secretKey && !this.jwtKey)) {
      throw new ServiceUnavailableException('Clerk authentication is not configured.');
    }
  }

  private extractBearerToken(authorizationHeader?: string): string {
    const header = authorizationHeader?.trim() ?? '';
    const [, token] = header.match(/^Bearer\s+(.+)$/i) ?? [];
    return token?.trim() ?? '';
  }

  private getAuthorizedParties(): string[] {
    return [
      this.configService.get<string>('CLERK_AUTHORIZED_PARTIES'),
      this.configService.get<string>('FRONTEND_ALLOWED_ORIGINS'),
      this.configService.get<string>('FRONTEND_ORIGIN'),
      this.configService.get<string>('FRONTEND_URL'),
    ]
      .filter(Boolean)
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
