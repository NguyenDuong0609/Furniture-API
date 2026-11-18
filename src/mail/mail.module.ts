import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { MailComposer } from './mail-composer.service.js';
import { MailOutboxService } from './mail-outbox.service.js';

@Module({
  providers: [MailService, MailComposer, MailOutboxService],
  exports: [MailOutboxService, MailService],
})
export class MailModule { }