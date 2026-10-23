import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Customer service')
    .setDescription('Customers and their USD / KHR accounts')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
