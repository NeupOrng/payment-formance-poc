import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

declare global {
  interface BigInt {
    toJSON(): string;
  }
}
// Money is bigint end to end; JSON responses carry it as a string of digits in the smallest unit.
BigInt.prototype.toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Payment service')
    .setDescription('Services, fee tiers, transfers and the Formance Ledger integration')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
