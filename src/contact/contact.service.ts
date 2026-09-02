import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Injectable()
export class ContactService {
  constructor(private readonly mailService: MailService) {}

  async createMessage(input: CreateContactMessageDto): Promise<{ received: true }> {
    const comment = input.comment.trim();
    if (!comment) {
      throw new BadRequestException('Comment is required.');
    }

    const sent = await this.mailService.sendContactMessage({
      name: input.name?.trim() || undefined,
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || undefined,
      comment,
    });

    if (!sent) {
      throw new InternalServerErrorException('Could not send contact message.');
    }

    return { received: true };
  }
}
