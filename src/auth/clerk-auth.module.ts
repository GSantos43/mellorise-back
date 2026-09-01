import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClerkAuthService } from './clerk-auth.service';

@Module({
  imports: [ConfigModule],
  providers: [ClerkAuthService],
  exports: [ClerkAuthService],
})
export class ClerkAuthModule {}
