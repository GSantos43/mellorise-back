import { Body, Controller, Post } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  createMessage(@Body() createContactMessageDto: CreateContactMessageDto) {
    return this.contactService.createMessage(createContactMessageDto);
  }
}
